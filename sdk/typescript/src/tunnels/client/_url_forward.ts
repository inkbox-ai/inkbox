/**
 * inkbox-tunnels/client/_url_forward.ts
 *
 * URL-forward HTTP proxy. Mirrors Python `_url_forward.py`.
 *
 * The discriminated-union return type is the type-system forcing
 * function against materialize-then-check: a plain `{body: Buffer}`
 * shape would push implementations toward buffering full responses
 * before checking the cap, defeating the streaming guarantee. Both
 * over-cap and upstream-error paths are values the runtime maps onto
 * fixed on-wire response shapes — no exception-driven control flow.
 */

import type { Envelope } from "./_envelope.js";
import { HOP_BY_HOP_REQUEST } from "./_protocol.js";

export type ForwardResult =
  | {
      kind: "ok";
      status: number;
      headers: Array<[string, string]>;
      body: Buffer;
    }
  | {
      kind: "too-large";
      status: 502;
      inkboxReason: "response-too-large";
    }
  | {
      kind: "upstream-unreachable";
      status: 502;
      inkboxReason: "upstream-unreachable";
    };

export interface ForwardOpts {
  envelope: Envelope;
  forwardTo: string;
  publicHost: string;
  /** Injectable for tests; defaults to global `fetch`. */
  fetcher?: typeof fetch;
  /** Cap on materialized outbound bodies. */
  maxResponseBytes: number;
  /** Optional abort signal — runtime ties this to its deadline. */
  signal?: AbortSignal;
  /**
   * Verify the upstream's TLS certificate when ``forwardTo`` is
   * ``https://``. Default ``true``. Has no effect for ``http://``.
   */
  verifyTls?: boolean;
  /** Extra PEM CA bundle to trust for the upstream TLS connection. */
  caBundle?: Buffer | string | null;
  /**
   * Per-runtime cache of undici Agent dispatchers used when TLS
   * overrides are configured. Reuses connection pools across requests
   * with the same (verifyTls, caBundle) tuple instead of allocating a
   * fresh Agent — and timer — per request.
   */
  agentCache?: UndiciAgentCache;
}

/**
 * Cache of undici ``Agent`` instances keyed by (verifyTls, caBundle).
 * Returned dispatcher is opaque (`unknown`) so undici stays a
 * type-only dependency at this surface — the runtime imports lazily.
 */
export interface UndiciAgentCache {
  /**
   * Return a cached Agent for these TLS settings, or create + cache one.
   * Returns `null` if no override is needed (default trust + verify on).
   */
  get(
    verifyTls: boolean | undefined,
    caBundle: Buffer | string | null | undefined,
  ): Promise<unknown>;
  /** Close every cached Agent. Idempotent. */
  close(): Promise<void>;
}

/**
 * Build a per-runtime undici Agent cache. Each unique
 * (verifyTls, caBundle) combination gets one shared Agent. Closed in
 * `TunnelRuntime.aclose()`.
 */
export function createUndiciAgentCache(): UndiciAgentCache {
  const agents = new Map<string, unknown>();
  let closed = false;

  const keyFor = (
    verifyTls: boolean | undefined,
    caBundle: Buffer | string | null | undefined,
  ): string => {
    const v = verifyTls === false ? "off" : "on";
    let cb = "none";
    if (caBundle !== null && caBundle !== undefined) {
      const buf = typeof caBundle === "string"
        ? Buffer.from(caBundle, "utf-8")
        : caBundle;
      // crypto import is lazy below; do a coarse digest via length
      // initially, then refine with real hash inside `get` after we've
      // imported `node:crypto`.
      cb = `len:${buf.length}`;
    }
    return `${v}|${cb}`;
  };

  return {
    async get(verifyTls, caBundle) {
      if (closed) return undefined;
      const noOverride =
        verifyTls !== false &&
        (caBundle === null || caBundle === undefined);
      if (noOverride) return undefined;
      // Stable hash of caBundle so two distinct CAs of the same length
      // don't alias.
      const { createHash } = await import("node:crypto");
      let cbHash = "none";
      if (caBundle !== null && caBundle !== undefined) {
        const buf = typeof caBundle === "string"
          ? Buffer.from(caBundle, "utf-8")
          : caBundle;
        cbHash = createHash("sha256").update(buf).digest("hex").slice(0, 16);
      }
      const key = `${verifyTls === false ? "off" : "on"}|${cbHash}`;
      void keyFor;
      const existing = agents.get(key);
      if (existing !== undefined) return existing;
      const undici = await import("undici");
      const { buildUpstreamTlsConnectOpts } = await import("./_upstream_tls.js");
      const connect = buildUpstreamTlsConnectOpts({
        verify: verifyTls,
        caBundle: caBundle ?? null,
      });
      const agent = new undici.Agent({ connect });
      agents.set(key, agent);
      return agent;
    },
    async close() {
      if (closed) return;
      closed = true;
      const ps: Promise<unknown>[] = [];
      for (const a of agents.values()) {
        const ag = a as { close?: () => Promise<unknown> };
        if (ag && typeof ag.close === "function") {
          try { ps.push(ag.close()); } catch { /* swallow */ }
        }
      }
      agents.clear();
      await Promise.allSettled(ps);
    },
  };
}

/**
 * Prefix-join the envelope's path onto `forwardTo`'s base path.
 * Mirrors Python `join_forward_path`.
 */
export function joinForwardPath(forwardTo: string, envelopePath: string): string {
  const parsed = new URL(forwardTo);
  let basePath = parsed.pathname;
  if (basePath.endsWith("/")) basePath = basePath.slice(0, -1);
  const queryIdx = envelopePath.indexOf("?");
  let rawPath = queryIdx >= 0 ? envelopePath.slice(0, queryIdx) : envelopePath;
  const query = queryIdx >= 0 ? envelopePath.slice(queryIdx) : "";
  if (!rawPath.startsWith("/")) rawPath = "/" + rawPath;
  const fullPath = basePath ? `${basePath}${rawPath}` : rawPath;
  return `${parsed.protocol}//${parsed.host}${fullPath}${query}`;
}

/**
 * Build the headers we send to `forwardTo`. Strips hop-by-hop and
 * inbound forwarded-for headers; injects Host, X-Forwarded-Host,
 * X-Forwarded-Proto, X-Forwarded-For, Forwarded.
 */
export function buildForwardHeaders(
  envelope: Envelope,
  publicHost: string,
  targetHost: string,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  out.push(["host", targetHost]);
  out.push(["x-forwarded-host", publicHost]);
  out.push(["x-forwarded-proto", "https"]);
  if (envelope.forwardedForIp) {
    out.push(["x-forwarded-for", envelope.forwardedForIp]);
    out.push(["forwarded", `for=${envelope.forwardedForIp}`]);
  }
  const seenSpecial = new Set([
    "host",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-forwarded-for",
    "forwarded",
  ]);
  for (const [k, v] of envelope.forwardedHeaders) {
    const kl = k.toLowerCase();
    if (HOP_BY_HOP_REQUEST.has(kl)) continue;
    if (seenSpecial.has(kl)) continue;
    out.push([k, v]);
  }
  return out;
}

/**
 * Forward an envelope to `forwardTo`. Streams the upstream response;
 * bails as soon as the accumulated body exceeds `maxResponseBytes`.
 *
 * Caller is expected to have already validated the forward target and
 * the envelope path, and materialized the inbound body.
 */
export async function forwardEnvelopeToUrl(
  opts: ForwardOpts,
): Promise<ForwardResult> {
  const targetUrl = joinForwardPath(opts.forwardTo, opts.envelope.path);
  const parsedTarget = new URL(opts.forwardTo);
  const targetHost = parsedTarget.host;
  const headers = buildForwardHeaders(
    opts.envelope,
    opts.publicHost,
    targetHost,
  );

  // For https:// upstreams with TLS overrides, get a cached undici
  // dispatcher (or build one ad-hoc if the runtime didn't supply a
  // cache, e.g. legacy callers / direct unit tests). Lazy-loaded so
  // the default http:// path stays out of undici and edge bundles
  // don't pull undici in unconditionally.
  const isHttps = parsedTarget.protocol === "https:";
  const wantsTlsOverride =
    isHttps &&
    (opts.verifyTls === false ||
      (opts.caBundle !== null && opts.caBundle !== undefined));
  let dispatcher: unknown = undefined;
  if (wantsTlsOverride && opts.fetcher === undefined) {
    if (opts.agentCache !== undefined) {
      dispatcher = await opts.agentCache.get(opts.verifyTls, opts.caBundle ?? null);
    } else {
      // No cache supplied — fall back to per-request Agent. Caller is
      // responsible for closing if it cares; the runtime always passes
      // a cache, so this branch is only hit by direct callers.
      const undici = await import("undici");
      const { buildUpstreamTlsConnectOpts } = await import("./_upstream_tls.js");
      const connect = buildUpstreamTlsConnectOpts({
        verify: opts.verifyTls,
        caBundle: opts.caBundle ?? null,
      });
      dispatcher = new undici.Agent({ connect });
    }
  }
  const fetcher =
    opts.fetcher ?? ((url: string, init?: RequestInit) => {
      // Node's fetch (undici-backed) honors `dispatcher` on the init.
      const initWithDispatcher: RequestInit & { dispatcher?: unknown } =
        dispatcher === undefined ? init ?? {} : { ...(init ?? {}), dispatcher };
      return globalThis.fetch(
        url,
        initWithDispatcher as RequestInit,
      );
    });

  const reqInit: RequestInit = {
    method: opts.envelope.method,
    headers,
    // Empty bodies must not be passed for GET/HEAD.
    body:
      opts.envelope.method === "GET" || opts.envelope.method === "HEAD"
        ? undefined
        : opts.envelope.body.length > 0
          ? new Uint8Array(opts.envelope.body)
          : undefined,
    signal: opts.signal,
    // Don't follow redirects automatically — let the user app's
    // upstream decide. Matches the Python httpx behavior under stream().
    redirect: "manual",
  };
  let response: Response;
  try {
    response = await fetcher(targetUrl, reqInit);
  } catch {
    return { kind: "upstream-unreachable", status: 502, inkboxReason: "upstream-unreachable" };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    // No body — emit empty response.
    return {
      kind: "ok",
      status: response.status,
      headers: collectResponseHeaders(response.headers),
      body: Buffer.alloc(0),
    };
  }

  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      if (total + chunk.length > opts.maxResponseBytes) {
        // Cap exceeded — cancel the upstream reader before any more
        // bytes land in our buffer, matching Python's
        // `oversize=True; break` shape.
        await reader.cancel().catch(() => undefined);
        return {
          kind: "too-large",
          status: 502,
          inkboxReason: "response-too-large",
        };
      }
      chunks.push(chunk);
      total += chunk.length;
    }
  } catch {
    return {
      kind: "upstream-unreachable",
      status: 502,
      inkboxReason: "upstream-unreachable",
    };
  }

  return {
    kind: "ok",
    status: response.status,
    headers: collectResponseHeaders(response.headers),
    body: chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks, total),
  };
}

function collectResponseHeaders(h: Headers): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  h.forEach((value, key) => {
    out.push([key, value]);
  });
  return out;
}

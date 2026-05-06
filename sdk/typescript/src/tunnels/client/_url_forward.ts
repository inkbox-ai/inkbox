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
  const fetcher = opts.fetcher ?? globalThis.fetch;
  const targetUrl = joinForwardPath(opts.forwardTo, opts.envelope.path);
  const parsedTarget = new URL(opts.forwardTo);
  const targetHost = parsedTarget.host;
  const headers = buildForwardHeaders(
    opts.envelope,
    opts.publicHost,
    targetHost,
  );
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

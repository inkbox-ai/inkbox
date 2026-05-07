/**
 * inkbox-tunnels/client/_dispatch.ts
 *
 * The Dispatch interface — both the in-process h1 parser and the h2
 * transcoder hand parsed requests to a Dispatch impl. The interface is
 * transport-neutral; the same impl serves an h1 inbound and an h2 inbound.
 *
 * UpstreamUrlDispatch forwards requests to a customer-supplied URL via
 * undici (one Pool per dispatcher). CallableDispatch invokes an
 * in-process Fetch-style handler. ``dispatchWebSocket`` on either impl
 * routes WS upgrades (h1 ``Upgrade: websocket`` or h2 Extended CONNECT)
 * without going through the HTTP response sink.
 */

import { Readable } from "node:stream";
import { Pool } from "undici";
import { HOP_BY_HOP_REQUEST } from "./_protocol.js";
import { validateEnvelopePath } from "./_validation.js";
import { joinForwardPath } from "./_url_forward.js";
import { buildUpstreamTlsConnectOpts } from "./_upstream_tls.js";

function logDispatch(line: string): void {
  // Single structured info line per dispatch outcome. Matches the
  // pattern used elsewhere in `_runtime.ts` (console-based until the
  // SDK gets a pluggable logger).
  // eslint-disable-next-line no-console
  console.info(line);
}

/**
 * Wire-shaped request handed to a Dispatch impl. Both transports
 * populate the same shape; pseudo-headers and h2-only headers are
 * stripped before this point.
 */
export interface DispatchRequest {
  method: string;
  path: string;
  /** Lower-case header name + value, preserving order and duplicates. */
  headers: Array<[string, string]>;
  /** Streaming body. Resolves with empty Buffer on end-of-body. */
  body: AsyncIterable<Buffer>;
  forwardedForIp: string | null;
  sniHost: string | null;
  isWebSocket: boolean;
  wsSubprotocol: string | null;
  /**
   * Inbound transport: "h1" or "h2". Populated by the parser /
   * transcoder so dispatchers can emit structured telemetry with the
   * full ``dispatch=url-h1|url-h2|callable-h1|callable-h2`` field.
   */
  transport?: "h1" | "h2";
}

export interface DispatchResponseHead {
  status: number;
  headers: Array<[string, string]>;
}

/** Streamed response sink the Dispatch impl writes to. */
export interface DispatchResponseSink {
  sendHead(head: DispatchResponseHead): Promise<void>;
  sendBody(chunk: Buffer): Promise<void>;
  endBody(): Promise<void>;
  reset(reason: string): Promise<void>;
}

/** Stateless-per-call dispatcher invoked by the parser/transcoder. */
export interface Dispatch {
  dispatch(
    request: DispatchRequest,
    response: DispatchResponseSink,
  ): Promise<void>;
  /**
   * Optional WS upgrade entry-point. Transports check for this method
   * before routing a WS upgrade; if absent, they fall back to sending
   * a 501 via the regular HTTP sink.
   */
  dispatchWebSocket?(
    request: DispatchRequest,
    ws: import("./_ws_passthrough.js").WebSocketSink,
  ): Promise<void>;
  aclose(): Promise<void>;
}

// --- UpstreamUrlDispatch ---------------------------------------------------

export interface UpstreamUrlDispatchOpts {
  forwardTo: string;
  publicHost: string;
  maxOutboundBodyBytes: number;
  maxInboundBodyBytes: number;
  /** Verify upstream TLS certs. Only consulted when forwardTo is https://. */
  verifyTls?: boolean;
  /** PEM CA bundle to trust for the upstream TLS connection. */
  caBundle?: Buffer | string | null;
}

/**
 * Forward requests to a customer-supplied URL via undici.
 *
 * One ``undici.Pool`` per dispatcher. The pool's connect options carry
 * the upstream-TLS options when the URL is https://. We always speak
 * h1 to the upstream — we transcode at this boundary.
 */
export class UpstreamUrlDispatch implements Dispatch {
  private readonly pool: Pool;
  private readonly forwardTo: URL;
  private readonly publicHost: string;
  private readonly maxOutboundBodyBytes: number;
  private readonly maxInboundBodyBytes: number;
  private readonly verifyTls: boolean;
  private readonly caBundle: Buffer | string | null;

  constructor(opts: UpstreamUrlDispatchOpts) {
    this.forwardTo = new URL(opts.forwardTo);
    this.publicHost = opts.publicHost;
    this.maxOutboundBodyBytes = opts.maxOutboundBodyBytes;
    this.maxInboundBodyBytes = opts.maxInboundBodyBytes;
    this.verifyTls = opts.verifyTls ?? true;
    this.caBundle = opts.caBundle ?? null;
    const origin = `${this.forwardTo.protocol}//${this.forwardTo.host}`;
    const connect =
      this.forwardTo.protocol === "https:"
        ? buildUpstreamTlsConnectOpts({
            verify: opts.verifyTls,
            caBundle: opts.caBundle,
          })
        : {};
    this.pool = new Pool(origin, {
      connections: 16,
      pipelining: 1,
      connect,
    });
  }

  async aclose(): Promise<void> {
    try {
      await this.pool.close();
    } catch {
      /* swallow */
    }
  }

  async dispatch(
    request: DispatchRequest,
    response: DispatchResponseSink,
  ): Promise<void> {
    // Path validation — same rule as edge URL forwarding.
    const reason = validateEnvelopePath(request.path);
    if (reason !== null) {
      await sendSimple(response, 400, "invalid path");
      return;
    }

    const targetPath = joinForwardPath(this.forwardTo.toString(), request.path);
    // joinForwardPath returns a full URL; we need just the path+query for undici.
    const targetUrl = new URL(targetPath);
    const targetPathOnly = targetUrl.pathname + targetUrl.search;
    const targetHost = this.forwardTo.host;

    const outHeaders: Array<[string, string]> = [];
    outHeaders.push(["host", targetHost]);
    outHeaders.push(["x-forwarded-host", this.publicHost]);
    outHeaders.push(["x-forwarded-proto", "https"]);
    if (request.forwardedForIp != null) {
      outHeaders.push(["x-forwarded-for", request.forwardedForIp]);
      outHeaders.push(["forwarded", `for=${request.forwardedForIp}`]);
    }
    const seen = new Set([
      "host",
      "x-forwarded-host",
      "x-forwarded-proto",
      "x-forwarded-for",
      "forwarded",
    ]);
    for (const [k, v] of request.headers) {
      const kl = k.toLowerCase();
      if (kl.startsWith(":")) continue;
      if (HOP_BY_HOP_REQUEST.has(kl)) continue;
      if (seen.has(kl)) continue;
      outHeaders.push([k, v]);
    }

    const transport = request.transport ?? "h1";
    try {
      const headersObj: Record<string, string | string[]> = {};
      for (const [k, v] of outHeaders) {
        const existing = headersObj[k];
        if (existing === undefined) {
          headersObj[k] = v;
        } else if (Array.isArray(existing)) {
          existing.push(v);
        } else {
          headersObj[k] = [existing, v];
        }
      }
      const resp = await this.pool.request({
        method: request.method as
          | "GET"
          | "POST"
          | "PUT"
          | "DELETE"
          | "PATCH"
          | "HEAD"
          | "OPTIONS",
        path: targetPathOnly,
        headers: headersObj,
        body: Readable.from(asAsyncBytes(request.body)),
        bodyTimeout: 60_000,
      });

      const respHeaders: Array<[string, string]> = [];
      for (const [k, v] of Object.entries(resp.headers)) {
        if (Array.isArray(v)) {
          for (const item of v) respHeaders.push([k, item]);
        } else if (typeof v === "string") {
          respHeaders.push([k, v]);
        }
      }
      await response.sendHead({
        status: resp.statusCode,
        headers: respHeaders,
      });
      let bytesOut = 0;
      try {
        for await (const chunk of resp.body) {
          const buf = Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk as Uint8Array);
          bytesOut += buf.length;
          if (bytesOut > this.maxOutboundBodyBytes) {
            await response.reset("response-too-large");
            logDispatch(
              `dispatch=url-${transport} status=${resp.statusCode} ` +
                `method=${request.method} path=${request.path} ` +
                `bytes_out=${bytesOut} outcome=reset reason=response-too-large`,
            );
            return;
          }
          await response.sendBody(buf);
        }
        await response.endBody();
        logDispatch(
          `dispatch=url-${transport} status=${resp.statusCode} ` +
            `method=${request.method} path=${request.path} ` +
            `bytes_out=${bytesOut} outcome=ok`,
        );
      } catch {
        await response.reset("upstream-error");
        logDispatch(
          `dispatch=url-${transport} status=${resp.statusCode} ` +
            `method=${request.method} path=${request.path} ` +
            `outcome=upstream-error`,
        );
      }
    } catch {
      logDispatch(
        `dispatch=url-${transport} status=502 method=${request.method} ` +
          `path=${request.path} outcome=upstream-error`,
      );
      try {
        await sendSimple(response, 502, "upstream error");
      } catch {
        /* swallow */
      }
    }
  }

  async dispatchWebSocket(
    request: DispatchRequest,
    ws: import("./_ws_passthrough.js").WebSocketSink,
  ): Promise<void> {
    const reason = validateEnvelopePath(request.path);
    if (reason !== null) {
      try {
        await ws.reject({ status: 400 });
      } catch {
        /* swallow */
      }
      return;
    }
    const { bridgeWsUpgradeToUrl } = await import("./_ws_url_bridge.js");
    await bridgeWsUpgradeToUrl({
      forwardTo: this.forwardTo,
      publicHost: this.publicHost,
      verifyTls: this.verifyTls,
      caBundle: this.caBundle,
      request,
      ws,
    });
  }
}

async function* asAsyncBytes(
  body: AsyncIterable<Buffer>,
): AsyncIterable<Buffer> {
  for await (const chunk of body) {
    if (chunk.length > 0) yield chunk;
  }
}

async function sendSimple(
  response: DispatchResponseSink,
  status: number,
  body: string,
): Promise<void> {
  const buf = Buffer.from(body);
  await response.sendHead({
    status,
    headers: [
      ["content-type", "text/plain"],
      ["content-length", String(buf.length)],
    ],
  });
  if (buf.length > 0) await response.sendBody(buf);
  await response.endBody();
}

// --- CallableDispatch ------------------------------------------------------

export interface CallableDispatchOpts {
  handler: import("./_handler.js").InkboxHandler;
  /** Optional WebSocket handler — receives `accept`/`send`/iterator. */
  wsHandler?: import("./_ws.js").InkboxWsHandler;
  publicHost: string;
  maxOutboundBodyBytes: number;
}

/**
 * Dispatch impl that invokes an in-process `InkboxHandler` (Fetch-style).
 * Used by passthrough mode when the user supplied a `handler` instead
 * of a `forwardTo` URL. When `wsHandler` is also supplied, WebSocket
 * upgrades route through `dispatchWebSocket`.
 */
export class CallableDispatch implements Dispatch {
  constructor(private readonly opts: CallableDispatchOpts) {}

  async aclose(): Promise<void> {
    /* nothing to clean up — handler doesn't own runtime resources */
  }

  async dispatch(
    request: DispatchRequest,
    response: DispatchResponseSink,
  ): Promise<void> {
    if (request.isWebSocket) {
      // Transports that recognize ``dispatchWebSocket`` route WS
      // upgrades there directly. If we get here it means either the
      // transport is older or no ws handler is configured; refuse.
      const status = this.opts.wsHandler === undefined ? 501 : 501;
      await sendSimple(
        response,
        status,
        "websocket dispatch routed to http path",
      );
      return;
    }
    const reason = validateEnvelopePath(request.path);
    if (reason !== null) {
      await sendSimple(response, 400, "invalid path");
      return;
    }
    const { invokeHandlerStreaming } = await import(
      "./_callable_streaming.js"
    );
    const transport = request.transport ?? "h1";
    try {
      await invokeHandlerStreaming({
        handler: this.opts.handler,
        request,
        response,
        publicHost: this.opts.publicHost,
        maxOutboundBodyBytes: this.opts.maxOutboundBodyBytes,
      });
      logDispatch(
        `dispatch=callable-${transport} method=${request.method} ` +
          `path=${request.path} outcome=ok`,
      );
    } catch (err) {
      logDispatch(
        `dispatch=callable-${transport} method=${request.method} ` +
          `path=${request.path} outcome=handler-error`,
      );
      throw err;
    }
  }

  async dispatchWebSocket(
    request: DispatchRequest,
    ws: import("./_ws_passthrough.js").WebSocketSink,
  ): Promise<void> {
    const wsHandler = this.opts.wsHandler;
    if (wsHandler === undefined) {
      // Caller checked ``in`` and routed here, but no ws handler is
      // configured — refuse cleanly.
      try {
        await ws.reject({ status: 501 });
      } catch {
        /* swallow */
      }
      return;
    }
    const reason = validateEnvelopePath(request.path);
    if (reason !== null) {
      await ws.reject({ status: 400 });
      return;
    }
    const headersMap = new Map<string, string>();
    const offered: string[] = [];
    for (const [k, v] of request.headers) {
      const kl = k.toLowerCase();
      headersMap.set(kl, v);
      if (kl === "sec-websocket-protocol") {
        for (const piece of v.split(",")) {
          const trimmed = piece.trim();
          if (trimmed) offered.push(trimmed);
        }
      }
    }
    const url = `wss://${this.opts.publicHost}${request.path}`;
    const { bridgeWsHandlerOverSink } = await import("./_ws_passthrough.js");
    await bridgeWsHandlerOverSink({
      handler: wsHandler,
      sink: ws,
      meta: {
        url,
        headers: headersMap,
        offeredSubprotocols: offered,
      },
    });
  }
}

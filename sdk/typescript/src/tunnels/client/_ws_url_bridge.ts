/**
 * inkbox-tunnels/client/_ws_url_bridge.ts
 *
 * Bridge a WebSocket upgrade between an inbound `WebSocketSink` (h1
 * parser or h2 transcoder) and an `http://` / `https://` URL upstream.
 *
 * Flow per request:
 *
 *   1. Open a TCP / TLS connection to ``forwardTo``.
 *   2. Send a standard h1 ``GET /<path> HTTP/1.1`` upgrade request.
 *   3. Read the upstream's status line + headers; if not 101, reject
 *      the inbound sink with the upstream status.
 *   4. Accept on the inbound sink (with the upstream's negotiated
 *      subprotocol, when present).
 *   5. Bridge frames: inbound third-party frames re-encoded with the
 *      mask bit (we are the h1 client to upstream, RFC 6455 §5.1) and
 *      written to the upstream socket; upstream server frames decoded
 *      (unmasked) and forwarded back via ``ws.sendFrame``.
 */

import * as net from "node:net";
import * as tls from "node:tls";
import { randomBytes } from "node:crypto";
import {
  computeWsAccept,
  decodeClientFrame,
  encodeServerFrame,
} from "./_ws_passthrough.js";
import type { WebSocketSink } from "./_ws_passthrough.js";
import type { DispatchRequest } from "./_dispatch.js";
import {
  WS_OPCODE_CLOSE,
  encodeWsFrame,
} from "./_wsframe.js";
import { HOP_BY_HOP_REQUEST, HOP_BY_HOP_RESPONSE } from "./_protocol.js";
import { buildUpstreamTlsConnectOpts } from "./_upstream_tls.js";

const SKIP_REQUEST_HEADERS = new Set([
  "host",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-for",
  "forwarded",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-protocol",
  "upgrade",
  "connection",
]);

const UPSTREAM_HANDSHAKE_TIMEOUT_MS = 30_000;

export interface WsUpgradeToUrlOpts {
  forwardTo: URL;
  publicHost: string;
  verifyTls: boolean;
  caBundle: Buffer | string | null;
  request: DispatchRequest;
  ws: WebSocketSink;
}

export interface WsUpstreamHandle {
  socket: net.Socket | tls.TLSSocket;
  subprotocol: string | null;
  leftover: Buffer;
  /**
   * All 101 response headers, lowercased keys, in arrival order.
   * Application-defined headers (Set-Cookie, X-Use-Inkbox-*, custom
   * correlation IDs) live here. The runtime filters hop-by-hop +
   * handshake-control headers when reconstructing the third-party
   * 101.
   */
  headers: Array<[string, string]>;
}

export class WsUpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
  ) {
    super(reason);
    this.name = "WsUpstreamError";
  }
}

export interface OpenWsUpstreamOpts {
  forwardTo: URL;
  publicHost: string;
  verifyTls: boolean;
  caBundle: Buffer | string | null;
  requestPath: string;
  requestHeaders: Array<[string, string]>;
  wsSubprotocol: string | null;
  forwardedForIp: string | null;
  /** Bound on connect + h1 head-read. Default 30s. */
  handshakeTimeoutMs?: number;
}

/**
 * Open a TCP/TLS connection to ``forwardTo`` and complete an h1
 * ``Upgrade: websocket`` handshake. Verifies the upstream's
 * ``Sec-WebSocket-Accept`` per RFC 6455 §1.3 and returns the connected
 * socket + negotiated subprotocol + any bytes received past the head
 * (typically empty, but possibly the start of an early-pushed frame).
 */
export async function openWsUpstream(
  opts: OpenWsUpstreamOpts,
): Promise<WsUpstreamHandle> {
  const {
    forwardTo, publicHost, verifyTls, caBundle,
    requestPath, requestHeaders, wsSubprotocol, forwardedForIp,
  } = opts;
  const timeoutMs = opts.handshakeTimeoutMs ?? UPSTREAM_HANDSHAKE_TIMEOUT_MS;
  const host = forwardTo.hostname || "localhost";
  const port = forwardTo.port
    ? Number(forwardTo.port)
    : forwardTo.protocol === "https:"
      ? 443
      : 80;
  let pathOnly = requestPath.startsWith("/")
    ? requestPath
    : `/${requestPath}`;
  const baseSegments = forwardTo.pathname.replace(/\/+$/, "");
  if (baseSegments) pathOnly = `${baseSegments}${pathOnly}`;

  let socket: net.Socket | tls.TLSSocket;
  const connectDeadline = Date.now() + timeoutMs;
  const withTimeout = <T>(
    p: Promise<T>,
    ms: number,
    onTimeout: () => void,
  ): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        onTimeout();
        reject(new Error("timeout"));
      }, Math.max(0, ms));
      p.then(
        (v) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve(v);
        },
        (e) => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          reject(e);
        },
      );
    });

  try {
    if (forwardTo.protocol === "https:") {
      const tlsOpts = buildUpstreamTlsConnectOpts({ verify: verifyTls, caBundle });
      socket = tls.connect({
        host, port, servername: host,
        rejectUnauthorized: tlsOpts.rejectUnauthorized,
        ca: tlsOpts.ca,
      });
      const s = socket;
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          s.once("secureConnect", () => resolve());
          s.once("error", reject);
        }),
        timeoutMs,
        () => {
          try { s.destroy(); } catch { /* swallow */ }
        },
      );
    } else {
      socket = net.connect(port, host);
      const s = socket;
      await withTimeout(
        new Promise<void>((resolve, reject) => {
          s.once("connect", () => resolve());
          s.once("error", reject);
        }),
        timeoutMs,
        () => {
          try { s.destroy(); } catch { /* swallow */ }
        },
      );
    }
  } catch (e) {
    if ((e as Error)?.message === "timeout") {
      throw new WsUpstreamError(504, "upstream-connect-timeout");
    }
    throw new WsUpstreamError(502, `upstream-unreachable: ${String(e)}`);
  }

  const wsKey = randomBytes(16).toString("base64");
  const lines = [
    `GET ${pathOnly} HTTP/1.1`,
    `Host: ${forwardTo.host}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    `Sec-WebSocket-Key: ${wsKey}`,
    `X-Forwarded-Host: ${publicHost}`,
    "X-Forwarded-Proto: https",
  ];
  if (forwardedForIp !== null) {
    lines.push(`X-Forwarded-For: ${forwardedForIp}`);
  }
  if (wsSubprotocol !== null) {
    lines.push(`Sec-WebSocket-Protocol: ${wsSubprotocol}`);
  }
  for (const [k, v] of requestHeaders) {
    const kl = k.toLowerCase();
    if (kl.startsWith(":")) continue;
    if (HOP_BY_HOP_REQUEST.has(kl)) continue;
    if (SKIP_REQUEST_HEADERS.has(kl)) continue;
    lines.push(`${k}: ${v}`);
  }
  const upgradeReq = Buffer.from(lines.join("\r\n") + "\r\n\r\n", "ascii");
  try {
    await new Promise<void>((resolve, reject) => {
      socket.write(upgradeReq, (err) => (err ? reject(err) : resolve()));
    });
  } catch {
    socket.destroy();
    throw new WsUpstreamError(502, "upstream-write");
  }

  // Bound the head-read by what's left of the handshake budget.
  const remainingMs = Math.max(0, connectDeadline - Date.now());
  let timedOut = false;
  let result: {
    status: number;
    subprotocol: string | null;
    accept: string | null;
    extensions: string | null;
    headers: Array<[string, string]>;
    rest: Buffer;
  } | null;
  try {
    result = await withTimeout(
      new Promise<{
        status: number;
        subprotocol: string | null;
        accept: string | null;
        extensions: string | null;
        headers: Array<[string, string]>;
        rest: Buffer;
      } | null>((resolve) => {
        let merged = Buffer.alloc(0);
        const onData = (chunk: Buffer) => {
          merged = Buffer.concat([merged, chunk]);
          const idx = merged.indexOf("\r\n\r\n");
          if (idx === -1) {
            if (merged.length > 65536) {
              socket.off("data", onData);
              resolve(null);
            }
            return;
          }
          socket.off("data", onData);
          const head = merged.subarray(0, idx).toString("latin1");
          const rest = merged.subarray(idx + 4);
          const headLines = head.split("\r\n");
          let status = 502;
          const m = headLines[0]?.match(/^HTTP\/1\.[01]\s+(\d{3})/);
          if (m) status = Number(m[1]);
          let sub: string | null = null;
          let accept: string | null = null;
          let extensions: string | null = null;
          const headers: Array<[string, string]> = [];
          for (const line of headLines.slice(1)) {
            const ci = line.indexOf(":");
            if (ci === -1) continue;
            const name = line.slice(0, ci).trim().toLowerCase();
            const value = line.slice(ci + 1).trim();
            headers.push([name, value]);
            if (name === "sec-websocket-protocol") sub = value;
            else if (name === "sec-websocket-accept") accept = value;
            else if (name === "sec-websocket-extensions") extensions = value;
          }
          resolve({ status, subprotocol: sub, accept, extensions, headers, rest });
        };
        socket.on("data", onData);
        socket.once("error", () => {
          socket.off("data", onData);
          resolve(null);
        });
        socket.once("close", () => {
          socket.off("data", onData);
          resolve(null);
        });
      }),
      remainingMs,
      () => {
        timedOut = true;
        try { socket.destroy(); } catch { /* swallow */ }
      },
    );
  } catch (e) {
    if (timedOut || (e as Error)?.message === "timeout") {
      throw new WsUpstreamError(504, "upstream-handshake-timeout");
    }
    throw new WsUpstreamError(502, "upstream-read");
  }

  if (result === null) {
    socket.destroy();
    throw new WsUpstreamError(502, "upstream-read");
  }
  if (result.status !== 101) {
    socket.destroy();
    throw new WsUpstreamError(result.status, `upstream-status-${result.status}`);
  }
  const expectedAccept = computeWsAccept(wsKey);
  if (result.accept !== expectedAccept) {
    socket.destroy();
    throw new WsUpstreamError(502, "upstream-accept-mismatch");
  }
  // We never offer Sec-WebSocket-Extensions; per RFC 6455 §9.1 the server
  // MUST NOT confirm one not offered. Reject defensively — we have no
  // codec for permessage-deflate or any other extension.
  if (result.extensions !== null && result.extensions.length > 0) {
    socket.destroy();
    throw new WsUpstreamError(
      502, `upstream-unsupported-extensions: ${result.extensions}`,
    );
  }
  // RFC 6455 §4.1: the server's selected subprotocol MUST be one the
  // client offered (or omitted). A misbehaving upstream that picks an
  // un-offered token would force us to advertise something the third
  // party never asked for; the third party then fails the handshake.
  // Reject 502 instead of leaking the broken negotiation.
  if (result.subprotocol !== null && result.subprotocol.length > 0) {
    const offered = parseSubprotocolOffer(wsSubprotocol);
    if (!offered.includes(result.subprotocol)) {
      socket.destroy();
      throw new WsUpstreamError(
        502, `upstream-subprotocol-not-offered: ${result.subprotocol}`,
      );
    }
  }
  return {
    socket,
    subprotocol: result.subprotocol,
    leftover: result.rest,
    headers: result.headers,
  };
}

/**
 * Split a ``Sec-WebSocket-Protocol`` request value (comma-separated
 * tokens) into the list the client actually offered. Whitespace is
 * trimmed; empty tokens are dropped. RFC 6455 protocol tokens are
 * case-sensitive — preserve case.
 */
function parseSubprotocolOffer(offer: string | null): string[] {
  if (offer === null || offer.length === 0) return [];
  return offer
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function bridgeWsUpgradeToUrl(
  opts: WsUpgradeToUrlOpts,
): Promise<void> {
  const { forwardTo, publicHost, verifyTls, caBundle, request, ws } = opts;

  let upstream: WsUpstreamHandle;
  try {
    upstream = await openWsUpstream({
      forwardTo,
      publicHost,
      verifyTls,
      caBundle,
      requestPath: request.path,
      requestHeaders: request.headers,
      wsSubprotocol: request.wsSubprotocol,
      forwardedForIp: request.forwardedForIp,
    });
  } catch (e) {
    const status = e instanceof WsUpstreamError ? e.status : 502;
    try {
      await ws.reject({ status });
    } catch {
      /* swallow */
    }
    return;
  }
  const socket = upstream.socket;
  const headResult = {
    subprotocol: upstream.subprotocol,
    rest: upstream.leftover,
  };

  // Filter the upstream's 101 response headers — same shape as the
  // edge URL forward fix. Application-defined headers (Set-Cookie,
  // X-Use-Inkbox-* opt-outs, custom correlation IDs) flow through;
  // hop-by-hop, ws handshake-control, and h2 pseudo-headers are
  // stripped. sec-websocket-protocol is dropped from the headers list
  // because it rides the dedicated subprotocol arg below — emitting
  // both would double-write the header on the third-party 101.
  const wsHandshakeStrip = new Set([
    "sec-websocket-accept",
    "sec-websocket-extensions",
    "sec-websocket-key",
    "sec-websocket-version",
    "sec-websocket-protocol",
  ]);
  const forwardedHeaders: Array<[string, string]> = [];
  for (const [hk, hv] of upstream.headers) {
    if (hk.startsWith(":")) continue;
    if (HOP_BY_HOP_RESPONSE.has(hk)) continue;
    if (wsHandshakeStrip.has(hk)) continue;
    forwardedHeaders.push([hk, hv]);
  }

  try {
    await ws.accept({
      subprotocol: headResult.subprotocol ?? undefined,
      extraHeaders: forwardedHeaders.length > 0 ? forwardedHeaders : undefined,
    });
  } catch {
    socket.destroy();
    return;
  }

  // Bridge frames in both directions.
  let upstreamClosed = false;
  let thirdPartyClosed = false;
  const upstreamBuf: Buffer[] = [];
  if (headResult.rest.length > 0) upstreamBuf.push(headResult.rest);

  // Wake the recvFrame() await on abrupt upstream close. Without it the
  // third-party→upstream loop sits inside recvFrame indefinitely and
  // the bridge task leaks a fd / queued state.
  let signalUpstreamClosed: () => void = () => {};
  const upstreamClosedSignal = new Promise<void>((resolve) => {
    signalUpstreamClosed = resolve;
  });

  const upstreamData = (chunk: Buffer) => {
    upstreamBuf.push(chunk);
    drainUpstream().catch(() => undefined);
  };
  socket.on("data", upstreamData);
  socket.once("close", () => {
    upstreamClosed = true;
    signalUpstreamClosed();
  });
  socket.once("error", () => {
    upstreamClosed = true;
    signalUpstreamClosed();
  });
  // The upstream may already be gone before we attach listeners
  // (close is one-shot). Check explicitly so we don't sit in
  // recvFrame() forever after a fast-closing upstream.
  if (socket.destroyed) {
    upstreamClosed = true;
    signalUpstreamClosed();
  }

  let draining = false;
  async function drainUpstream(): Promise<void> {
    if (draining) return;
    draining = true;
    try {
      while (!thirdPartyClosed) {
        const decoded = decodeClientFrame(upstreamBuf, {
          requireMask: false,
        });
        if (decoded.kind === "need-more") return;
        if (decoded.kind === "rejected") {
          upstreamClosed = true;
          return;
        }
        try {
          await ws.sendFrame(decoded.opcode, decoded.payload, {
            fin: decoded.fin,
          });
        } catch {
          return;
        }
        if (decoded.opcode === WS_OPCODE_CLOSE) {
          upstreamClosed = true;
          return;
        }
      }
    } finally {
      draining = false;
    }
  }

  // Initial drain in case upgrade head shipped trailing frame bytes.
  void drainUpstream();

  // Pump third-party frames into upstream (h1 client masking).
  try {
    while (!upstreamClosed) {
      // Race the recvFrame await against upstream-close so an abrupt
      // RST/EOF doesn't leave us pinned indefinitely.
      const got = await Promise.race([
        ws.recvFrame(),
        upstreamClosedSignal.then(() => null as
          | { opcode: number; payload: Buffer; fin: boolean }
          | null),
      ]);
      if (got === null) break;
      const { opcode, payload, fin } = got;
      // Preserve fin so multi-frame messages stay fragmented and the
      // upstream can stream them rather than being coalesced into a
      // single FIN=1 frame.
      const frame = encodeWsFrame(opcode, payload, { mask: true, fin });
      try {
        await new Promise<void>((resolve, reject) => {
          if (
            socket.write(frame, (err) =>
              err ? reject(err) : resolve(),
            )
          ) {
            // wrote synchronously
          }
        });
      } catch {
        break;
      }
      if (opcode === WS_OPCODE_CLOSE) break;
    }
  } finally {
    thirdPartyClosed = true;
    try {
      socket.destroy();
    } catch {
      /* swallow */
    }
    try {
      await ws.aclose();
    } catch {
      /* swallow */
    }
  }
  void encodeServerFrame; // silence unused-import lint
}

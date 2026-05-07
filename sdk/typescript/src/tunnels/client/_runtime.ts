/**
 * inkbox-tunnels/client/_runtime.ts
 *
 * The h2 data-plane runtime (Node-only). Maintains one persistent
 * HTTP/2 connection to `https://{zone}/_system/connect`, parks N
 * intake streams, dispatches envelopes (HTTP / WS upgrade / passthrough
 * TCP-stream), and manages flow control + reconnect.
 *
 * Mirrors Python `_runtime.py` at the wire level. The TS-side API
 * shape diverges where Python exposed ASGI 3.0 — we expose Web
 * standards (Fetch API, `InkboxWebSocket`) instead. The on-wire
 * behavior is identical.
 *
 * Flow-control caveat: Node's high-level h2 server auto-credits, so
 * the `awaitWindow` / `markWindowBlocked` / per-stream send-window
 * gate paths are unit-tested only and not exercised through a real h2
 * stack against a real flow-control sequence.
 */

import * as http2 from "node:http2";
import * as net from "node:net";
import { setTimeout as setTimeoutPromise } from "node:timers/promises";
import type { ClientHttp2Session, ClientHttp2Stream } from "node:http2";

import {
  BRIDGE_CLEANUP_SEND_TIMEOUT_MS,
  BRIDGE_CLOSE_CODE,
  BRIDGE_HALF_CLOSE_GRACE_MS,
  BRIDGE_STATUS_TIMEOUT_MS,
  BridgeOpenFailed,
  BridgeProtocolError,
  BridgeStreamReset,
  makeBridgeStats,
} from "./_bridge.js";
import {
  type Envelope,
  filterResponseHeaders,
  parseEnvelope,
} from "./_envelope.js";
import { dispatchHttpInProcess, type InkboxHandler } from "./_handler.js";
import {
  ControlHeaders,
  ControlPaths,
  HOP_BY_HOP_RESPONSE,
  INKBOX_FORWARDED_HEADER_PREFIX,
  TunnelMetaHeader,
  TunnelRouteKind,
  TunnelSubprotocol,
} from "./_protocol.js";
import { validateEnvelopePath } from "./_validation.js";
import {
  createUndiciAgentCache,
  forwardEnvelopeToUrl,
  type ForwardResult,
  type UndiciAgentCache,
} from "./_url_forward.js";
import type { TlsSession, TlsTerminator } from "./_tls.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_CONTINUATION,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
  WS_OPCODE_TEXT,
  WsFrameDecoder,
  encodeWsEnvelope,
  encodeWsFrame,
} from "./_wsframe.js";
import {
  dispatchWsUpgradeInProcess,
  type InkboxWsHandler,
  type WsBridgeIO,
} from "./_ws.js";

const HTTP2_HEADER_METHOD = http2.constants.HTTP2_HEADER_METHOD;
const HTTP2_HEADER_PATH = http2.constants.HTTP2_HEADER_PATH;
const HTTP2_HEADER_SCHEME = http2.constants.HTTP2_HEADER_SCHEME;
const HTTP2_HEADER_AUTHORITY = http2.constants.HTTP2_HEADER_AUTHORITY;
const HTTP2_HEADER_STATUS = http2.constants.HTTP2_HEADER_STATUS;

export const PING_INTERVAL_MS = 20_000;
/**
 * Force-reconnect window if a PING goes unacked. Long enough to absorb
 * a slow path's RTT (multi-hop NLB, congested link), short enough that
 * a dead TCP doesn't strand the runtime past the next intake.
 */
export const PING_ACK_TIMEOUT_MS = 10_000;
export const BACKOFF_CAP_SEC = 30.0;
export const BACKOFF_JITTER = 0.25;

export const DEFAULT_INBOUND_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_OUTBOUND_BODY_BYTES = 32 * 1024 * 1024;

export class TunnelAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelAuthError";
  }
}

class OwnerTokenInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OwnerTokenInvalidError";
  }
}

/**
 * True iff the error indicates the h2 session is terminally gone —
 * any further ``openStream`` against this session will throw the
 * same error. Caller's responsibility is to STOP retrying and let
 * ``serveForever`` reconnect, not to spin on the corpse.
 *
 * Recognized codes:
 *   * ``ERR_HTTP2_INVALID_SESSION`` — Node throws this when
 *     ``ClientHttp2Session.request`` is called after the session has
 *     been destroyed.
 *   * ``ERR_HTTP2_GOAWAY_SESSION`` — Node throws this when a stream
 *     is opened against a session that has received GOAWAY.
 *   * ``ERR_HTTP2_STREAM_CANCEL`` (less common at session level) —
 *     surfaces in some teardown races.
 */
function isSessionTerminalError(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return (
    code === "ERR_HTTP2_INVALID_SESSION" ||
    code === "ERR_HTTP2_GOAWAY_SESSION" ||
    code === "ERR_HTTP2_STREAM_CANCEL" ||
    code === "ERR_HTTP2_SESSION_ERROR"
  );
}

export type StatusCallback = (
  status: "connecting" | "connected" | "reconnecting" | "closed",
) => void;

/**
 * What this runtime forwards to. URL is required; `httpHandler` and
 * `wsHandler` activate the in-process callable paths.
 */
export interface DispatchConfig {
  /** Set if the runtime forwards HTTP envelopes to a local URL. */
  forwardTo?: string;
  /** Set if the runtime invokes an in-process Fetch-API handler. */
  httpHandler?: InkboxHandler;
  /** Set if the runtime drives WS-upgrade envelopes through an in-process handler. */
  wsHandler?: InkboxWsHandler;
}

export interface TunnelRuntimeOpts {
  tunnelId: string;
  secret: string;
  zone: string;
  publicHost: string;
  poolSize: number | null;
  dispatch: DispatchConfig;
  /**
   * Set when the tunnel is in passthrough TLS mode. The runtime drives
   * the in-process TLS state machine for inbound bridge data and
   * forwards plaintext to `dispatch.forwardTo`.
   */
  tlsTerminator?: TlsTerminator;
  maxInboundBodyBytes?: number;
  maxResponseBytes?: number;
  allowRemoteForwarding?: boolean;
  /** Verify the upstream's TLS cert when `forwardTo` is https://. Default true. */
  forwardToVerifyTls?: boolean;
  /** Extra CA bundle (PEM) to trust for the upstream TLS connection. */
  forwardToCaBundle?: Buffer | string;
  onStatus?: StatusCallback;
  /** Internal injection point for tests; default is `Math.random`. */
  rng?: () => number;
  /** Internal injection point for tests; default is `node:http2` connect. */
  http2Connect?: (
    authority: string,
    options: http2.ClientSessionOptions | http2.SecureClientSessionOptions,
  ) => ClientHttp2Session;
}

interface StreamBus {
  events: Array<StreamEvent>;
  waiter: ((v: void) => void) | null;
  ended: boolean;
  rstCode: number | null;
}

type StreamEvent =
  | { kind: "headers"; headers: Array<[string, string]> }
  | { kind: "data"; data: Buffer }
  | { kind: "end" }
  | { kind: "reset"; code: number };

/**
 * The data-plane runtime. Construct with the bootstrap-derived
 * tunnelId/secret/zone/publicHost; call `serveForever()` to drive it,
 * `aclose()` to shut down.
 */
export class TunnelRuntime {
  private readonly tunnelId: string;
  private readonly secret: string;
  private readonly zone: string;
  private readonly publicHost: string;
  private readonly poolSize: number | null;
  private readonly dispatch: DispatchConfig;
  private readonly maxInbound: number;
  private readonly maxOutbound: number;
  private readonly tlsTerminator: TlsTerminator | null;
  private readonly forwardToVerifyTls: boolean;
  private readonly forwardToCaBundle: Buffer | string | null;
  private readonly onStatus?: StatusCallback;
  private readonly rng: () => number;
  private readonly http2Connect: NonNullable<TunnelRuntimeOpts["http2Connect"]>;

  private session: ClientHttp2Session | null = null;
  private ownerToken: string | null = null;
  private serverPoolSize: number | null = null;
  private intakeIdleSeconds: number | null = null;
  private responseDeadlineSeconds: number | null = null;

  private stop = false;
  private readonly streams = new Map<number, StreamBus>();
  private readonly bridgeStreamIds = new Set<number>();
  private readonly tasks = new Set<Promise<unknown>>();
  // Lazy: built on first passthrough TCP stream; closed in aclose().
  private passthroughDispatch: import("./_dispatch.js").Dispatch | null = null;
  // Cache of undici Agent instances for HTTPS URL-forward with TLS
  // overrides (verifyTls=false or caBundle set). Avoids constructing a
  // fresh Agent per request, which would leak sockets/timers. Closed
  // in aclose().
  private readonly undiciAgentCache: UndiciAgentCache = createUndiciAgentCache();
  private pingHandle: NodeJS.Timeout | null = null;
  private pingAbort: AbortController | null = null;
  private shutdownAbort: AbortController = new AbortController();

  constructor(opts: TunnelRuntimeOpts) {
    this.tunnelId = opts.tunnelId;
    this.secret = opts.secret;
    this.zone = opts.zone;
    this.publicHost = opts.publicHost;
    this.poolSize = opts.poolSize;
    this.dispatch = opts.dispatch;
    this.maxInbound = opts.maxInboundBodyBytes ?? DEFAULT_INBOUND_BODY_BYTES;
    this.maxOutbound = opts.maxResponseBytes ?? DEFAULT_OUTBOUND_BODY_BYTES;
    this.tlsTerminator = opts.tlsTerminator ?? null;
    this.forwardToVerifyTls = opts.forwardToVerifyTls ?? true;
    this.forwardToCaBundle = opts.forwardToCaBundle ?? null;
    this.onStatus = opts.onStatus;
    this.rng = opts.rng ?? Math.random;
    this.http2Connect = opts.http2Connect ?? http2.connect.bind(http2);
  }

  // --- public lifecycle ---------------------------------------------------

  /**
   * Drive the runtime forever. Reconnects with jittered exponential
   * backoff; rejects only on permanent auth failure (rotate the
   * secret) or after `aclose()`.
   */
  async serveForever(): Promise<void> {
    let backoff = 1.0;
    let consecutiveFailures = 0;
    this.notifyStatus("connecting");
    while (!this.stop) {
      try {
        await this.runOnce();
        backoff = 1.0;
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof TunnelAuthError) {
          this.notifyStatus("closed");
          throw err;
        }
        consecutiveFailures += 1;
        // eslint-disable-next-line no-console
        console.warn(
          `tunnel runtime: connection error (#${consecutiveFailures}); reconnecting`,
          err,
        );
        this.notifyStatus("reconnecting");
      }
      if (this.stop) {
        this.notifyStatus("closed");
        return;
      }
      // Exact Python parity (verified _runtime.py:240):
      //   jitter = backoff * 0.25 * (2*rng() - 1)
      //   sleep  = max(0.1, backoff + jitter)
      //   backoff = min(backoff * 2, 30.0)
      const jitter = backoff * BACKOFF_JITTER * (2 * this.rng() - 1);
      const sleepFor = Math.max(0.1, backoff + jitter);
      try {
        await setTimeoutPromise(sleepFor * 1000, undefined, {
          signal: this.shutdownAbort.signal,
        });
      } catch {
        // aborted by aclose()
        this.notifyStatus("closed");
        return;
      }
      backoff = Math.min(backoff * 2, BACKOFF_CAP_SEC);
    }
    this.notifyStatus("closed");
  }

  /** Graceful shutdown. Signals all loops to exit; closes the h2 session. */
  async aclose(): Promise<void> {
    this.stop = true;
    this.shutdownAbort.abort();
    this.pingAbort?.abort();
    if (this.passthroughDispatch !== null) {
      try {
        await this.passthroughDispatch.aclose();
      } catch {
        /* swallow */
      }
      this.passthroughDispatch = null;
    }
    try {
      await this.undiciAgentCache.close();
    } catch {
      /* swallow */
    }
    if (this.pingHandle !== null) {
      clearInterval(this.pingHandle);
      this.pingHandle = null;
    }
    const session = this.session;
    if (session !== null && !session.closed) {
      // Tier 1 of the GOAWAY fallback ladder: high-level close().
      // Node's `Http2Session.close()` waits for in-flight streams to
      // drain before emitting `close`. The intake pool parks streams
      // indefinitely, so we explicitly emit GOAWAY and then destroy
      // after a short grace — this is Tier 4 of the ladder
      // (bounded drain timeout) and is a known divergence from
      // Python's no-timeout aclose().
      try {
        session.goaway();
      } catch {
        /* swallow */
      }
      // Cancel parked intake streams: best-effort.
      for (const sid of this.streams.keys()) {
        try {
          // node:http2 does not surface a per-stream cancel from the
          // session-level alone; ignore — destroy below tears down all
          // streams atomically.
          void sid;
        } catch {
          /* swallow */
        }
      }
      // Bounded drain: 250ms. Then destroy.
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          try {
            session.destroy();
          } catch {
            /* swallow */
          }
          resolve();
        }, 250);
        session.once("close", () => {
          clearTimeout(t);
          resolve();
        });
        try {
          session.close();
        } catch {
          clearTimeout(t);
          try {
            session.destroy();
          } catch {
            /* swallow */
          }
          resolve();
        }
      });
    }
  }

  // --- per-connection lifecycle -----------------------------------------

  private async runOnce(): Promise<void> {
    await this.openConnection();
    try {
      await this.sendHello();
      this.notifyStatus("connected");
      const effectivePool =
        this.serverPoolSize ?? this.poolSize ?? 1;
      const intakes: Array<Promise<void>> = [];
      for (let slot = 0; slot < effectivePool; slot++) {
        intakes.push(this.intakeLoop(slot));
      }
      this.startPingLoop();
      // Wait for the session to close (read pump implicitly drives via
      // `session.on('close', ...)`).
      await this.waitForSessionClose();
      // Cancel intake loops; they exit when stop is set or session
      // closes (read pump drains queue events).
      await Promise.allSettled(intakes);
    } finally {
      this.stopPingLoop();
      this.streams.clear();
      this.bridgeStreamIds.clear();
      this.session = null;
    }
  }

  private async openConnection(): Promise<void> {
    const authority = `https://${this.zone}`;
    const session = this.http2Connect(authority, {
      ALPNProtocols: ["h2"],
      // Note: we deliberately do NOT set ENABLE_CONNECT_PROTOCOL on
      // local settings. Per RFC 8441 §3 that setting is server-to-
      // client; Python sets it as a hyper-h2 library validator
      // workaround. Node http2 either accepts `:protocol` or doesn't
      // (Spike 1) — the setting line doesn't translate.
    });
    this.session = session;
    session.on("close", () => {
      // Drain all open streams with a synthetic reset event so any
      // awaiters wake up.
      for (const [, bus] of this.streams) {
        if (!bus.ended) {
          bus.events.push({ kind: "reset", code: 0 });
          bus.ended = true;
          this.wake(bus);
        }
      }
    });
    session.on("error", () => {
      /* error surfaces via close + stream events */
    });
    session.on("goaway", (errorCode: number, lastStreamId: number) => {
      // eslint-disable-next-line no-console
      console.info(
        `GOAWAY error_code=${errorCode} last_stream_id=${lastStreamId}`,
      );
    });
    await new Promise<void>((resolve, reject) => {
      const onConnect = () => {
        session.off("error", onError);
        resolve();
      };
      const onError = (err: Error) => {
        session.off("connect", onConnect);
        reject(err);
      };
      session.once("connect", onConnect);
      session.once("error", onError);
    });
    // OS-level keepalive on the underlying TCP socket so a silently-
    // dropped connection (NAT timeout, NLB idle eviction, peer power-
    // off, etc.) eventually surfaces as a socket error even if no
    // application traffic is flowing. Application-level PING ack
    // tracking (see startPingLoop) is the load-bearing detector;
    // this is defense-in-depth.
    try {
      const sock = (session as unknown as { socket?: import("node:net").Socket }).socket;
      sock?.setKeepAlive?.(true, 30_000);
    } catch {
      /* swallow */
    }
  }

  private waitForSessionClose(): Promise<void> {
    const session = this.session;
    if (session === null) return Promise.resolve();
    return new Promise<void>((resolve) => {
      if (session.closed) {
        resolve();
        return;
      }
      session.once("close", () => resolve());
    });
  }

  // --- handshake ---------------------------------------------------------

  private async sendHello(): Promise<void> {
    this.ownerToken = null;
    this.serverPoolSize = null;
    this.intakeIdleSeconds = null;
    this.responseDeadlineSeconds = null;

    const helloHeaders: http2.OutgoingHttpHeaders = {
      [HTTP2_HEADER_METHOD]: "POST",
      [HTTP2_HEADER_SCHEME]: "https",
      [HTTP2_HEADER_AUTHORITY]: this.zone,
      [HTTP2_HEADER_PATH]: ControlPaths.HELLO,
      [ControlHeaders.TUNNEL_ID]: this.tunnelId,
      [ControlHeaders.TUNNEL_SECRET]: this.secret,
      "content-length": "0",
    };
    if (this.poolSize !== null) {
      helloHeaders[ControlHeaders.POOL_SIZE] = String(this.poolSize);
    }
    const stream = this.openStream(helloHeaders, { endStream: true });
    const { status, body } = await this.awaitResponse(stream.streamId);
    if (status === 401 || status === 403) {
      throw new TunnelAuthError(
        `${ControlPaths.HELLO} returned ${status}; connect secret is invalid`,
      );
    }
    if (status !== 200) {
      throw new Error(
        `${ControlPaths.HELLO} returned ${status}; transient — will retry`,
      );
    }
    let payload: Record<string, unknown> = {};
    if (body.length > 0) {
      try {
        payload = JSON.parse(body.toString("utf-8")) as Record<string, unknown>;
      } catch {
        throw new Error(`${ControlPaths.HELLO} returned 200 but body was not JSON`);
      }
    }
    const ownerToken = payload["owner_token"];
    if (typeof ownerToken !== "string" || ownerToken === "") {
      throw new Error(
        `${ControlPaths.HELLO} response missing owner_token; cannot park intake`,
      );
    }
    this.ownerToken = ownerToken;
    if (typeof payload["default_pool_size"] === "number") {
      this.serverPoolSize = payload["default_pool_size"] as number;
    }
    if (typeof payload["intake_idle_seconds"] === "number") {
      this.intakeIdleSeconds = payload["intake_idle_seconds"] as number;
    }
    if (typeof payload["response_deadline_seconds"] === "number") {
      this.responseDeadlineSeconds = payload[
        "response_deadline_seconds"
      ] as number;
    }
  }

  // --- stream helpers ----------------------------------------------------

  private openStream(
    headers: http2.OutgoingHttpHeaders,
    opts: { endStream: boolean },
  ): { stream: ClientHttp2Stream; streamId: number } {
    const session = this.session;
    if (session === null) throw new Error("h2 connection not open");
    const stream = session.request(headers, { endStream: opts.endStream });
    const bus: StreamBus = {
      events: [],
      waiter: null,
      ended: false,
      rstCode: null,
    };
    // Stream id is allocated synchronously after `request()`.
    const streamId = stream.id ?? -1;
    if (streamId === -1) {
      // Fall back to listening for `ready`.
      // In practice Node assigns the id synchronously; this is a guard.
      throw new Error("h2 stream id not assigned synchronously");
    }
    this.streams.set(streamId, bus);
    stream.on("response", (responseHeaders) => {
      const flat: Array<[string, string]> = [];
      for (const k of Object.keys(responseHeaders)) {
        const v = responseHeaders[k];
        if (Array.isArray(v)) {
          for (const item of v) flat.push([k, item]);
        } else if (v !== undefined) {
          flat.push([k, String(v)]);
        }
      }
      bus.events.push({ kind: "headers", headers: flat });
      this.wake(bus);
    });
    stream.on("data", (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bus.events.push({ kind: "data", data: buf });
      this.wake(bus);
    });
    stream.on("end", () => {
      bus.events.push({ kind: "end" });
      bus.ended = true;
      this.wake(bus);
    });
    stream.on("close", () => {
      if (!bus.ended) {
        bus.events.push({ kind: "reset", code: stream.rstCode ?? 0 });
        bus.ended = true;
        this.wake(bus);
      }
    });
    stream.on("error", () => {
      // Surfaces via close().
    });
    return { stream, streamId };
  }

  private wake(bus: StreamBus): void {
    const w = bus.waiter;
    if (w !== null) {
      bus.waiter = null;
      w();
    }
  }

  private async nextEvent(streamId: number): Promise<StreamEvent | null> {
    const bus = this.streams.get(streamId);
    if (bus === undefined) return null;
    while (true) {
      const ev = bus.events.shift();
      if (ev !== undefined) return ev;
      if (bus.ended && bus.events.length === 0) {
        // Already drained; signal end.
        return null;
      }
      await new Promise<void>((resolve) => {
        bus.waiter = resolve;
      });
    }
  }

  private async awaitResponse(
    streamId: number,
  ): Promise<{ status: number; body: Buffer }> {
    const chunks: Buffer[] = [];
    let status = 0;
    let gotHeaders = false;
    while (true) {
      const ev = await this.nextEvent(streamId);
      if (ev === null) {
        this.streams.delete(streamId);
        return { status, body: Buffer.concat(chunks) };
      }
      if (ev.kind === "headers" && !gotHeaders) {
        gotHeaders = true;
        const statusStr =
          ev.headers.find(([k]) => k === HTTP2_HEADER_STATUS)?.[1] ?? "0";
        status = parseInt(statusStr, 10) || 0;
      } else if (ev.kind === "data") {
        chunks.push(ev.data);
      } else if (ev.kind === "end" || ev.kind === "reset") {
        this.streams.delete(streamId);
        return { status, body: Buffer.concat(chunks) };
      }
    }
  }

  // --- intake pool -------------------------------------------------------

  private async intakeLoop(slot: number): Promise<void> {
    while (!this.stop && this.session !== null && !this.session.closed) {
      let envelope: Envelope | null;
      try {
        envelope = await this.parkOneIntake(slot);
      } catch (err) {
        if (err instanceof OwnerTokenInvalidError) {
          // eslint-disable-next-line no-console
          console.warn(
            `intake slot ${slot}: owner_token rejected; reconnecting`,
          );
          this.session?.destroy();
          return;
        }
        if (isSessionTerminalError(err) || this.session?.destroyed) {
          // The h2 session is gone — every subsequent openStream will
          // throw the same error. Don't retry-storm; exit the slot so
          // ``runOnce`` observes ``waitForSessionClose`` resolve and
          // ``serveForever`` reconnects. Same shape as Python's
          // ``_OwnerTokenInvalidError`` retry-storm fix in
          // ``_intake_loop``: distinguish terminal session errors
          // before the generic retry handler.
          // eslint-disable-next-line no-console
          console.warn(
            `intake slot ${slot}: h2 session terminal; exiting slot`,
          );
          try { this.session?.destroy(); } catch { /* swallow */ }
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(`intake slot ${slot} transient error; retrying`, err);
        await setTimeoutPromise(250).catch(() => undefined);
        continue;
      }
      if (envelope === null) continue;
      // Fire-and-forget dispatch; tracked so we can join on shutdown.
      const task = this.dispatchEnvelope(envelope).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`dispatch failed request_id=${envelope!.requestId}`, err);
      });
      this.tasks.add(task);
      task.finally(() => this.tasks.delete(task));
    }
  }

  private async parkOneIntake(slot: number): Promise<Envelope | null> {
    if (this.ownerToken === null) {
      throw new Error(
        "intake parked before /_system/hello returned an owner_token",
      );
    }
    const headers: http2.OutgoingHttpHeaders = {
      [HTTP2_HEADER_METHOD]: "POST",
      [HTTP2_HEADER_SCHEME]: "https",
      [HTTP2_HEADER_AUTHORITY]: this.zone,
      [HTTP2_HEADER_PATH]: ControlPaths.INTAKE,
      [ControlHeaders.TUNNEL_ID]: this.tunnelId,
      [ControlHeaders.OWNER_TOKEN]: this.ownerToken,
      [ControlHeaders.POOL_SLOT]: String(slot),
      "content-length": "0",
    };
    const { streamId } = this.openStream(headers, { endStream: true });
    let recvHeaders: Array<[string, string]> | null = null;
    const chunks: Buffer[] = [];
    while (true) {
      const ev = await this.nextEvent(streamId);
      if (ev === null) {
        this.streams.delete(streamId);
        return null;
      }
      if (ev.kind === "headers" && recvHeaders === null) {
        recvHeaders = ev.headers;
      } else if (ev.kind === "data") {
        chunks.push(ev.data);
      } else if (ev.kind === "end") {
        break;
      } else if (ev.kind === "reset") {
        this.streams.delete(streamId);
        return null;
      }
    }
    this.streams.delete(streamId);
    if (recvHeaders === null) return null;
    const status =
      recvHeaders.find(([k]) => k === HTTP2_HEADER_STATUS)?.[1] ?? "0";
    if (status !== "200") {
      const reason =
        recvHeaders.find(([k]) => k === TunnelMetaHeader.REASON)?.[1] ?? "";
      // eslint-disable-next-line no-console
      console.warn(
        `${ControlPaths.INTAKE} slot=${slot} -> status=${status} reason=${reason}`,
      );
      if (status === "401") {
        throw new OwnerTokenInvalidError(
          `slot=${slot} status=401 reason=${reason}`,
        );
      }
      return null;
    }
    return parseEnvelope(recvHeaders, Buffer.concat(chunks));
  }

  // --- ping loop ---------------------------------------------------------

  private startPingLoop(): void {
    this.pingAbort = new AbortController();
    this.pingHandle = setInterval(() => {
      const session = this.session;
      if (session === null || session.closed) return;
      let ackTimer: NodeJS.Timeout | null = null;
      let acked = false;
      try {
        session.ping((err) => {
          acked = true;
          if (ackTimer !== null) {
            clearTimeout(ackTimer);
            ackTimer = null;
          }
          if (err !== null && err !== undefined) {
            // Treat any ping error (cancelled / write error) as the
            // peer being unreachable — destroy so serveForever notices
            // and reconnects.
            try { session.destroy(); } catch { /* swallow */ }
          }
        });
      } catch {
        // Synchronous ping failure means the session is already in a
        // bad state. Force-destroy so waitForSessionClose resolves.
        try { session.destroy(); } catch { /* swallow */ }
        return;
      }
      // Application-level liveness check: if the ack doesn't come
      // back within PING_ACK_TIMEOUT_MS, the underlying TCP is gone
      // (kernel send buffer absorbing writes silently is the typical
      // failure mode — Node's high-level h2 session won't notice
      // without our help). Force-destroy the session; serveForever
      // observes the close and reconnects.
      ackTimer = setTimeout(() => {
        if (acked) return;
        // eslint-disable-next-line no-console
        console.warn(
          `tunnel runtime: PING ack not received within ` +
            `${PING_ACK_TIMEOUT_MS}ms; assuming dead connection, ` +
            `forcing reconnect`,
        );
        try { session.destroy(); } catch { /* swallow */ }
      }, PING_ACK_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
    // Do NOT unref(): explicit cancellation in stopPingLoop().
  }

  private stopPingLoop(): void {
    if (this.pingHandle !== null) {
      clearInterval(this.pingHandle);
      this.pingHandle = null;
    }
    this.pingAbort?.abort();
    this.pingAbort = null;
  }

  // --- envelope dispatch -------------------------------------------------

  private async dispatchEnvelope(envelope: Envelope): Promise<void> {
    if (envelope.routeKind === TunnelRouteKind.WS_UPGRADE) {
      try {
        await this.dispatchWsUpgrade(envelope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`ws dispatch failed request_id=${envelope.requestId}`, err);
      }
      return;
    }
    if (envelope.routeKind === TunnelRouteKind.TCP_STREAM) {
      // Passthrough TCP bridge — defer until M4 lands here.
      try {
        await this.dispatchTcpStream(envelope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `tcp-stream dispatch failed tcp_id=${envelope.tcpId}`,
          err,
        );
      }
      return;
    }
    try {
      await this.dispatchHttp(envelope);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`dispatch failed request_id=${envelope.requestId}`, err);
      try {
        await this.postResponse(envelope.requestId, 500, [["content-type", "text/plain"]], Buffer.from("internal error"));
      } catch {
        /* swallow */
      }
    }
  }

  // --- HTTP dispatch -----------------------------------------------------

  private async dispatchHttp(envelope: Envelope): Promise<void> {
    const reject = validateEnvelopePath(envelope.path);
    if (reject !== null) {
      await this.postResponse(envelope.requestId, 400, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, reject],
      ], Buffer.from("invalid path"));
      return;
    }

    // Materialize body if offloaded.
    let materialized: Envelope;
    try {
      materialized = await this.materializeBody(envelope);
    } catch (err) {
      const reason = err instanceof BodyTooLargeError ? "request-body-too-large" : "body-fetch-failed";
      const status = err instanceof BodyTooLargeError ? 413 : 502;
      await this.postResponse(envelope.requestId, status, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, reason],
      ], Buffer.from(reason));
      return;
    }

    const deadlineMs = (this.responseDeadlineSeconds ?? 0) * 1000;
    const ctrl = new AbortController();
    let deadlineHandle: NodeJS.Timeout | null = null;
    if (deadlineMs > 0) {
      deadlineHandle = setTimeout(() => ctrl.abort(), deadlineMs);
    }

    try {
      let result: ForwardResult | null = null;
      if (this.dispatch.httpHandler !== undefined) {
        const inProcess = await dispatchHttpInProcess({
          envelope: materialized,
          handler: this.dispatch.httpHandler,
          publicHost: this.publicHost,
          maxResponseBytes: this.maxOutbound,
          signal: ctrl.signal,
        });
        if (inProcess.kind === "ok") {
          await this.postResponse(
            envelope.requestId,
            inProcess.status,
            filterResponseHeaders(inProcess.headers),
            inProcess.body,
          );
        } else {
          await this.postResponse(envelope.requestId, inProcess.status, [
            ["content-type", "text/plain"],
            [TunnelMetaHeader.REASON, inProcess.inkboxReason],
          ], Buffer.from(inProcess.inkboxReason));
        }
        return;
      }
      if (this.dispatch.forwardTo !== undefined) {
        result = await forwardEnvelopeToUrl({
          envelope: materialized,
          forwardTo: this.dispatch.forwardTo,
          publicHost: this.publicHost,
          maxResponseBytes: this.maxOutbound,
          signal: ctrl.signal,
          verifyTls: this.forwardToVerifyTls,
          caBundle: this.forwardToCaBundle,
          agentCache: this.undiciAgentCache,
        });
        if (result.kind === "ok") {
          await this.postResponse(
            envelope.requestId,
            result.status,
            filterResponseHeaders(result.headers),
            result.body,
          );
        } else {
          await this.postResponse(envelope.requestId, result.status, [
            ["content-type", "text/plain"],
            [TunnelMetaHeader.REASON, result.inkboxReason],
          ], Buffer.from(result.inkboxReason));
        }
        return;
      }
      // No HTTP path configured — should be impossible if connect()
      // validation is correct, but defend.
      await this.postResponse(envelope.requestId, 501, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "no-http-handler"],
      ], Buffer.from("no http handler"));
    } finally {
      if (deadlineHandle !== null) clearTimeout(deadlineHandle);
    }
  }

  private async materializeBody(envelope: Envelope): Promise<Envelope> {
    if (envelope.body.length > this.maxInbound) {
      throw new BodyTooLargeError();
    }
    if (envelope.bodyUri === null) return envelope;
    const resp = await fetch(envelope.bodyUri);
    if (!resp.ok) {
      throw new Error(
        `inkbox-body-uri GET returned ${resp.status}`,
      );
    }
    const reader = resp.body?.getReader();
    if (!reader) {
      return { ...envelope, body: Buffer.alloc(0) };
    }
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > this.maxInbound) throw new BodyTooLargeError();
      chunks.push(chunk);
    }
    return { ...envelope, body: Buffer.concat(chunks, total) };
  }

  // --- WS dispatch -------------------------------------------------------

  private async dispatchWsUpgrade(envelope: Envelope): Promise<void> {
    if (envelope.wsId === null) {
      await this.postResponse(envelope.requestId, 400, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "missing-ws-id"],
      ], Buffer.from("missing ws_id"));
      return;
    }
    // Path-traversal guard. Edge WS upgrades skip dispatchHttp's
    // validateEnvelopePath check, so apply it here too.
    const reject = validateEnvelopePath(envelope.path);
    if (reject !== null) {
      await this.postResponse(envelope.requestId, 400, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, reject],
      ], Buffer.from("invalid path"));
      return;
    }
    // URL forward — bridge to the upstream WS via h1 Upgrade.
    if (
      this.dispatch.wsHandler === undefined &&
      this.dispatch.forwardTo !== undefined
    ) {
      await this.dispatchWsUpgradeToUrl(envelope, this.dispatch.forwardTo);
      return;
    }
    if (this.dispatch.wsHandler === undefined) {
      // No URL upstream and no in-process WS handler — reject 501.
      await this.postResponse(envelope.requestId, 501, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "ws-not-supported"],
      ], Buffer.from("ws upgrade not supported"));
      return;
    }

    const acceptDeadlineMs = (this.responseDeadlineSeconds ?? 30) * 1000;
    const bridge = await this.openWsBridge(envelope);

    try {
      await dispatchWsUpgradeInProcess({
        envelope,
        handler: this.dispatch.wsHandler,
        publicHost: this.publicHost,
        acceptDeadlineMs,
        bridge: bridge.io,
      });
    } finally {
      bridge.cleanup();
    }
  }

  private async dispatchWsUpgradeToUrl(
    envelope: Envelope,
    forwardTo: string,
  ): Promise<void> {
    // Open the upstream WS hop. On failure, surface the upstream-style
    // status back to the third party so the client sees a clean
    // non-101 instead of hanging.
    const { openWsUpstream, WsUpstreamError } = await import(
      "./_ws_url_bridge.js"
    );
    const headersList: Array<[string, string]> = [
      ...envelope.forwardedHeaders,
    ];
    let subprotocol: string | null = null;
    for (const [k, v] of envelope.forwardedHeaders) {
      if (k.toLowerCase() === "sec-websocket-protocol") {
        subprotocol = v;
      }
    }
    let upstream: Awaited<ReturnType<typeof openWsUpstream>>;
    // Bound the upstream handshake by the same clock the server uses
    // for the third-party reply. If response_deadline_seconds is
    // smaller than the helper default, posting a stale reject after
    // the server already 504'd would just be wasted work.
    // Floor at 1ms (not 1s) — sub-second response deadlines are valid
    // and must be honored. Earlier shape clamped 0.1s up to 1s.
    const handshakeTimeoutMs =
      this.responseDeadlineSeconds !== null
        ? Math.max(1, this.responseDeadlineSeconds * 1000)
        : undefined;
    try {
      upstream = await openWsUpstream({
        forwardTo: new URL(forwardTo),
        publicHost: this.publicHost,
        verifyTls: this.forwardToVerifyTls,
        caBundle: this.forwardToCaBundle,
        requestPath: envelope.path,
        requestHeaders: headersList,
        wsSubprotocol: subprotocol,
        forwardedForIp: envelope.forwardedForIp,
        handshakeTimeoutMs,
      });
    } catch (e) {
      const status = e instanceof WsUpstreamError ? e.status : 502;
      await this.postResponse(envelope.requestId, status, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "ws-upstream-failed"],
      ], Buffer.from("upstream ws upgrade failed"));
      return;
    }

    // Forward the upstream's 101 response headers to the third party.
    // Application-defined headers (Set-Cookie, X-Use-Inkbox-* opt-out
    // flags, custom correlation IDs) live here; customers expect them
    // to round-trip. Strip:
    //   * hop-by-hop (connection, upgrade, transfer-encoding, ...)
    //   * ws handshake-control headers — these are per-hop. The
    //     tunnel server recomputes sec-websocket-accept against the
    //     third party's key. sec-websocket-key/version are
    //     request-only; sec-websocket-extensions is already gated
    //     above (we 502 if upstream confirmed one).
    //   * h2 pseudo-headers (defensive).
    const wsHandshakeStrip = new Set([
      "sec-websocket-accept",
      "sec-websocket-extensions",
      "sec-websocket-key",
      "sec-websocket-version",
    ]);
    const upgradeReplyHeaders: Array<[string, string]> = [];
    for (const [hk, hv] of upstream.headers) {
      if (hk.startsWith(":")) continue;
      if (HOP_BY_HOP_RESPONSE.has(hk)) continue;
      if (wsHandshakeStrip.has(hk)) continue;
      upgradeReplyHeaders.push([hk, hv]);
    }

    const bridge = await this.openWsBridge(envelope);
    try {
      // postUpgradeReply both posts the 200 AND opens the inkbox bridge
      // CONNECT stream — skipping it (an earlier draft did) leaves
      // connectStreamId null so recv() returns immediately and sendFrame
      // throws "bridge stream not open". Pump runs against a real bridge.
      await bridge.io.postUpgradeReply(upgradeReplyHeaders);
    } catch (e) {
      try {
        upstream.socket.destroy();
      } catch {
        /* swallow */
      }
      bridge.cleanup();
      // postUpgradeReply may have already posted 200 before failing on
      // the bridge open; no good way to retract the 200, so just log.
      // eslint-disable-next-line no-console
      console.warn(
        `ws bridge open failed after upstream 101 request_id=${envelope.requestId}`,
        e,
      );
      return;
    }
    const { pumpWsUrlEdgeBridge } = await import(
      "./_ws_url_edge_bridge.js"
    );
    try {
      await pumpWsUrlEdgeBridge({
        upstream,
        bridge: bridge.io,
      });
    } finally {
      try {
        upstream.socket.destroy();
      } catch {
        /* swallow */
      }
      // End the bridge stream too so the server-side knows we're done
      // (esp. on the abrupt-upstream-close path where the pump exits
      // before either peer sent CLOSE).
      try {
        await bridge.io.closeStream();
      } catch {
        /* swallow */
      }
      bridge.cleanup();
    }
  }

  private async openWsBridge(
    envelope: Envelope,
  ): Promise<{ io: WsBridgeIO; cleanup: () => void }> {
    const wsId = envelope.wsId!;
    const requestId = envelope.requestId;
    let connectStreamId: number | null = null;
    let bridgeStream: ClientHttp2Stream | null = null;

    // Pair every successful openStream() inside postUpgradeReply with
    // a guaranteed close on failure paths. Without it, a timeout /
    // non-200 / end-before-headers leaves the h2 stream half-open
    // server-side until the session GOAWAYs. Callers only see the
    // throw and call ``cleanup``, which is local-bookkeeping only.
    const abortBridgeStream = (): void => {
      if (bridgeStream !== null) {
        try {
          bridgeStream.close(http2.constants.NGHTTP2_CANCEL);
        } catch {
          /* swallow */
        }
      }
    };

    const postUpgradeReply = async (
      headers: Array<[string, string]>,
    ): Promise<void> => {
      await this.postResponse(requestId, 200, headers, Buffer.alloc(0));
      // Open the extended-CONNECT bridge stream after the upgrade reply.
      const connectHeaders: http2.OutgoingHttpHeaders = {
        [HTTP2_HEADER_METHOD]: "CONNECT",
        [HTTP2_HEADER_SCHEME]: "https",
        [HTTP2_HEADER_AUTHORITY]: this.zone,
        [HTTP2_HEADER_PATH]: `${ControlPaths.WS_PREFIX}${wsId}`,
        // RFC 8441 extended CONNECT — Spike 1 verified Node 22 emits this.
        [":protocol"]: TunnelSubprotocol.WS,
        "sec-websocket-version": "13",
        [ControlHeaders.TUNNEL_ID]: this.tunnelId,
        [ControlHeaders.TUNNEL_SECRET]: this.secret,
        [TunnelMetaHeader.WS_ID]: wsId,
      };
      const opened = this.openStream(connectHeaders, { endStream: false });
      connectStreamId = opened.streamId;
      bridgeStream = opened.stream;
      this.bridgeStreamIds.add(connectStreamId);
      try {
        // Wait for the 200 on the bridge stream — bounded so a server
        // that never replies can't wedge the dispatch task after the
        // public side has already seen success. Mirrors Python's
        // _with_deadline + the TCP passthrough's
        // BRIDGE_STATUS_TIMEOUT_MS race.
        const ev = await Promise.race([
          this.nextEvent(connectStreamId),
          setTimeoutPromise(BRIDGE_STATUS_TIMEOUT_MS).then(
            () => "timeout" as const,
          ),
        ]);
        if (ev === "timeout") {
          throw new Error(
            "bridge stream did not return :status within deadline",
          );
        }
        if (ev === null || ev.kind !== "headers") {
          throw new Error("bridge stream closed before headers");
        }
        const status = ev.headers.find(
          ([k]) => k === HTTP2_HEADER_STATUS,
        )?.[1];
        if (status !== "200") {
          throw new Error(`bridge stream returned ${status}`);
        }
      } catch (e) {
        // Best-effort cancel of the just-opened h2 stream so it
        // doesn't sit half-open server-side. Re-throw so the caller
        // still sees the failure and tears down the public side.
        abortBridgeStream();
        throw e;
      }
    };

    const rejectUpgrade = async (
      status: number,
      reason: string,
    ): Promise<void> => {
      await this.postResponse(requestId, status, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, reason],
      ], Buffer.from(reason));
    };

    const sendFrame = async (frame: Buffer): Promise<void> => {
      if (bridgeStream === null) throw new Error("bridge stream not open");
      await new Promise<void>((resolve, reject) => {
        bridgeStream!.write(frame, (err) => (err ? reject(err) : resolve()));
      });
    };

    const recv = (): AsyncIterableIterator<Buffer> => {
      const sid = () => connectStreamId;
      const self = this;
      return (async function* () {
        while (true) {
          const id = sid();
          if (id === null) return;
          const ev = await self.nextEvent(id);
          if (ev === null) return;
          if (ev.kind === "data") {
            yield ev.data;
          } else if (ev.kind === "end") {
            return;
          } else if (ev.kind === "reset") {
            throw new Error(`bridge stream reset code=${ev.code}`);
          }
        }
      })();
    };

    // Track whether the caller already requested a graceful close so
    // cleanup() doesn't convert it into RST_STREAM(CANCEL). h2 doesn't
    // mark ``bridgeStream.closed`` true until the remote also ends, so
    // looking at the JS-level state alone races against the server's
    // matching END_STREAM and would over-cancel every successful WSS
    // shutdown.
    let gracefullyClosed = false;
    const closeStream = async (): Promise<void> => {
      if (bridgeStream !== null) {
        gracefullyClosed = true;
        try {
          bridgeStream.end();
        } catch {
          /* swallow */
        }
      }
    };

    const cleanup = (): void => {
      // Cancel the h2 stream only if the caller didn't already
      // initiate a graceful close. ``postUpgradeReply`` handles its
      // own open-time failures separately; this branch only fires
      // when a mid-pump exception left the stream half-open without
      // a closeStream() call.
      if (
        bridgeStream !== null &&
        !gracefullyClosed &&
        !bridgeStream.closed &&
        !bridgeStream.destroyed
      ) {
        try {
          bridgeStream.close(http2.constants.NGHTTP2_CANCEL);
        } catch {
          /* swallow */
        }
      }
      if (connectStreamId !== null) {
        this.bridgeStreamIds.delete(connectStreamId);
        this.streams.delete(connectStreamId);
      }
    };

    return {
      io: { sendFrame, recv, closeStream, postUpgradeReply, rejectUpgrade },
      cleanup,
    };
  }

  // --- TCP-stream bridge (passthrough) ----------------------------------

  private async dispatchTcpStream(envelope: Envelope): Promise<void> {
    if (
      this.tlsTerminator === null ||
      (this.dispatch.forwardTo === undefined &&
        this.dispatch.httpHandler === undefined) ||
      envelope.tcpId === null
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `tcp-stream envelope received but passthrough not configured ` +
          `(tcp_id=${envelope.tcpId}); dropping`,
      );
      return;
    }
    const tcpId = envelope.tcpId;
    const sniHost = envelope.sniHost ?? "";

    // 1) Open the extended-CONNECT bridge stream.
    const connectHeaders: http2.OutgoingHttpHeaders = {
      [HTTP2_HEADER_METHOD]: "CONNECT",
      [HTTP2_HEADER_SCHEME]: "https",
      [HTTP2_HEADER_AUTHORITY]: this.zone,
      [HTTP2_HEADER_PATH]: `${ControlPaths.TCP_PREFIX}${tcpId}`,
      [":protocol"]: TunnelSubprotocol.TCP,
      "sec-websocket-version": "13",
      "sec-websocket-protocol": TunnelSubprotocol.TCP,
      [ControlHeaders.TUNNEL_ID]: this.tunnelId,
      [ControlHeaders.TUNNEL_SECRET]: this.secret,
      [TunnelMetaHeader.TCP_ID]: tcpId,
    };
    const { stream, streamId } = this.openStream(connectHeaders, {
      endStream: false,
    });
    this.bridgeStreamIds.add(streamId);

    // 2) Wait for status 200 with timeout.
    let openOk = false;
    try {
      const ev = await Promise.race([
        this.nextEvent(streamId),
        setTimeoutPromise(BRIDGE_STATUS_TIMEOUT_MS).then(() => "timeout"),
      ]);
      if (ev !== null && ev !== "timeout" && typeof ev !== "string" && ev.kind === "headers") {
        const status = ev.headers.find(([k]) => k === HTTP2_HEADER_STATUS)?.[1];
        openOk = status === "200";
      }
    } catch {
      openOk = false;
    }
    if (!openOk) {
      // eslint-disable-next-line no-console
      console.warn(`bridge open failed tcp_id=${tcpId}`);
      try {
        stream.close(http2.constants.NGHTTP2_CANCEL);
      } catch {
        /* swallow */
      }
      this.bridgeStreamIds.delete(streamId);
      this.streams.delete(streamId);
      return;
    }

    // 3) Build (or reuse) the passthrough dispatcher for this runtime.
    //    UpstreamUrlDispatch owns its own undici Pool; we share it across
    //    bridge streams. Closed in TunnelRuntime.aclose().
    if (this.passthroughDispatch === null) {
      const dispMod = await import("./_dispatch.js");
      if (this.dispatch.forwardTo !== undefined) {
        this.passthroughDispatch = new dispMod.UpstreamUrlDispatch({
          forwardTo: this.dispatch.forwardTo,
          publicHost: this.publicHost,
          maxOutboundBodyBytes: this.maxOutbound,
          maxInboundBodyBytes: this.maxInbound,
          verifyTls: this.forwardToVerifyTls,
          caBundle: this.forwardToCaBundle,
        });
      } else if (this.dispatch.httpHandler !== undefined) {
        this.passthroughDispatch = new dispMod.CallableDispatch({
          handler: this.dispatch.httpHandler,
          wsHandler: this.dispatch.wsHandler,
          publicHost: this.publicHost,
          maxOutboundBodyBytes: this.maxOutbound,
        });
      } else {
        // Defensive: dispatchTcpStream's early guard already requires
        // at least one of these to be set.
        // eslint-disable-next-line no-console
        console.warn("passthrough dispatch has neither forwardTo nor handler");
        return;
      }
    }
    const dispatchImpl = this.passthroughDispatch;

    // 4) Run the inbound + outbound pumps.
    const stats = makeBridgeStats(tcpId, streamId, sniHost);
    const session: TlsSession = this.tlsTerminator.session();
    let tlsClosed = false;
    let closeReason = "clean-eof";
    const tlsTail = async (): Promise<Buffer> => {
      if (tlsClosed) return Buffer.alloc(0);
      tlsClosed = true;
      try {
        return await session.close();
      } catch {
        return Buffer.alloc(0);
      }
    };

    const sendFrame = async (
      opcode: number,
      payload: Buffer,
      endStream = false,
    ): Promise<void> => {
      await this.writeBridgeFrame(
        stream,
        encodeWsFrame(opcode, payload, { mask: true }),
        endStream,
      );
    };

    const inboundDone = { value: false };
    const outboundDone = { value: false };

    // Plaintext adapter — picked once after the TLS handshake reports
    // an ALPN protocol. Held inside an object so TypeScript's
    // control-flow analysis doesn't narrow it to `never` across the
    // closures that read and write it.
    type PlaintextAdapter =
      | import("./_h1_server.js").InProcH1ParserPlaintext
      | import("./_h2_transcode.js").H2TranscoderPlaintext;
    const adapterHolder: { value: PlaintextAdapter | null } = { value: null };
    const adapterReady = (() => {
      let resolveFn!: () => void;
      const p = new Promise<void>((r) => (resolveFn = r));
      return { promise: p, resolve: resolveFn };
    })();

    const buildAdapter = async (
      alpn: string | false | null,
    ): Promise<PlaintextAdapter> => {
      if (alpn === "h2") {
        const mod = await import("./_h2_transcode.js");
        return new mod.H2TranscoderPlaintext({
          dispatch: dispatchImpl,
          maxInboundBodyBytes: this.maxInbound,
          forwardedForIp: null,
          sniHost: sniHost || null,
        });
      }
      // Default to h1 parser for "http/1.1", null/false, or anything
      // else (defensive — unknown ALPN gets the parser path).
      const mod = await import("./_h1_server.js");
      return new mod.InProcH1ParserPlaintext({
        dispatch: dispatchImpl,
        maxInboundBodyBytes: this.maxInbound,
        forwardedForIp: null,
        sniHost: sniHost || null,
      });
    };

    // Outbound: TLS-wrap the adapter's plaintext and emit as WS BINARY.
    const sendPlaintext = async (plaintext: Buffer): Promise<void> => {
      if (plaintext.length === 0) return;
      const encrypted = await session.send(plaintext);
      if (encrypted.length > 0) {
        await sendFrame(WS_OPCODE_BINARY, encrypted);
        stats.outboundFrames += 1;
        stats.encryptedBytes += encrypted.length;
      }
    };

    const inbound = async (): Promise<void> => {
      const frameDecoder = new WsFrameDecoder();
      let pendingFrags: Buffer | null = null;
      try {
        while (true) {
          const ev = await this.nextEvent(streamId);
          if (ev === null) return;
          if (ev.kind === "end") return;
          if (ev.kind === "reset") {
            throw new BridgeStreamReset("inbound stream reset");
          }
          if (ev.kind !== "data") continue;
          const frames = frameDecoder.feed(ev.data);
          for (const frame of frames) {
            if (frame.opcode === WS_OPCODE_PING) {
              await sendFrame(WS_OPCODE_PONG, frame.payload);
              continue;
            }
            if (frame.opcode === WS_OPCODE_CLOSE) return;
            if (frame.opcode === WS_OPCODE_PONG) continue;
            if (frame.opcode === WS_OPCODE_TEXT) {
              throw new BridgeProtocolError("unexpected TEXT frame");
            }
            if (frame.opcode === WS_OPCODE_CONTINUATION) {
              if (pendingFrags === null) {
                throw new BridgeProtocolError("continuation without start frame");
              }
              pendingFrags = Buffer.concat([pendingFrags, frame.payload]);
              stats.continuationFrames += 1;
            } else if (frame.opcode === WS_OPCODE_BINARY) {
              if (pendingFrags !== null) {
                throw new BridgeProtocolError(
                  "new BINARY frame while fragmented msg open",
                );
              }
              pendingFrags = frame.payload;
            } else {
              throw new BridgeProtocolError(
                `unexpected opcode 0x${frame.opcode.toString(16)}`,
              );
            }
            if (!frame.fin) continue;
            const chunk = pendingFrags!;
            pendingFrags = null;
            const { plaintext, encryptedToSend } = await session.feed(chunk);
            if (encryptedToSend.length > 0) {
              await sendFrame(WS_OPCODE_BINARY, encryptedToSend);
              stats.outboundFrames += 1;
              stats.encryptedBytes += encryptedToSend.length;
            }
            // Build the plaintext adapter on first handshake-complete OR
            // first plaintext byte. Plaintext can only flow after the
            // handshake is materially done (Node's TLS layer can't
            // decrypt application data otherwise), but the
            // ``secureConnect`` event that flips ``handshakeDone``
            // sometimes lands a tick later than ``feed()`` returns —
            // gating only on the flag drops the very first request.
            if (
              adapterHolder.value === null &&
              (session.handshakeDone || plaintext.length > 0)
            ) {
              const alpn = (session as unknown as {
                tlsSocket?: { alpnProtocol?: string | false | null };
              }).tlsSocket?.alpnProtocol ?? null;
              adapterHolder.value = await buildAdapter(alpn);
              adapterReady.resolve();
            }
            if (adapterHolder.value !== null) {
              for (const pt of plaintext) {
                await adapterHolder.value.feed(pt);
              }
            }
            stats.inboundFrames += 1;
            stats.decryptedBytes += plaintext.reduce((a, b) => a + b.length, 0);
            if (!stats.tlsHandshakeDone && session.handshakeDone) {
              stats.tlsHandshakeDone = true;
            }
          }
        }
      } finally {
        inboundDone.value = true;
      }
    };

    const outbound = async (): Promise<void> => {
      try {
        // Wait for the adapter to be picked (post-handshake), then run
        // its outbound pump until the adapter closes.
        await adapterReady.promise;
        if (adapterHolder.value !== null) {
          await adapterHolder.value.pumpOutbound(sendPlaintext);
        }
        const tail = await tlsTail();
        if (tail.length > 0) await sendFrame(WS_OPCODE_BINARY, tail);
      } finally {
        outboundDone.value = true;
      }
    };

    const inTask = inbound();
    const outTask = outbound();

    try {
      // Wait for either pump to complete.
      await Promise.race([
        inTask.catch((err) => {
          if (err instanceof BridgeProtocolError) closeReason = "protocol-error";
          else if (err instanceof BridgeStreamReset) closeReason = "inbound-error";
          else closeReason = "inbound-error";
          throw err;
        }),
        outTask.catch((err) => {
          closeReason = "outbound-error";
          throw err;
        }),
      ]).catch(() => undefined);

      // Asymmetric close grace: if outbound finished cleanly, cancel
      // inbound; otherwise let outbound drain for HALF_CLOSE_GRACE.
      if (outboundDone.value && !inboundDone.value) {
        await Promise.race([
          inTask,
          setTimeoutPromise(BRIDGE_HALF_CLOSE_GRACE_MS),
        ]).catch(() => undefined);
      } else if (inboundDone.value && !outboundDone.value) {
        // Inbound finished — close the adapter so the outbound pump
        // exits, then wait briefly for outbound to drain.
        if (adapterHolder.value !== null) {
          try {
            await adapterHolder.value.aclose();
          } catch {
            /* swallow */
          }
        }
        await Promise.race([
          outTask,
          setTimeoutPromise(BRIDGE_HALF_CLOSE_GRACE_MS).then(() => {
            closeReason = "cancelled";
          }),
        ]).catch(() => undefined);
      }
    } finally {
      // Cleanup: TLS tail, CLOSE frame, drain socket.
      const tail = await tlsTail();
      if (tail.length > 0) {
        try {
          await Promise.race([
            sendFrame(WS_OPCODE_BINARY, tail),
            setTimeoutPromise(BRIDGE_CLEANUP_SEND_TIMEOUT_MS),
          ]);
        } catch {
          /* swallow */
        }
      }
      const wsCloseCode = BRIDGE_CLOSE_CODE[closeReason] ?? 1011;
      const reasonBytes = Buffer.from(closeReason, "utf-8").subarray(0, 123);
      const closePayload = Buffer.alloc(2 + reasonBytes.length);
      closePayload.writeUInt16BE(wsCloseCode, 0);
      reasonBytes.copy(closePayload, 2);
      stats.closeReason = closeReason;
      try {
        await Promise.race([
          sendFrame(WS_OPCODE_CLOSE, closePayload, true),
          setTimeoutPromise(BRIDGE_CLEANUP_SEND_TIMEOUT_MS),
        ]);
      } catch {
        /* swallow */
      }
      // Close the per-bridge plaintext adapter. The shared
      // UpstreamUrlDispatch lives on the runtime and is closed in aclose().
      if (adapterHolder.value !== null) {
        try {
          await adapterHolder.value.aclose();
        } catch {
          /* swallow */
        }
      }
      this.bridgeStreamIds.delete(streamId);
      this.streams.delete(streamId);
    }
  }

  private writeBridgeFrame(
    stream: ClientHttp2Stream,
    frame: Buffer,
    endStream = false,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      stream.write(frame, (err) => {
        if (err) {
          reject(err);
          return;
        }
        if (endStream) {
          try {
            stream.end();
          } catch {
            /* swallow */
          }
        }
        resolve();
      });
    });
  }

  // --- response posting --------------------------------------------------

  private async postResponse(
    requestId: string,
    status: number,
    userHeaders: Array<[string, string]>,
    body: Buffer,
  ): Promise<void> {
    const reqHeaders: http2.OutgoingHttpHeaders = {
      [HTTP2_HEADER_METHOD]: "POST",
      [HTTP2_HEADER_SCHEME]: "https",
      [HTTP2_HEADER_AUTHORITY]: this.zone,
      [HTTP2_HEADER_PATH]: `${ControlPaths.RESPONSE_PREFIX}${requestId}`,
      [ControlHeaders.TUNNEL_ID]: this.tunnelId,
      [ControlHeaders.TUNNEL_SECRET]: this.secret,
      [TunnelMetaHeader.STATUS]: String(status),
      [TunnelMetaHeader.REQUEST_ID]: requestId,
      "content-length": String(body.length),
    };
    for (const [k, v] of userHeaders) {
      const kl = k.toLowerCase();
      if (kl === "content-length" || kl === "transfer-encoding") continue;
      // The reason meta header is already top-level; pass through the
      // forwarded-h-* prefix for the rest. The spec allows multiple
      // values per name; flatten by appending under indexed keys.
      const targetKey = `${INKBOX_FORWARDED_HEADER_PREFIX}${kl}`;
      const existing = reqHeaders[targetKey];
      if (existing === undefined) {
        reqHeaders[targetKey] = v;
      } else if (Array.isArray(existing)) {
        existing.push(v);
      } else {
        reqHeaders[targetKey] = [String(existing), v];
      }
      // The TunnelMetaHeader.REASON is also forwarded above as
      // `inkbox-h-inkbox-reason` — that's OK since it's also surfaced
      // top-level via the `[STATUS, REASON]` tuple Python attaches.
      // Match Python's behavior exactly: any user header whose name
      // overlaps a reserved meta key is passed through under the h-
      // prefix.
      if (kl === TunnelMetaHeader.REASON) {
        reqHeaders[TunnelMetaHeader.REASON] = v;
      }
    }
    const { streamId, stream } = this.openStream(reqHeaders, {
      endStream: body.length === 0,
    });
    if (body.length > 0) {
      await new Promise<void>((resolve, reject) => {
        stream.write(body, (err) => (err ? reject(err) : resolve()));
      });
      await new Promise<void>((resolve) => {
        stream.end(() => resolve());
      });
    }
    // Best-effort: wait briefly for the response status, but don't
    // block forever; cleanup either way.
    try {
      await Promise.race([
        this.awaitResponse(streamId),
        setTimeoutPromise(30_000),
      ]);
    } finally {
      this.streams.delete(streamId);
    }
  }

  // --- utilities ---------------------------------------------------------

  private notifyStatus(status:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "closed"): void {
    if (this.onStatus !== undefined) {
      try {
        this.onStatus(status);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("on_status callback raised", err);
      }
    }
  }
}

class BodyTooLargeError extends Error {
  constructor() {
    super("body too large");
    this.name = "BodyTooLargeError";
  }
}

// Placeholder to keep the file aware of the WS frame opcodes — used by
// the WS bridge IO when it calls back into the runtime's frame helpers.
// (kept for future export wiring; explicit imports above).
void WS_OPCODE_BINARY;
void WS_OPCODE_CLOSE;
void WS_OPCODE_PING;
void WS_OPCODE_PONG;
void WsFrameDecoder;
void encodeWsEnvelope;
void encodeWsFrame;

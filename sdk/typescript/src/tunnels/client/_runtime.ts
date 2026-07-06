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
import {
  dispatchHttpInProcess,
  type InkboxHandler,
  type InProcessHttpResult,
} from "./_handler.js";
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
  WsServerDraining,
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
// On drain, keep a post-GOAWAY connection alive for its in-flight bridges
// up to this long, then force it closed. Bounds the handoff tail.
export const DRAINING_CONNECTION_CLOSE_TIMEOUT_MS = 90_000;
// Budget for re-dialing the replacement connection during a handoff (the
// server may bounce the first hello while it drains). Must stay below the
// close timeout so a stuck handoff still resolves.
export const HANDOFF_REDIAL_BUDGET_MS = 30_000;
// Minimum spacing between handoffs. A real drain rollout spaces GOAWAYs
// seconds apart per task; this rate-limit keeps a stray/rapid GOAWAY from
// chaining handoffs in a tight loop (e.g. a fresh conn signalled at once).
export const HANDOFF_SETTLE_MS = 2_000;
// How long an HTTP reply waits for an in-flight handoff to publish the new
// active connection before giving up (the server response deadline + the
// third-party retry recover a dropped reply).
export const POST_ACTIVE_WAIT_MS = 5_000;

export const DEFAULT_INBOUND_BODY_BYTES = 32 * 1024 * 1024;
export const DEFAULT_OUTBOUND_BODY_BYTES = 32 * 1024 * 1024;

// Signals that another client connected to this tunnel and took over: this
// client must stop and not reconnect. Delivered as a dedicated GOAWAY error
// code (the reliable channel) plus matching reason strings on the GOAWAY debug
// data and the intake / hello responses. Must stay in lockstep with the server.
export const SUPERSEDED_GOAWAY_ERROR_CODE = 0x1201;
export const GOAWAY_REASON_SUPERSEDED = "superseded";
export const INTAKE_REASON_SUPERSEDED = "intake-superseded";
export const HELLO_REASON_SUPERSEDED = "hello-superseded";

export class TunnelAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelAuthError";
  }
}

export class TunnelSupersededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TunnelSupersededError";
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

/** Extract a ``reason`` string from a JSON ``{"reason": ...}`` payload. */
function parseReasonJson(buf: Buffer | undefined | null): string | null {
  if (buf === undefined || buf === null || buf.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(buf.toString("utf-8"));
    if (typeof parsed === "object" && parsed !== null) {
      const reason = (parsed as { reason?: unknown }).reason;
      if (typeof reason === "string") return reason;
    }
  } catch {
    return null;
  }
  return null;
}

export type StatusCallback = (
  status: "connecting" | "connected" | "reconnecting" | "closed" | "superseded",
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
  /** API key used to authenticate against the data-plane (x-api-key header). */
  apiKey: string;
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
 * One persistent h2 connection's state. The runtime holds a single
 * `active` Connection (the pool that parks new intakes) plus zero-or-more
 * `draining` ones during a make-before-break handoff. State is
 * per-connection because two live h2 sessions each allocate stream ids
 * 1,3,5… — a shared streams map would collide across them.
 */
class Connection {
  session: ClientHttp2Session | null = null;
  ownerToken: string | null = null;
  serverPoolSize: number | null = null;
  intakeIdleSeconds: number | null = null;
  responseDeadlineSeconds: number | null = null;
  // Stop parking new intakes once this conn has received GOAWAY.
  draining = false;
  // Set when this connection was taken over by another client.
  superseded = false;
  readonly streams = new Map<number, StreamBus>();
  readonly bridgeStreamIds = new Set<number>();
  pingHandle: NodeJS.Timeout | null = null;
  pingAbort: AbortController | null = null;

  constructor(readonly id: number) {}

  /** Live WS/TCP bridge count — drives the drain-quiescent check. */
  get liveBridges(): number {
    return this.bridgeStreamIds.size;
  }
}

/**
 * The data-plane runtime. Construct with the bootstrap-derived
 * tunnelId/secret/zone/publicHost; call `serveForever()` to drive it,
 * `aclose()` to shut down.
 */
export class TunnelRuntime {
  private readonly tunnelId: string;
  private readonly apiKey: string;
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

  // The pool that parks new intakes. Swapped atomically on handoff.
  private active: Connection | null = null;
  // Post-GOAWAY connections finishing in-flight work before close.
  private readonly draining = new Set<Connection>();
  private nextConnId = 1;
  // True while a make-before-break handoff is dialing the replacement.
  private handoffInFlight = false;
  // When the last handoff began (rate-limit, see HANDOFF_SETTLE_MS).
  private lastHandoffAt = 0;
  // The in-flight handoff, so the supervisor can await it instead of
  // hot-spinning if the old session closes mid-dial.
  private handoffPromise: Promise<void> | null = null;
  // Resolves the supervisor's wait when the active conn is swapped.
  private wakeSupervisor: (() => void) | null = null;

  private stop = false;
  // Set when another client took over this tunnel: serveForever stops and does
  // not reconnect. Distinct from a transient drop or a drain.
  private superseded = false;
  // Dispatch tasks are runtime-scoped (not per-connection): a handoff must
  // let an in-flight handler finish and post its reply on the NEW conn.
  private readonly tasks = new Set<Promise<unknown>>();
  // Lazy: built on first passthrough TCP stream; closed in aclose().
  private passthroughDispatch: import("./_dispatch.js").Dispatch | null = null;
  // Cache of undici Agent instances for HTTPS URL-forward with TLS
  // overrides (verifyTls=false or caBundle set). Avoids constructing a
  // fresh Agent per request, which would leak sockets/timers. Closed
  // in aclose().
  private readonly undiciAgentCache: UndiciAgentCache = createUndiciAgentCache();
  private shutdownAbort: AbortController = new AbortController();

  constructor(opts: TunnelRuntimeOpts) {
    this.tunnelId = opts.tunnelId;
    this.apiKey = opts.apiKey;
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
        if (err instanceof TunnelSupersededError) {
          // eslint-disable-next-line no-console
          console.warn(
            "tunnel taken over: another client connected to this tunnel, so " +
              "this client is stopping and will not reconnect. If this is " +
              "unexpected, check for a second instance running the same " +
              "identity (only one live connection per tunnel is kept).",
          );
          this.notifyStatus("superseded");
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

  /** Graceful shutdown. Signals all loops to exit; closes every conn. */
  async aclose(): Promise<void> {
    this.stop = true;
    this.shutdownAbort.abort();
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
    // Close active + every draining conn; stop each one's ping loop so no
    // ping loop leaks across the handoff set.
    const conns = [this.active, ...this.draining].filter(
      (c): c is Connection => c !== null,
    );
    for (const conn of conns) {
      this.stopPingLoop(conn);
      await this.closeConnection(conn);
    }
  }

  /**
   * Emit GOAWAY then close/destroy a connection's session, bounded by a
   * short grace. The intake pool parks streams indefinitely, so a plain
   * `close()` would never resolve; we GOAWAY then destroy after 250ms.
   */
  private async closeConnection(conn: Connection): Promise<void> {
    const session = conn.session;
    conn.session = null;
    if (session === null || session.closed) return;
    try {
      session.goaway();
    } catch {
      /* swallow */
    }
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

  // --- per-connection lifecycle -----------------------------------------

  private async runOnce(): Promise<void> {
    const first = new Connection(this.nextConnId++);
    let conn = first;
    this.active = first;
    try {
      await this.openConnection(first);
      await this.sendHello(first);
      this.notifyStatus("connected");
      this.startServing(first);
      // Supervise the active connection. A GOAWAY handoff swaps in a new
      // active conn out-of-band; follow it without going through the
      // backoff loop. Only a cold death (active conn closed with no
      // successor) returns, so serveForever reconnects with backoff.
      while (!this.stop) {
        await this.waitCloseOrHandoff(conn);
        if (this.stop) break;
        // If a handoff is dialing the replacement, wait for it to resolve
        // before deciding — yields to the event loop so the dial's IO
        // isn't starved by re-racing an already-closed old session.
        if (this.handoffInFlight && this.handoffPromise !== null) {
          await this.handoffPromise;
        }
        const next = this.active;
        if (next !== null && next !== conn && !next.draining) {
          conn = next;
          continue;
        }
        const session = conn.session;
        if (session === null || session.closed || session.destroyed) break;
      }
      // Another client took over this tunnel: stop, do not reconnect.
      if (this.superseded) {
        throw new TunnelSupersededError(
          "another client connected to this tunnel; not reconnecting",
        );
      }
    } finally {
      this.stopPingLoop(conn);
      conn.streams.clear();
      conn.bridgeStreamIds.clear();
      conn.session = null;
      if (this.active === conn) this.active = null;
    }
  }

  /** Spawn a connection's intake pool + ping loop (cold open or handoff). */
  private startServing(conn: Connection): void {
    const effectivePool = conn.serverPoolSize ?? this.poolSize ?? 1;
    for (let slot = 0; slot < effectivePool; slot++) {
      // Fire-and-forget: each slot self-terminates when the conn closes
      // or starts draining.
      void this.intakeLoop(conn, slot).catch(() => undefined);
    }
    this.startPingLoop(conn);
  }

  /** Resolve once the supervised conn closes OR a handoff swaps active. */
  private waitCloseOrHandoff(conn: Connection): Promise<void> {
    const closed = new Promise<void>((resolve) => {
      const session = conn.session;
      if (session === null || session.closed) {
        resolve();
        return;
      }
      session.once("close", () => resolve());
    });
    const woken = new Promise<void>((resolve) => {
      this.wakeSupervisor = resolve;
    });
    return Promise.race([closed, woken]).finally(() => {
      this.wakeSupervisor = null;
    });
  }

  private signalSupervisor(): void {
    const w = this.wakeSupervisor;
    this.wakeSupervisor = null;
    if (w !== null) w();
  }

  // --- takeover (superseded) --------------------------------------------

  /**
   * True iff a takeover signal on `conn` should stop the runtime. Ignored on
   * a draining / handoff / non-active connection: that is this client's own
   * make-before-break predecessor being replaced, not an external takeover.
   */
  private supersededIsTerminal(conn: Connection): boolean {
    return (
      conn === this.active && !conn.draining && !this.handoffInFlight
    );
  }

  /** Record that `conn` was taken over; the supervisor will stop (no reconnect). */
  private markSuperseded(conn: Connection): void {
    conn.superseded = true;
    this.superseded = true;
  }

  /**
   * Classify a non-zero GOAWAY: takeover (terminal) vs infra fault (reconnect).
   * The dedicated code is authoritative; the reason is a belt cross-check.
   */
  private maybeMarkSupersededGoaway(
    conn: Connection,
    errorCode: number,
    opaqueData: Buffer | undefined,
  ): void {
    const reason = parseReasonJson(opaqueData);
    const isTakeover =
      errorCode === SUPERSEDED_GOAWAY_ERROR_CODE ||
      reason === GOAWAY_REASON_SUPERSEDED;
    if (!isTakeover) {
      if (reason === null) {
        // eslint-disable-next-line no-console
        console.warn(
          `tunnel runtime: non-zero GOAWAY (code=${errorCode}) without a reason; reconnecting`,
        );
      }
      return;
    }
    if (!this.supersededIsTerminal(conn)) {
      // eslint-disable-next-line no-console
      console.info("tunnel runtime: takeover signal on a draining/handoff connection; ignoring");
      return;
    }
    this.markSuperseded(conn);
  }

  // --- make-before-break handoff ----------------------------------------

  /**
   * On a NO_ERROR GOAWAY, mark the old conn draining and stand up a fresh
   * connection before closing it. In-band: never trips the backoff loop.
   */
  private beginHandoff(oldConn: Connection): void {
    if (
      this.stop ||
      oldConn.draining ||
      this.active !== oldConn ||
      this.handoffInFlight ||
      Date.now() - this.lastHandoffAt < HANDOFF_SETTLE_MS
    ) {
      return;
    }
    this.handoffInFlight = true;
    this.lastHandoffAt = Date.now();
    oldConn.draining = true;
    this.draining.add(oldConn);
    // Stop the draining conn's ping loop: it's expected to close, and we
    // don't want two ping loops racing across the handoff set.
    this.stopPingLoop(oldConn);
    this.handoffPromise = this.runHandoff(oldConn);
  }

  private async runHandoff(oldConn: Connection): Promise<void> {
    try {
      const newConn = await this.makeReplacementConnection();
      this.active = newConn;
      // Supervisor was watching oldConn; wake it to follow newConn.
      this.signalSupervisor();
    } catch (err) {
      // Redial budget exhausted (or auth failure): give up on
      // make-before-break and fall to the cold reconnect path by forcing
      // the old session closed so the supervisor returns.
      // eslint-disable-next-line no-console
      console.warn("tunnel runtime: handoff failed; reconnecting cold", err);
      try { oldConn.session?.destroy(); } catch { /* swallow */ }
      this.signalSupervisor();
    } finally {
      this.handoffInFlight = false;
      this.handoffPromise = null;
      // Close the old conn once its bridges finish (or the deadline hits).
      void this.drainOldConnection(oldConn);
    }
  }

  /** Dial + hello + park a replacement, retrying transient hello failures. */
  private async makeReplacementConnection(): Promise<Connection> {
    let backoff = 0.1;
    const start = Date.now();
    while (!this.stop) {
      const conn = new Connection(this.nextConnId++);
      try {
        await this.openConnection(conn);
        await this.sendHello(conn);
        this.startServing(conn);
        return conn;
      } catch (err) {
        try { await this.closeConnection(conn); } catch { /* swallow */ }
        if (err instanceof TunnelAuthError) throw err;
        if (Date.now() - start > HANDOFF_REDIAL_BUDGET_MS) {
          throw new Error("handoff redial budget exhausted");
        }
        // A drain 503 on the new hello means the NLB landed us back on the
        // draining task; back off (jittered) so it re-routes us elsewhere.
        const jitter = backoff * BACKOFF_JITTER * (2 * this.rng() - 1);
        await setTimeoutPromise(Math.max(50, (backoff + jitter) * 1000), undefined, {
          signal: this.shutdownAbort.signal,
        }).catch(() => undefined);
        backoff = Math.min(backoff * 2, 5.0);
      }
    }
    throw new Error("runtime stopped during handoff");
  }

  /** Wait for a draining conn's bridges to finish, then close it. */
  private async drainOldConnection(oldConn: Connection): Promise<void> {
    const deadline = Date.now() + DRAINING_CONNECTION_CLOSE_TIMEOUT_MS;
    // Node keeps existing streams running after a NO_ERROR GOAWAY, so let
    // live WS/TCP bridges finish until they drain or the deadline hits.
    while (oldConn.liveBridges > 0 && Date.now() < deadline && !this.stop) {
      await setTimeoutPromise(250).catch(() => undefined);
    }
    await this.closeConnection(oldConn);
    oldConn.streams.clear();
    oldConn.bridgeStreamIds.clear();
    this.draining.delete(oldConn);
  }

  private async openConnection(conn: Connection): Promise<void> {
    const authority = `https://${this.zone}`;
    const session = this.http2Connect(authority, {
      ALPNProtocols: ["h2"],
      // Note: we deliberately do NOT set ENABLE_CONNECT_PROTOCOL on
      // local settings. Per RFC 8441 §3 that setting is server-to-
      // client; Python sets it as a hyper-h2 library validator
      // workaround. Node http2 either accepts `:protocol` or doesn't
      // (Spike 1) — the setting line doesn't translate.
    });
    conn.session = session;
    session.on("close", () => {
      // eslint-disable-next-line no-console
      console.info("tunnel runtime: h2 session closed");
      // Drain all open streams with a synthetic reset event so any
      // awaiters wake up.
      for (const [, bus] of conn.streams) {
        if (!bus.ended) {
          bus.events.push({ kind: "reset", code: 0 });
          bus.ended = true;
          this.wake(bus);
        }
      }
    });
    session.on("error", (err: Error) => {
      // Visibility into session-fatal errors. Stream-level errors
      // surface separately via stream events; this is genuinely
      // session-terminal.
      // eslint-disable-next-line no-console
      console.warn("tunnel runtime: h2 session error", err);
    });
    session.on(
      "goaway",
      (errorCode: number, lastStreamId: number, opaqueData?: Buffer) => {
        // eslint-disable-next-line no-console
        console.info(
          `tunnel runtime: GOAWAY received error_code=${errorCode} last_stream_id=${lastStreamId}`,
        );
        // NO_ERROR GOAWAY is the drain signal: stand up a fresh connection
        // make-before-break. A non-zero code is either a takeover (stop, don't
        // reconnect) or a real fault (reconnect cold) — classified below. Set
        // the takeover flag here so it wins over the 'error'/'close' reconnect
        // path, which the same GOAWAY also drives.
        if (errorCode === 0) {
          this.beginHandoff(conn);
        } else {
          this.maybeMarkSupersededGoaway(conn, errorCode, opaqueData);
        }
      },
    );
    // Watch the underlying TCP/TLS socket directly. Node's h2 client
    // sometimes loses the connection without emitting ``error`` or
    // ``close`` on the session itself — the underlying socket reliably
    // emits them. Force-destroy the session on either so
    // ``waitForSessionClose`` resolves promptly and ``serveForever``
    // reconnects without waiting for the ``PING_ACK_TIMEOUT_MS`` window.
    try {
      const sock = (session as unknown as { socket?: import("node:net").Socket }).socket;
      const onSocketDeath = (label: string, err?: Error): void => {
        // eslint-disable-next-line no-console
        console.info(
          `tunnel runtime: underlying socket ${label}` +
            (err !== undefined ? ` err=${err.message}` : ""),
        );
        if (!session.closed && !session.destroyed) {
          // Forensic — log the stack so we can see which path
          // triggered this destroy in production.
          // eslint-disable-next-line no-console
          console.warn(
            "tunnel runtime: forcing session.destroy() from socket-death",
            new Error("trace").stack,
          );
          try { session.destroy(); } catch { /* swallow */ }
        }
      };
      sock?.once?.("close", (hadError: boolean) => {
        onSocketDeath(`closed hadError=${hadError}`);
      });
      sock?.once?.("error", (err: Error) => {
        onSocketDeath("error", err);
      });
    } catch {
      /* swallow */
    }
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

  private waitForSessionClose(conn: Connection): Promise<void> {
    const session = conn.session;
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

  private async sendHello(conn: Connection): Promise<void> {
    conn.ownerToken = null;
    conn.serverPoolSize = null;
    conn.intakeIdleSeconds = null;
    conn.responseDeadlineSeconds = null;

    const helloHeaders: http2.OutgoingHttpHeaders = {
      [HTTP2_HEADER_METHOD]: "POST",
      [HTTP2_HEADER_SCHEME]: "https",
      [HTTP2_HEADER_AUTHORITY]: this.zone,
      [HTTP2_HEADER_PATH]: ControlPaths.HELLO,
      [ControlHeaders.TUNNEL_ID]: this.tunnelId,
      [ControlHeaders.API_KEY]: this.apiKey,
      "content-length": "0",
    };
    if (this.poolSize !== null) {
      helloHeaders[ControlHeaders.POOL_SIZE] = String(this.poolSize);
    }
    const stream = this.openStream(conn, helloHeaders, { endStream: true });
    const { status, body } = await this.awaitResponse(conn, stream.streamId);
    if (status === 401 || status === 403) {
      throw new TunnelAuthError(
        `${ControlPaths.HELLO} returned ${status}; the API key was rejected (check the key matches the tunnel's identity scope, or use an admin-scoped key in the tunnel's org)`,
      );
    }
    // Displaced during hello: another client won the race for this tunnel.
    // Terminal (stop, don't reconnect) so we don't redial and boot the client
    // that replaced us — unless this is our own draining/handoff predecessor.
    if (
      status === 409 &&
      parseReasonJson(body) === HELLO_REASON_SUPERSEDED
    ) {
      if (this.supersededIsTerminal(conn)) {
        this.superseded = true;
        throw new TunnelSupersededError(
          "another client connected to this tunnel during hello",
        );
      }
      throw new Error(`${ControlPaths.HELLO} 409 on a draining conn; will retry`);
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
    conn.ownerToken = ownerToken;
    if (typeof payload["default_pool_size"] === "number") {
      conn.serverPoolSize = payload["default_pool_size"] as number;
    }
    if (typeof payload["intake_idle_seconds"] === "number") {
      conn.intakeIdleSeconds = payload["intake_idle_seconds"] as number;
    }
    if (typeof payload["response_deadline_seconds"] === "number") {
      conn.responseDeadlineSeconds = payload[
        "response_deadline_seconds"
      ] as number;
    }
  }

  // --- stream helpers ----------------------------------------------------

  private openStream(
    conn: Connection,
    headers: http2.OutgoingHttpHeaders,
    opts: { endStream: boolean },
  ): { stream: ClientHttp2Stream; streamId: number } {
    const session = conn.session;
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
    conn.streams.set(streamId, bus);
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

  private async nextEvent(
    conn: Connection,
    streamId: number,
  ): Promise<StreamEvent | null> {
    const bus = conn.streams.get(streamId);
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
    conn: Connection,
    streamId: number,
  ): Promise<{ status: number; body: Buffer }> {
    const chunks: Buffer[] = [];
    let status = 0;
    let gotHeaders = false;
    while (true) {
      const ev = await this.nextEvent(conn, streamId);
      if (ev === null) {
        conn.streams.delete(streamId);
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
        conn.streams.delete(streamId);
        return { status, body: Buffer.concat(chunks) };
      }
    }
  }

  // --- intake pool -------------------------------------------------------

  private async intakeLoop(conn: Connection, slot: number): Promise<void> {
    while (
      !this.stop &&
      !conn.draining &&
      conn.session !== null &&
      !conn.session.closed
    ) {
      let envelope: Envelope | null;
      try {
        envelope = await this.parkOneIntake(conn, slot);
      } catch (err) {
        if (err instanceof TunnelSupersededError) {
          // Another client took over: force this conn down so the supervisor
          // observes the terminal flag and stops (no reconnect).
          this.markSuperseded(conn);
          try { conn.session?.destroy(); } catch { /* swallow */ }
          return;
        }
        if (err instanceof OwnerTokenInvalidError) {
          // eslint-disable-next-line no-console
          console.warn(
            `intake slot ${slot}: owner_token rejected; ` +
              `forcing session.destroy() and reconnecting`,
          );
          conn.session?.destroy();
          return;
        }
        if (isSessionTerminalError(err) || conn.session?.destroyed) {
          // The h2 session is gone — every subsequent openStream will
          // throw the same error. Don't retry-storm; exit the slot so
          // ``runOnce`` observes ``waitForSessionClose`` resolve and
          // ``serveForever`` reconnects. Same shape as Python's
          // ``_OwnerTokenInvalidError`` retry-storm fix in
          // ``_intake_loop``: distinguish terminal session errors
          // before the generic retry handler.
          // eslint-disable-next-line no-console
          console.warn(
            `intake slot ${slot}: h2 session terminal (` +
              `${(err as { code?: string })?.code ?? "no code"}); ` +
              `exiting slot`,
            err,
          );
          try { conn.session?.destroy(); } catch { /* swallow */ }
          return;
        }
        // eslint-disable-next-line no-console
        console.warn(`intake slot ${slot} transient error; retrying`, err);
        await setTimeoutPromise(250).catch(() => undefined);
        continue;
      }
      if (envelope === null) continue;
      // Fire-and-forget dispatch; tracked on the runtime (not the conn) so
      // an in-flight handler survives this conn draining and can post its
      // reply on the new active conn during a handoff.
      const task = this.dispatchEnvelope(conn, envelope).catch((err) => {
        // eslint-disable-next-line no-console
        console.warn(`dispatch failed request_id=${envelope!.requestId}`, err);
      });
      this.tasks.add(task);
      task.finally(() => this.tasks.delete(task));
    }
  }

  private async parkOneIntake(
    conn: Connection,
    slot: number,
  ): Promise<Envelope | null> {
    if (conn.ownerToken === null) {
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
      [ControlHeaders.OWNER_TOKEN]: conn.ownerToken,
      [ControlHeaders.POOL_SLOT]: String(slot),
      "content-length": "0",
    };
    const { streamId } = this.openStream(conn, headers, { endStream: true });
    let recvHeaders: Array<[string, string]> | null = null;
    const chunks: Buffer[] = [];
    while (true) {
      const ev = await this.nextEvent(conn, streamId);
      if (ev === null) {
        conn.streams.delete(streamId);
        return null;
      }
      if (ev.kind === "headers" && recvHeaders === null) {
        recvHeaders = ev.headers;
      } else if (ev.kind === "data") {
        chunks.push(ev.data);
      } else if (ev.kind === "end") {
        break;
      } else if (ev.kind === "reset") {
        conn.streams.delete(streamId);
        return null;
      }
    }
    conn.streams.delete(streamId);
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
      // Another client took over this tunnel. Terminal, unless this is our own
      // draining/handoff predecessor (a normal reconnect). A drain uses a
      // different reason and falls through to re-park below.
      if (reason === INTAKE_REASON_SUPERSEDED) {
        if (this.supersededIsTerminal(conn)) {
          throw new TunnelSupersededError(
            `slot=${slot}: another client connected to this tunnel`,
          );
        }
        return null;
      }
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

  private startPingLoop(conn: Connection): void {
    conn.pingAbort = new AbortController();
    conn.pingHandle = setInterval(() => {
      const session = conn.session;
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
            // eslint-disable-next-line no-console
            console.warn(
              "tunnel runtime: PING errored; forcing session.destroy()",
              err,
            );
            try { session.destroy(); } catch { /* swallow */ }
          }
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          "tunnel runtime: session.ping() threw synchronously; forcing destroy",
          err,
        );
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

  private stopPingLoop(conn: Connection): void {
    if (conn.pingHandle !== null) {
      clearInterval(conn.pingHandle);
      conn.pingHandle = null;
    }
    conn.pingAbort?.abort();
    conn.pingAbort = null;
  }

  // --- envelope dispatch -------------------------------------------------

  private async dispatchEnvelope(
    conn: Connection,
    envelope: Envelope,
  ): Promise<void> {
    if (envelope.routeKind === TunnelRouteKind.WS_UPGRADE) {
      try {
        await this.dispatchWsUpgrade(conn, envelope);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`ws dispatch failed request_id=${envelope.requestId}`, err);
      }
      return;
    }
    if (envelope.routeKind === TunnelRouteKind.TCP_STREAM) {
      // Passthrough TCP bridge — defer until M4 lands here.
      try {
        await this.dispatchTcpStream(conn, envelope);
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
      await this.dispatchHttp(conn, envelope);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(`dispatch failed request_id=${envelope.requestId}`, err);
      try {
        await this.postHttpResponse(conn, envelope.requestId, 500, [["content-type", "text/plain"]], Buffer.from("internal error"));
      } catch {
        /* swallow */
      }
    }
  }

  // --- HTTP dispatch -----------------------------------------------------

  private async dispatchHttp(conn: Connection, envelope: Envelope): Promise<void> {
    const reject = validateEnvelopePath(envelope.path);
    if (reject !== null) {
      await this.postHttpResponse(conn, envelope.requestId, 400, [
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
      await this.postHttpResponse(conn, envelope.requestId, status, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, reason],
      ], Buffer.from(reason));
      return;
    }

    const deadlineMs = (conn.responseDeadlineSeconds ?? 0) * 1000;
    const ctrl = new AbortController();
    let deadlineHandle: NodeJS.Timeout | null = null;
    // Sentinel resolved by the deadline timer — used as the loser side
    // of the Promise.race against the dispatch. We use a sentinel
    // (rather than rejecting) so the race resolves with a discriminable
    // outcome and the dispatch task can keep running in the background
    // while we surface a 504 to the server. Mirrors Python's
    // ``_with_deadline()`` semantics.
    const TIMEOUT = Symbol("dispatch-deadline-exceeded");
    type Timeout = typeof TIMEOUT;
    let deadlinePromise: Promise<Timeout> = new Promise(() => {});
    if (deadlineMs > 0) {
      deadlinePromise = new Promise<Timeout>((resolve) => {
        deadlineHandle = setTimeout(() => {
          ctrl.abort();
          resolve(TIMEOUT);
        }, deadlineMs);
      });
    }

    const dispatchPromise = (async (): Promise<
      | { kind: "in-process"; result: InProcessHttpResult }
      | { kind: "url-forward"; result: ForwardResult }
      | { kind: "no-handler" }
    > => {
      if (this.dispatch.httpHandler !== undefined) {
        const inProcess = await dispatchHttpInProcess({
          envelope: materialized,
          handler: this.dispatch.httpHandler,
          publicHost: this.publicHost,
          maxResponseBytes: this.maxOutbound,
          signal: ctrl.signal,
        });
        return { kind: "in-process", result: inProcess };
      }
      if (this.dispatch.forwardTo !== undefined) {
        const result = await forwardEnvelopeToUrl({
          envelope: materialized,
          forwardTo: this.dispatch.forwardTo,
          publicHost: this.publicHost,
          maxResponseBytes: this.maxOutbound,
          signal: ctrl.signal,
          verifyTls: this.forwardToVerifyTls,
          caBundle: this.forwardToCaBundle,
          agentCache: this.undiciAgentCache,
        });
        return { kind: "url-forward", result };
      }
      return { kind: "no-handler" };
    })();

    try {
      const outcome =
        deadlineMs > 0
          ? await Promise.race([dispatchPromise, deadlinePromise])
          : await dispatchPromise;
      if (outcome === TIMEOUT) {
        // Hard deadline tripped: post 504 immediately. The dispatch
        // promise keeps running in the background — its eventual
        // result is discarded by the no-op handler attached below.
        // Without this race, a handler that ignores ``ctx.signal`` or
        // hangs on a body stream would keep the SDK task alive past
        // the server-side deadline, and a late ``postResponse`` would
        // target a request the tunnel server has already 504'd.
        dispatchPromise.catch(() => undefined);
        await this.postHttpResponse(conn, envelope.requestId, 504, [
          ["content-type", "text/plain"],
          [TunnelMetaHeader.REASON, "response-deadline-exceeded"],
        ], Buffer.from("local handler too slow"));
        return;
      }
      if (outcome.kind === "in-process") {
        const inProcess = outcome.result;
        if (inProcess.kind === "ok") {
          await this.postHttpResponse(conn, 
            envelope.requestId,
            inProcess.status,
            filterResponseHeaders(inProcess.headers),
            inProcess.body,
          );
        } else {
          await this.postHttpResponse(conn, envelope.requestId, inProcess.status, [
            ["content-type", "text/plain"],
            [TunnelMetaHeader.REASON, inProcess.inkboxReason],
          ], Buffer.from(inProcess.inkboxReason));
        }
        return;
      }
      if (outcome.kind === "url-forward") {
        const result = outcome.result;
        if (result.kind === "ok") {
          await this.postHttpResponse(conn, 
            envelope.requestId,
            result.status,
            filterResponseHeaders(result.headers),
            result.body,
          );
        } else {
          await this.postHttpResponse(conn, envelope.requestId, result.status, [
            ["content-type", "text/plain"],
            [TunnelMetaHeader.REASON, result.inkboxReason],
          ], Buffer.from(result.inkboxReason));
        }
        return;
      }
      // No HTTP path configured — should be impossible if connect()
      // validation is correct, but defend.
      await this.postHttpResponse(conn, envelope.requestId, 501, [
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

  private async dispatchWsUpgrade(conn: Connection, envelope: Envelope): Promise<void> {
    if (envelope.wsId === null) {
      await this.postResponse(conn, envelope.requestId, 400, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "missing-ws-id"],
      ], Buffer.from("missing ws_id"));
      return;
    }
    // Path-traversal guard. Edge WS upgrades skip dispatchHttp's
    // validateEnvelopePath check, so apply it here too.
    const reject = validateEnvelopePath(envelope.path);
    if (reject !== null) {
      await this.postResponse(conn, envelope.requestId, 400, [
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
      await this.dispatchWsUpgradeToUrl(conn, envelope, this.dispatch.forwardTo);
      return;
    }
    if (this.dispatch.wsHandler === undefined) {
      // No URL upstream and no in-process WS handler — reject 501.
      await this.postResponse(conn, envelope.requestId, 501, [
        ["content-type", "text/plain"],
        [TunnelMetaHeader.REASON, "ws-not-supported"],
      ], Buffer.from("ws upgrade not supported"));
      return;
    }

    const acceptDeadlineMs = (conn.responseDeadlineSeconds ?? 30) * 1000;
    const bridge = await this.openWsBridge(conn, envelope);

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
    conn: Connection,
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
      conn.responseDeadlineSeconds !== null
        ? Math.max(1, conn.responseDeadlineSeconds * 1000)
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
      await this.postResponse(conn, envelope.requestId, status, [
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

    const bridge = await this.openWsBridge(conn, envelope);
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
    conn: Connection,
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
      await this.postResponse(conn, requestId, 200, headers, Buffer.alloc(0));
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
        [ControlHeaders.API_KEY]: this.apiKey,
        [TunnelMetaHeader.WS_ID]: wsId,
      };
      const opened = this.openStream(conn, connectHeaders, { endStream: false });
      connectStreamId = opened.streamId;
      bridgeStream = opened.stream;
      conn.bridgeStreamIds.add(connectStreamId);
      try {
        // Wait for the 200 on the bridge stream — bounded so a server
        // that never replies can't wedge the dispatch task after the
        // public side has already seen success. Mirrors Python's
        // _with_deadline + the TCP passthrough's
        // BRIDGE_STATUS_TIMEOUT_MS race.
        const ev = await Promise.race([
          this.nextEvent(conn, connectStreamId),
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
      await this.postResponse(conn, requestId, status, [
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
          if (id === null) {
            if (conn.draining) throw new WsServerDraining();
            return;
          }
          const ev = await self.nextEvent(conn, id);
          if (ev === null) {
            if (conn.draining) throw new WsServerDraining();
            return;
          }
          if (ev.kind === "data") {
            yield ev.data;
          } else if (ev.kind === "end") {
            if (conn.draining) throw new WsServerDraining();
            return;
          } else if (ev.kind === "reset") {
            // A reset while the conn is draining is the redeploy drain, not
            // a peer error — surface it typed so the handler can reconnect.
            if (conn.draining) throw new WsServerDraining();
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
        conn.bridgeStreamIds.delete(connectStreamId);
        conn.streams.delete(connectStreamId);
      }
    };

    return {
      io: { sendFrame, recv, closeStream, postUpgradeReply, rejectUpgrade },
      cleanup,
    };
  }

  // --- TCP-stream bridge (passthrough) ----------------------------------

  private async dispatchTcpStream(conn: Connection, envelope: Envelope): Promise<void> {
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
      [ControlHeaders.API_KEY]: this.apiKey,
      [TunnelMetaHeader.TCP_ID]: tcpId,
    };
    const { stream, streamId } = this.openStream(conn, connectHeaders, {
      endStream: false,
    });
    conn.bridgeStreamIds.add(streamId);

    // 2) Wait for status 200 with timeout.
    let openOk = false;
    try {
      const ev = await Promise.race([
        this.nextEvent(conn, streamId),
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
      conn.bridgeStreamIds.delete(streamId);
      conn.streams.delete(streamId);
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
          const ev = await this.nextEvent(conn, streamId);
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
      conn.bridgeStreamIds.delete(streamId);
      conn.streams.delete(streamId);
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

  /**
   * Post an HTTP webhook reply on the CURRENT active connection (not the
   * connection the envelope arrived on). After a GOAWAY the old connection
   * refuses new streams, so an in-flight reply must ride the new one, which
   * lands on the new task. `origin` is the fallback if no handoff is active.
   * If a handoff is mid-dial, wait (bounded) for it to publish the new
   * active; if none is healthy in time, drop the reply (the server deadline
   * + third-party retry recover it).
   */
  private async postHttpResponse(
    origin: Connection,
    requestId: string,
    status: number,
    userHeaders: Array<[string, string]>,
    body: Buffer,
  ): Promise<void> {
    if (this.handoffInFlight && this.handoffPromise !== null) {
      await Promise.race([
        this.handoffPromise,
        setTimeoutPromise(POST_ACTIVE_WAIT_MS),
      ]);
    }
    const target = this.pickReplyConnection(origin);
    if (target === null) {
      // eslint-disable-next-line no-console
      console.warn(
        `no live connection to post reply request_id=${requestId}; dropping`,
      );
      return;
    }
    await this.postResponse(target, requestId, status, userHeaders, body);
  }

  /** The active conn if it can take new streams, else the origin if it can. */
  private pickReplyConnection(origin: Connection): Connection | null {
    const usable = (c: Connection | null): c is Connection =>
      c !== null && !c.draining && c.session !== null && !c.session.closed;
    if (usable(this.active)) return this.active;
    if (usable(origin)) return origin;
    return null;
  }

  private async postResponse(
    conn: Connection,
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
      [ControlHeaders.API_KEY]: this.apiKey,
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
    const { streamId, stream } = this.openStream(conn, reqHeaders, {
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
        this.awaitResponse(conn, streamId),
        setTimeoutPromise(30_000),
      ]);
    } finally {
      conn.streams.delete(streamId);
    }
  }

  // --- utilities ---------------------------------------------------------

  private notifyStatus(status:
    | "connecting"
    | "connected"
    | "reconnecting"
    | "closed"
    | "superseded"): void {
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

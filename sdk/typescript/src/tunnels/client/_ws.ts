/**
 * inkbox-tunnels/client/_ws.ts
 *
 * In-process WebSocket session driver.
 *
 * Public types: {@link InkboxWebSocket}, {@link InkboxWsHandler},
 * {@link WsAcceptDeadlineExceeded}, {@link WsProtocolMismatch},
 * {@link WsClosed}.
 *
 * Internal types: {@link buildAcceptReply}, the lifecycle driver
 * {@link dispatchWsUpgradeInProcess}.
 *
 */

import type { Envelope } from "./_envelope.js";
import { HOP_BY_HOP_RESPONSE } from "./_protocol.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
  WS_OPCODE_TEXT,
  WsEnvelopeDecoder,
  WsFrameDecoder,
  encodeWsEnvelope,
  encodeWsFrame,
} from "./_wsframe.js";

// --- Public exception types ----------------------------------------------

export class WsAcceptDeadlineExceeded extends Error {
  constructor(message = "WebSocket accept deadline exceeded") {
    super(message);
    this.name = "WsAcceptDeadlineExceeded";
  }
}

export class WsProtocolMismatch extends Error {
  constructor(requested: string, offered: ReadonlyArray<string>) {
    super(
      `requested subprotocol ${JSON.stringify(requested)} is not in the ` +
        `peer's offered set ${JSON.stringify(offered)}`,
    );
    this.name = "WsProtocolMismatch";
  }
}

export class WsClosed extends Error {
  constructor(message = "WebSocket is closed") {
    super(message);
    this.name = "WsClosed";
  }
}

/** Application close code surfaced when the server is draining for a redeploy. */
export const SERVER_DRAINING_WS_CLOSE_CODE = 4500;

/**
 * Thrown from the inbound iterator when the connection is being drained for
 * a server redeploy. The session cannot migrate; reconnect is advised. The
 * third-party peer's fresh connection lands cleanly on the new task.
 */
export class WsServerDraining extends WsClosed {
  readonly code = SERVER_DRAINING_WS_CLOSE_CODE;
  readonly reconnectAdvised = true;
  constructor(message = "server draining; reconnect advised") {
    super(message);
    this.name = "WsServerDraining";
  }
}

// --- Public InkboxWebSocket interface ------------------------------------

export interface InkboxWebSocketAcceptOpts {
  /** Optional subprotocol; must be one of `offeredProtocols`. */
  protocol?: string;
  /** Additional response headers (excluding hop-by-hop). */
  headers?: Array<[string, string]>;
}

export interface InkboxWebSocket {
  readonly url: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly offeredProtocols: ReadonlyArray<string>;

  /**
   * Complete the upgrade handshake. If `protocol` is given, it MUST be
   * one of `offeredProtocols` — otherwise rejects with
   * `WsProtocolMismatch`. Resolves once the accept reply has been
   * posted on the wire.
   */
  accept(opts?: InkboxWebSocketAcceptOpts): Promise<void>;

  /**
   * Send a message. Resolves when the outbound buffer drains. Rejects
   * with `WsClosed` if `close()` has already been called.
   */
  send(data: string | Buffer): Promise<void>;

  /**
   * Send a CLOSE frame and tear down the bridge stream. Resolves once
   * the CLOSE frame is on the wire. Subsequent `send()` calls reject
   * with `WsClosed`.
   */
  close(code?: number, reason?: string): Promise<void>;

  /**
   * Inbound message stream. Completes cleanly (`done: true`) on a
   * normal CLOSE frame from the peer. Throws on abnormal close.
   */
  [Symbol.asyncIterator](): AsyncIterator<string | Buffer>;
}

export type InkboxWsHandler = (ws: InkboxWebSocket) => Promise<void>;

// --- Pure helpers (M1 — unit-testable independent of the runtime) --------

/**
 * Parse a `Sec-WebSocket-Protocol` header into an ordered list of
 * offered subprotocols. Comma-split, trimmed, empties dropped.
 */
export function parseOfferedSubprotocols(
  forwardedHeaders: ReadonlyArray<readonly [string, string]>,
): string[] {
  const out: string[] = [];
  for (const [k, v] of forwardedHeaders) {
    if (k.toLowerCase() !== "sec-websocket-protocol") continue;
    for (const piece of v.split(",")) {
      const trimmed = piece.trim();
      if (trimmed) out.push(trimmed);
    }
  }
  return out;
}

/**
 * Build the upgrade-reply headers the runtime posts back to
 * `/_system/response/{requestId}` once the user's handler has called
 * `accept()`.
 *
 * Hop-by-hop headers are stripped; an explicit `subprotocol` is added
 * as `sec-websocket-protocol`.
 */
export function buildAcceptReply(
  acceptOpts: InkboxWebSocketAcceptOpts | undefined,
): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  if (acceptOpts?.protocol) {
    out.push(["sec-websocket-protocol", acceptOpts.protocol]);
  }
  for (const [k, v] of acceptOpts?.headers ?? []) {
    if (HOP_BY_HOP_RESPONSE.has(k.toLowerCase())) continue;
    out.push([k, v]);
  }
  return out;
}

/**
 * Build the inbound headers map exposed to the user's handler. Strips
 * hop-by-hop request headers; preserves the rest verbatim.
 */
export function buildInboundHeaders(
  envelope: Envelope,
): Map<string, string> {
  const out = new Map<string, string>();
  for (const [k, v] of envelope.forwardedHeaders) {
    out.set(k.toLowerCase(), v);
  }
  return out;
}

// --- Lifecycle driver (M3) -----------------------------------------------

/**
 * Bridge primitives — supplied by the runtime so this module stays
 * unit-testable in isolation.
 */
export interface WsBridgeIO {
  /**
   * Send a chunk of WS-frame bytes on the bridge stream. Resolves when
   * the chunk is on the wire (post-flow-control).
   */
  sendFrame(frame: Buffer): Promise<void>;
  /**
   * Async-iterate inbound h2 DATA chunks from the bridge stream.
   * Completes when the bridge stream's `end` event fires; throws on a
   * `reset` event.
   */
  recv(): AsyncIterableIterator<Buffer>;
  /** Tear down the bridge stream cleanly. */
  closeStream(): Promise<void>;
  /** Post the upgrade reply (status + headers) to `/_system/response/{id}`. */
  postUpgradeReply(headers: Array<[string, string]>): Promise<void>;
  /** Reject the upgrade with a 4xx/5xx response. */
  rejectUpgrade(status: number, reason: string): Promise<void>;
}

export interface DispatchWsOpts {
  envelope: Envelope;
  handler: InkboxWsHandler;
  publicHost: string;
  acceptDeadlineMs: number;
  bridge: WsBridgeIO;
}

/**
 * The full WS-upgrade lifecycle from envelope → handler → message
 * pump → CLOSE. The runtime calls this from its dispatch loop after
 * confirming the envelope is a `ws-upgrade` route kind.
 */
export async function dispatchWsUpgradeInProcess(
  opts: DispatchWsOpts,
): Promise<void> {
  const { envelope, handler, publicHost, acceptDeadlineMs, bridge } = opts;
  const offered = parseOfferedSubprotocols(envelope.forwardedHeaders);
  const url = `wss://${publicHost}${envelope.path}`;
  const headers = buildInboundHeaders(envelope);

  const session = new WsSession({
    url,
    headers,
    offeredProtocols: offered,
    acceptDeadlineMs,
    bridge,
  });

  // Drive the user handler. The session manages accept-deadline,
  // pumps, and shutdown internally.
  await session.run(handler);
}

interface WsSessionOpts {
  url: string;
  headers: ReadonlyMap<string, string>;
  offeredProtocols: ReadonlyArray<string>;
  acceptDeadlineMs: number;
  bridge: WsBridgeIO;
}

class WsSession implements InkboxWebSocket {
  readonly url: string;
  readonly headers: ReadonlyMap<string, string>;
  readonly offeredProtocols: ReadonlyArray<string>;

  private readonly bridge: WsBridgeIO;
  private readonly acceptDeadlineMs: number;
  private acceptCalled = false;
  private acceptResolved = false;
  private acceptReply: Array<[string, string]> | null = null;
  private closeRequested = false;
  private closeResolved = false;
  private inboundQueue: Array<{ kind: "msg"; data: string | Buffer } | { kind: "close" } | { kind: "error"; err: Error }> = [];
  private inboundWaiter: ((v: void) => void) | null = null;
  private envelopeDecoder = new WsEnvelopeDecoder();
  private frameDecoder = new WsFrameDecoder();

  constructor(opts: WsSessionOpts) {
    this.url = opts.url;
    this.headers = opts.headers;
    this.offeredProtocols = opts.offeredProtocols;
    this.bridge = opts.bridge;
    this.acceptDeadlineMs = opts.acceptDeadlineMs;
  }

  // --- public InkboxWebSocket surface ------------------------------------

  async accept(opts?: InkboxWebSocketAcceptOpts): Promise<void> {
    if (this.acceptCalled) return;
    if (opts?.protocol !== undefined) {
      if (!this.offeredProtocols.includes(opts.protocol)) {
        throw new WsProtocolMismatch(opts.protocol, this.offeredProtocols);
      }
    }
    this.acceptCalled = true;
    this.acceptReply = buildAcceptReply(opts);
    await this.bridge.postUpgradeReply(this.acceptReply);
    this.acceptResolved = true;
  }

  async send(data: string | Buffer): Promise<void> {
    if (this.closeRequested) throw new WsClosed();
    if (!this.acceptResolved) {
      throw new WsClosed("send() before accept()");
    }
    let envelope: Buffer;
    if (typeof data === "string") {
      envelope = encodeWsEnvelope({ type: "websocket.send", text: data });
    } else {
      envelope = encodeWsEnvelope({ type: "websocket.send", bytes: data });
    }
    await this.bridge.sendFrame(encodeWsFrame(WS_OPCODE_BINARY, envelope, { mask: true }));
  }

  async close(code = 1000, reason = ""): Promise<void> {
    if (this.closeRequested) return;
    this.closeRequested = true;
    if (!this.acceptResolved) {
      // Handler called close before accept — reject the upgrade.
      try {
        await this.bridge.rejectUpgrade(403, "handler rejected upgrade");
      } catch {
        /* swallow */
      }
      this.closeResolved = true;
      return;
    }
    // Send wire-envelope CLOSE and a real WS CLOSE frame.
    const closeEnv = encodeWsEnvelope({ type: "websocket.close", code, reason });
    try {
      await this.bridge.sendFrame(encodeWsFrame(WS_OPCODE_BINARY, closeEnv, { mask: true }));
      const closePayload = Buffer.alloc(2 + Buffer.byteLength(reason, "utf-8"));
      closePayload.writeUInt16BE(code, 0);
      Buffer.from(reason, "utf-8").copy(closePayload, 2);
      await this.bridge.sendFrame(
        encodeWsFrame(WS_OPCODE_CLOSE, closePayload, { mask: true }),
      );
    } catch {
      /* swallow — bridge may already be torn down */
    }
    try {
      await this.bridge.closeStream();
    } catch {
      /* swallow */
    }
    this.closeResolved = true;
    this.pushInbound({ kind: "close" });
  }

  [Symbol.asyncIterator](): AsyncIterator<string | Buffer> {
    return {
      next: async () => {
        while (true) {
          const item = this.inboundQueue.shift();
          if (item !== undefined) {
            if (item.kind === "msg") {
              return { value: item.data, done: false };
            }
            if (item.kind === "close") {
              return { value: undefined, done: true };
            }
            throw item.err;
          }
          await new Promise<void>((resolve) => {
            this.inboundWaiter = resolve;
          });
        }
      },
    };
  }

  // --- runtime-facing driver --------------------------------------------

  async run(handler: InkboxWsHandler): Promise<void> {
    // Race the handler vs. the accept-deadline. Use a clearable timer
    // and a manually-rejectable promise so we don't leak the timer
    // after accept resolves.
    let deadlineTimer: NodeJS.Timeout | null = null;
    const acceptDeadline = new Promise<void>((_, reject) => {
      deadlineTimer = setTimeout(() => {
        if (!this.acceptCalled) {
          reject(new WsAcceptDeadlineExceeded());
        }
      }, this.acceptDeadlineMs);
    });

    // Holder for the pump task; assigned by `pumpStarter` once accept
    // resolves. Typed as a single-element record so the `null` case
    // doesn't get narrowed to `never` by control-flow analysis.
    const pumpHolder: { promise: Promise<void> | null } = { promise: null };

    const handlerPromise = (async () => {
      try {
        await handler(this);
      } finally {
        if (this.acceptResolved && !this.closeRequested) {
          await this.close(1000, "");
        } else if (!this.acceptResolved && !this.closeRequested) {
          // Mark terminal FIRST so pumpStarter's wait loop exits even if
          // rejectUpgrade throws (e.g. the origin conn is draining and
          // refuses the reply stream) — otherwise run()'s finally would
          // await pumpStarter forever.
          this.closeRequested = true;
          try {
            await this.bridge.rejectUpgrade(500, "handler returned without accept");
          } catch {
            /* swallow — origin may already be torn down */
          }
          this.closeResolved = true;
        }
      }
    })();

    // Start the inbound pump only AFTER accept resolves — otherwise
    // `recv()` can see a still-null bridge-stream id and exit early
    // before any data arrives. We start a watcher that observes
    // `acceptResolved` and kicks off the pump exactly once.
    const pumpStarter = (async () => {
      while (
        !this.acceptResolved &&
        !this.closeRequested
      ) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      if (this.acceptResolved && !this.closeRequested) {
        pumpHolder.promise = this.runInboundPump();
      }
    })();

    try {
      await Promise.race([handlerPromise, acceptDeadline]);
    } catch (err) {
      if (err instanceof WsAcceptDeadlineExceeded) {
        try {
          await this.bridge.rejectUpgrade(504, "ws upgrade timed out");
        } catch {
          /* swallow */
        }
        // Mark the session terminal so ``pumpStarter``'s wait loop and
        // ``recv()`` consumers exit promptly. Without this, a handler
        // that ignores the deadline would keep ``acceptResolved`` and
        // ``closeRequested`` both false, leaving ``pumpStarter``
        // spinning until the runtime finally tore the bridge down.
        this.closeRequested = true;
        this.closeResolved = true;
        this.pushInbound({ kind: "error", err });
        // Surface the timeout to caller without blocking on the
        // handler. Detach with a no-op catch so an unhandled-rejection
        // doesn't fire if the handler eventually throws (handler is a
        // user-supplied promise and may take arbitrarily long; we
        // posted the 504 already, so further work is just observable
        // bookkeeping).
        handlerPromise.catch(() => undefined);
      }
      throw err;
    } finally {
      if (deadlineTimer !== null) clearTimeout(deadlineTimer);
      await pumpStarter.catch(() => undefined);
      if (pumpHolder.promise !== null) {
        await pumpHolder.promise.catch(() => undefined);
      }
    }
  }

  private async runInboundPump(): Promise<void> {
    try {
      for await (const chunk of this.bridge.recv()) {
        const frames = this.frameDecoder.feed(chunk);
        for (const frame of frames) {
          if (frame.opcode === WS_OPCODE_PING) {
            await this.bridge.sendFrame(
              encodeWsFrame(WS_OPCODE_PONG, frame.payload, { mask: true }),
            );
            continue;
          }
          if (frame.opcode === WS_OPCODE_PONG) continue;
          if (frame.opcode === WS_OPCODE_CLOSE) {
            this.pushInbound({ kind: "close" });
            return;
          }
          if (
            frame.opcode === WS_OPCODE_BINARY ||
            frame.opcode === WS_OPCODE_TEXT
          ) {
            const envs = this.envelopeDecoder.feed(frame.payload);
            for (const env of envs) {
              if (env.type === "text") {
                this.pushInbound({ kind: "msg", data: env.data });
              } else if (env.type === "binary") {
                this.pushInbound({ kind: "msg", data: env.data });
              } else if (env.type === "close") {
                this.pushInbound({ kind: "close" });
                return;
              }
            }
          }
        }
      }
      // Stream ended without an explicit CLOSE envelope.
      // Per partial-bytes-at-EOF policy: drop trailing buffer bytes
      // silently and signal close to the iterator.
      this.pushInbound({ kind: "close" });
    } catch (err) {
      this.pushInbound({
        kind: "error",
        err: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  private pushInbound(
    item:
      | { kind: "msg"; data: string | Buffer }
      | { kind: "close" }
      | { kind: "error"; err: Error },
  ): void {
    this.inboundQueue.push(item);
    const waiter = this.inboundWaiter;
    if (waiter !== null) {
      this.inboundWaiter = null;
      waiter();
    }
  }
}

export const __testing = { WsSession };

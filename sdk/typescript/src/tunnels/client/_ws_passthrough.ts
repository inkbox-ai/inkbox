/**
 * inkbox-tunnels/client/_ws_passthrough.ts
 *
 * WebSocket support for passthrough mode.
 *
 * The h1 parser and h2 transcoder hand a {@link WebSocketSink} to the
 * dispatcher when the inbound is a WS upgrade. The dispatcher completes
 * the handshake via `accept` then bridges frames via `sendFrame` /
 * `recvFrame`. The `bridgeWsHandlerOverSink` helper wires an
 * `InkboxWsHandler` to one of those sinks so the same handler shape
 * serves h1 `Upgrade: websocket` and h2 RFC 8441 Extended CONNECT.
 */

import { createHash } from "node:crypto";
import type { InkboxWsHandler, InkboxWebSocket } from "./_ws.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_PING,
  WS_OPCODE_PONG,
  WS_OPCODE_TEXT,
} from "./_wsframe.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function computeWsAccept(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID, "ascii")
    .digest("base64");
}

/**
 * Encode an unmasked server-to-client frame. RFC 6455 §5.1 — server
 * frames MUST NOT be masked. The shared `_wsframe.encodeWsFrame`
 * defaults to client semantics (masked); this helper enforces unmasked.
 */
export function encodeServerFrame(
  opcode: number,
  payload: Buffer,
  fin = true,
): Buffer {
  const out: number[] = [];
  out.push((fin ? 0x80 : 0x00) | (opcode & 0x0f));
  const plen = payload.length;
  if (plen < 126) {
    out.push(plen);
  } else if (plen < 65536) {
    out.push(126);
    out.push((plen >> 8) & 0xff, plen & 0xff);
  } else {
    out.push(127);
    // Encode as 8-byte big-endian; payloads > 2^32 not supported here.
    for (let i = 7; i >= 0; i--) {
      out.push((Number(BigInt(plen) >> BigInt(i * 8))) & 0xff);
    }
  }
  return Buffer.concat([Buffer.from(out), payload]);
}

/**
 * Decode one complete client-to-server frame from `buf`.
 *
 * For h1 WebSockets (RFC 6455 §5.1) client frames MUST be masked;
 * pass `requireMask=true` (default) and the decoder rejects unmasked
 * frames. For h2 WebSockets (RFC 8441 §5.1) frames are NEVER masked —
 * the transcoder passes `requireMask=false` so unmasked payloads are
 * returned verbatim.
 */
export function decodeClientFrame(
  buf: Buffer[],
  opts?: { requireMask?: boolean },
):
  | { kind: "frame"; opcode: number; payload: Buffer; fin: boolean }
  | { kind: "need-more" }
  | { kind: "rejected" } {
  const requireMask = opts?.requireMask ?? true;
  let total = 0;
  for (const c of buf) total += c.length;
  if (total < 2) return { kind: "need-more" };
  const merged = Buffer.concat(buf, total);
  let offset = 0;
  const b0 = merged[0];
  const b1 = merged[1];
  const fin = (b0 & 0x80) !== 0;
  const opcode = b0 & 0x0f;
  const masked = (b1 & 0x80) !== 0;
  let plen = b1 & 0x7f;
  offset = 2;
  if (plen === 126) {
    if (merged.length < 4) {
      buf.length = 0;
      buf.push(merged);
      return { kind: "need-more" };
    }
    plen = merged.readUInt16BE(2);
    offset = 4;
  } else if (plen === 127) {
    if (merged.length < 10) {
      buf.length = 0;
      buf.push(merged);
      return { kind: "need-more" };
    }
    plen = Number(merged.readBigUInt64BE(2));
    offset = 10;
  }
  if (requireMask && !masked) return { kind: "rejected" };
  if (!requireMask && masked) return { kind: "rejected" };
  let payload: Buffer;
  if (masked) {
    if (merged.length < offset + 4) {
      buf.length = 0;
      buf.push(merged);
      return { kind: "need-more" };
    }
    const maskKey = merged.subarray(offset, offset + 4);
    offset += 4;
    if (merged.length < offset + plen) {
      buf.length = 0;
      buf.push(merged);
      return { kind: "need-more" };
    }
    const raw = merged.subarray(offset, offset + plen);
    payload = Buffer.alloc(plen);
    for (let i = 0; i < plen; i++) {
      payload[i] = raw[i] ^ maskKey[i % 4];
    }
  } else {
    if (merged.length < offset + plen) {
      buf.length = 0;
      buf.push(merged);
      return { kind: "need-more" };
    }
    payload = Buffer.from(merged.subarray(offset, offset + plen));
  }
  const remaining = merged.subarray(offset + plen);
  buf.length = 0;
  if (remaining.length > 0) buf.push(remaining);
  return { kind: "frame", opcode, payload, fin };
}

export interface WebSocketSink {
  accept(opts?: {
    subprotocol?: string;
    extraHeaders?: Array<[string, string]>;
  }): Promise<void>;
  reject(opts?: { status?: number; reason?: string }): Promise<void>;
  sendFrame(
    opcode: number,
    payload: Buffer,
    opts?: { fin?: boolean },
  ): Promise<void>;
  recvFrame(): Promise<{
    opcode: number;
    payload: Buffer;
    fin: boolean;
  } | null>;
  aclose(): Promise<void>;
}

export interface WsPassthroughRequestMeta {
  url: string;
  headers: ReadonlyMap<string, string>;
  offeredSubprotocols: string[];
}

/**
 * Drive an `InkboxWsHandler` against a `WebSocketSink`. Constructs an
 * `InkboxWebSocket`-shaped object whose lifecycle (`accept`, `send`,
 * `close`, async-iterator) maps onto the sink's frame I/O.
 */
export async function bridgeWsHandlerOverSink(opts: {
  handler: InkboxWsHandler;
  sink: WebSocketSink;
  meta: WsPassthroughRequestMeta;
}): Promise<void> {
  const { handler, sink, meta } = opts;
  let accepted = false;
  let closed = false;

  // Inbound message stream — the handler's async-iterator pulls from
  // here. The reader task is started lazily on `accept` so frames
  // received before the user's handler iterates are still buffered.
  const inboundQueue: Array<string | Buffer> = [];
  const inboundResolvers: Array<
    (v: { value: string | Buffer; done: false } | { value: undefined; done: true }) => void
  > = [];
  let inboundEnded = false;
  let inboundError: Error | null = null;

  const pushInbound = (msg: string | Buffer): void => {
    if (inboundResolvers.length > 0) {
      inboundResolvers.shift()!({ value: msg, done: false });
      return;
    }
    inboundQueue.push(msg);
  };
  const endInbound = (err?: Error): void => {
    inboundEnded = true;
    if (err) inboundError = err;
    while (inboundResolvers.length > 0) {
      const r = inboundResolvers.shift()!;
      r({ value: undefined, done: true });
    }
  };

  let readerTask: Promise<void> | null = null;
  const startReader = (): void => {
    if (readerTask !== null) return;
    readerTask = (async () => {
      let fragments: Buffer[] | null = null;
      let fragmentsText = false;
      while (!closed) {
        let frame: { opcode: number; payload: Buffer; fin: boolean } | null;
        try {
          frame = await sink.recvFrame();
        } catch (err) {
          endInbound(err as Error);
          return;
        }
        if (frame === null) {
          endInbound();
          return;
        }
        const { opcode, payload, fin } = frame;
        if (opcode === WS_OPCODE_PING) {
          await sink.sendFrame(WS_OPCODE_PONG, payload).catch(() => undefined);
          continue;
        }
        if (opcode === WS_OPCODE_PONG) continue;
        if (opcode === WS_OPCODE_CLOSE) {
          endInbound();
          return;
        }
        if (opcode === 0x0) {
          if (fragments === null) {
            endInbound(new Error("continuation without start"));
            return;
          }
          fragments.push(payload);
        } else if (opcode === WS_OPCODE_TEXT) {
          if (fragments !== null) {
            endInbound(new Error("new text frame mid-fragment"));
            return;
          }
          fragments = [payload];
          fragmentsText = true;
        } else if (opcode === WS_OPCODE_BINARY) {
          if (fragments !== null) {
            endInbound(new Error("new binary frame mid-fragment"));
            return;
          }
          fragments = [payload];
          fragmentsText = false;
        } else {
          endInbound(new Error(`unsupported opcode ${opcode}`));
          return;
        }
        if (!fin) continue;
        const merged = fragments.length === 1
          ? fragments[0]
          : Buffer.concat(fragments);
        fragments = null;
        if (fragmentsText) {
          try {
            pushInbound(merged.toString("utf-8"));
          } catch {
            endInbound(new Error("invalid utf-8 in text frame"));
            return;
          }
        } else {
          pushInbound(merged);
        }
      }
    })();
  };

  const ws: InkboxWebSocket = {
    url: meta.url,
    headers: meta.headers,
    offeredProtocols: meta.offeredSubprotocols,

    async accept(acceptOpts) {
      if (accepted || closed) return;
      accepted = true;
      const subprotocol = acceptOpts?.protocol;
      if (
        subprotocol !== undefined &&
        !meta.offeredSubprotocols.includes(subprotocol)
      ) {
        const { WsProtocolMismatch } = await import("./_ws.js");
        throw new WsProtocolMismatch(subprotocol, meta.offeredSubprotocols);
      }
      await sink.accept({
        subprotocol,
        extraHeaders: acceptOpts?.headers,
      });
      startReader();
    },

    async send(data) {
      if (!accepted || closed) {
        const { WsClosed } = await import("./_ws.js");
        throw new WsClosed();
      }
      if (typeof data === "string") {
        await sink.sendFrame(WS_OPCODE_TEXT, Buffer.from(data, "utf-8"));
      } else {
        await sink.sendFrame(WS_OPCODE_BINARY, data);
      }
    },

    async close(code = 1000, reason = "") {
      if (closed) return;
      closed = true;
      if (!accepted) {
        await sink.reject({ status: 403, reason });
        return;
      }
      const reasonBuf = Buffer.from(reason, "utf-8");
      const payload = Buffer.alloc(2 + reasonBuf.length);
      payload.writeUInt16BE(code, 0);
      reasonBuf.copy(payload, 2);
      try {
        await sink.sendFrame(WS_OPCODE_CLOSE, payload);
      } catch {
        /* swallow */
      }
    },

    [Symbol.asyncIterator](): AsyncIterator<string | Buffer> {
      return {
        async next() {
          if (inboundError !== null) throw inboundError;
          if (inboundQueue.length > 0) {
            return { value: inboundQueue.shift()!, done: false };
          }
          if (inboundEnded) {
            return { value: undefined, done: true };
          }
          return new Promise((resolve) => inboundResolvers.push(resolve));
        },
      };
    },
  };

  try {
    await handler(ws);
  } catch {
    if (!accepted) {
      await sink.reject({ status: 500, reason: "handler error" });
    }
  } finally {
    closed = true;
    endInbound();
    if (readerTask !== null) {
      try {
        await readerTask;
      } catch {
        /* swallow */
      }
    }
    try {
      await sink.aclose();
    } catch {
      /* swallow */
    }
  }
}

// --- Generic byte-channel sink shared by h1 / h2 transports ----------------

export interface ByteChannelSinkOpts {
  /** Plaintext bytes to write back on the wire. */
  sendPlaintext: (data: Buffer) => Promise<void>;
  /** Build the protocol-appropriate accept response (h1 = 101 head; h2 = :status 200). */
  buildAcceptResponse: (
    subprotocol: string | null,
    extraHeaders: Array<[string, string]> | null,
  ) => Buffer;
  /** Build the protocol-appropriate reject response. */
  buildRejectResponse: (status: number) => Buffer;
  /** Optional teardown callback. */
  onClose?: () => Promise<void>;
  /**
   * h1 transports require client-to-server frames to be masked
   * (RFC 6455 §5.1); h2 transports require them to be unmasked
   * (RFC 8441 §5.1). Default: true.
   */
  requireClientMask?: boolean;
}

/**
 * Common `WebSocketSink` impl backed by an inbound byte queue + outbound
 * send callback. The h1 parser drives this from a node:http upgrade
 * socket; the h2 transcoder drives the same shape from Extended-CONNECT
 * stream DATA frames.
 */
export class ByteChannelWebSocketSink implements WebSocketSink {
  private readonly sendPlaintext: (data: Buffer) => Promise<void>;
  private readonly buildAccept: (
    subprotocol: string | null,
    extraHeaders: Array<[string, string]> | null,
  ) => Buffer;
  private readonly buildReject: (status: number) => Buffer;
  private readonly onCloseHook?: () => Promise<void>;
  private readonly requireClientMask: boolean;
  private inboundChunks: Buffer[] = [];
  private inboundResolvers: Array<() => void> = [];
  private inboundClosed = false;
  private accepted = false;
  private closed = false;

  constructor(opts: ByteChannelSinkOpts) {
    this.sendPlaintext = opts.sendPlaintext;
    this.buildAccept = opts.buildAcceptResponse;
    this.buildReject = opts.buildRejectResponse;
    this.onCloseHook = opts.onClose;
    this.requireClientMask = opts.requireClientMask ?? true;
  }

  feedInbound(data: Buffer): void {
    if (this.closed) return;
    this.inboundChunks.push(data);
    while (this.inboundResolvers.length > 0) {
      this.inboundResolvers.shift()!();
    }
  }

  signalInboundEof(): void {
    this.inboundClosed = true;
    while (this.inboundResolvers.length > 0) {
      this.inboundResolvers.shift()!();
    }
  }

  async accept(opts?: {
    subprotocol?: string;
    extraHeaders?: Array<[string, string]>;
  }): Promise<void> {
    if (this.accepted || this.closed) return;
    this.accepted = true;
    const head = this.buildAccept(
      opts?.subprotocol ?? null,
      opts?.extraHeaders ?? null,
    );
    await this.sendPlaintext(head);
  }

  async reject(opts?: { status?: number }): Promise<void> {
    if (this.accepted || this.closed) return;
    this.closed = true;
    const head = this.buildReject(opts?.status ?? 400);
    try {
      await this.sendPlaintext(head);
    } catch {
      /* swallow */
    }
  }

  async sendFrame(
    opcode: number,
    payload: Buffer,
    opts?: { fin?: boolean },
  ): Promise<void> {
    if (!this.accepted || this.closed) return;
    const fin = opts?.fin ?? true;
    const frame = encodeServerFrame(opcode, payload, fin);
    await this.sendPlaintext(frame);
  }

  async recvFrame(): Promise<{
    opcode: number;
    payload: Buffer;
    fin: boolean;
  } | null> {
    while (true) {
      const decoded = decodeClientFrame(this.inboundChunks, {
        requireMask: this.requireClientMask,
      });
      if (decoded.kind === "frame") {
        return {
          opcode: decoded.opcode,
          payload: decoded.payload,
          fin: decoded.fin,
        };
      }
      if (decoded.kind === "rejected") return null;
      // need-more
      if (this.inboundClosed && this.inboundChunks.length === 0) {
        return null;
      }
      await new Promise<void>((r) => this.inboundResolvers.push(r));
    }
  }

  async aclose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.signalInboundEof();
    if (this.onCloseHook !== undefined) {
      try {
        await this.onCloseHook();
      } catch {
        /* swallow */
      }
    }
  }
}

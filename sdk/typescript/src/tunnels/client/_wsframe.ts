/**
 * inkbox-tunnels/client/_wsframe.ts
 *
 * RFC 6455 WebSocket frame codec, plus the length-prefixed JSON envelope
 * format the WS-bridge stream carries.
 *
 * Pure / synchronous; no I/O. Used by both the WS upgrade bridge and
 * the passthrough TCP bridge (which tunnels raw bytes inside WS BINARY
 * frames on an extended-CONNECT stream).
 *
 * ## Statefulness — the decoder MUST accumulate across calls
 *
 * A single h2 DATA frame can carry zero, one, many, or partial WS
 * frames; a single WS frame (with extended length) can span multiple
 * DATA boundaries. Use {@link WsFrameDecoder.feed} which retains a
 * carry buffer between calls. Do not implement
 * one-frame-per-DATA-callback in callers.
 *
 * ## Partial-bytes-at-EOF policy (M3 T0 — matches Python)
 *
 * If the bridge stream ends ("end" or "reset" h2 event) while the carry
 * buffer still contains a partial WS frame, the policy is:
 *   **drop the trailing bytes silently and close the WS session.**
 *   No RST_STREAM. No error surfaced to the user.
 *
 * Verified against Python `_runtime.py` (`_pump_ws`): on a stream-end /
 * stream-reset event, `recv_done` is set and the loop exits, abandoning
 * `wire_buf` and `env_buf` without any cleanup write. The TS port
 * mirrors that exactly.
 */

import { randomBytes } from "node:crypto";

export const WS_OPCODE_CONTINUATION = 0x0;
export const WS_OPCODE_TEXT = 0x1;
export const WS_OPCODE_BINARY = 0x2;
export const WS_OPCODE_CLOSE = 0x8;
export const WS_OPCODE_PING = 0x9;
export const WS_OPCODE_PONG = 0xa;

export interface WsFrame {
  opcode: number;
  payload: Buffer;
  fin: boolean;
}

/**
 * Stateful WS frame decoder. Hold one per bridge stream; call
 * {@link feed} as h2 DATA chunks arrive.
 */
export class WsFrameDecoder {
  private buf: Buffer = Buffer.alloc(0);

  /**
   * Feed a chunk of wire bytes; return any newly-decodable frames.
   * Trailing partial bytes stay in the carry buffer for the next call.
   */
  feed(chunk: Buffer): WsFrame[] {
    if (chunk.length > 0) {
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    }
    const frames: WsFrame[] = [];
    let cursor = 0;
    while (true) {
      const remaining = this.buf.length - cursor;
      if (remaining < 2) break;
      const b0 = this.buf[cursor];
      const b1 = this.buf[cursor + 1];
      const fin = (b0 & 0x80) !== 0;
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let plen = b1 & 0x7f;
      let offset = 2;
      if (plen === 126) {
        if (remaining < 4) break;
        plen = this.buf.readUInt16BE(cursor + 2);
        offset = 4;
      } else if (plen === 127) {
        if (remaining < 10) break;
        const high = this.buf.readUInt32BE(cursor + 2);
        const low = this.buf.readUInt32BE(cursor + 6);
        // JS-safe range: < 2^53. The bridge cap is well below that.
        plen = high * 0x1_0000_0000 + low;
        offset = 10;
      }
      let maskKey: Buffer | null = null;
      if (masked) {
        if (remaining < offset + 4) break;
        maskKey = this.buf.subarray(cursor + offset, cursor + offset + 4);
        offset += 4;
      }
      if (remaining < offset + plen) break;
      let payload = Buffer.from(
        this.buf.subarray(cursor + offset, cursor + offset + plen),
      );
      if (masked && maskKey) {
        for (let i = 0; i < payload.length; i++) {
          payload[i] = payload[i] ^ maskKey[i % 4];
        }
      }
      frames.push({ opcode, payload, fin });
      cursor += offset + plen;
    }
    if (cursor > 0) {
      this.buf = cursor === this.buf.length
        ? Buffer.alloc(0)
        : Buffer.from(this.buf.subarray(cursor));
    }
    return frames;
  }

  /** True iff there are partial bytes still in the carry buffer. */
  hasPartial(): boolean {
    return this.buf.length > 0;
  }

  /** Bytes currently buffered (test-only inspection). */
  partialBytes(): number {
    return this.buf.length;
  }
}

export interface EncodeOptions {
  /** RFC 6455 requires client→server frames to be masked. Default: true. */
  mask?: boolean;
  /**
   * RFC 6455 FIN bit. Default: true (single-frame message). Set false to
   * produce a fragment that expects a continuation; needed by the URL
   * passthrough bridge so multi-frame messages aren't silently coalesced.
   */
  fin?: boolean;
}

/**
 * Encode a single WS frame. ``mask=true`` is required for
 * client→server traffic per RFC 6455.
 */
export function encodeWsFrame(
  opcode: number,
  payload: Buffer,
  options: EncodeOptions = {},
): Buffer {
  const mask = options.mask !== false;
  const fin = options.fin !== false;
  const plen = payload.length;
  let headerLen = 2;
  if (plen >= 126 && plen < 65536) headerLen = 4;
  else if (plen >= 65536) headerLen = 10;
  if (mask) headerLen += 4;
  const out = Buffer.alloc(headerLen + plen);
  out[0] = (fin ? 0x80 : 0x00) | (opcode & 0x0f);
  const maskBit = mask ? 0x80 : 0x00;
  let off = 2;
  if (plen < 126) {
    out[1] = maskBit | plen;
  } else if (plen < 65536) {
    out[1] = maskBit | 126;
    out.writeUInt16BE(plen, 2);
    off = 4;
  } else {
    out[1] = maskBit | 127;
    const high = Math.floor(plen / 0x1_0000_0000);
    const low = plen % 0x1_0000_0000;
    out.writeUInt32BE(high, 2);
    out.writeUInt32BE(low, 6);
    off = 10;
  }
  if (mask) {
    const maskKey = randomBytes(4);
    maskKey.copy(out, off);
    for (let i = 0; i < plen; i++) {
      out[off + 4 + i] = payload[i] ^ maskKey[i % 4];
    }
  } else {
    payload.copy(out, off);
  }
  return out;
}

/**
 * Outbound WS-envelope shape exchanged on the bridge stream.
 *
 * The wire shape is `length-prefixed (4 BE bytes) JSON`:
 *
 *   - `{type: "text",   data: <utf-8 string>}`
 *   - `{type: "binary", data: <base64 ascii>}`
 *   - `{type: "close",  code: <int>, reason: <string>}`
 *
 * Binary payloads are base64-wrapped to match the server's bridge
 * contract (server `b64encode`/`b64decode`).
 */
export type OutboundWsMsg =
  | { type: "websocket.send"; text: string }
  | { type: "websocket.send"; bytes: Buffer }
  | { type: "websocket.close"; code?: number; reason?: string };

export function encodeWsEnvelope(msg: OutboundWsMsg): Buffer {
  let wire: { type: string; data?: string; code?: number; reason?: string };
  if (msg.type === "websocket.send") {
    if ("text" in msg && msg.text !== undefined) {
      wire = { type: "text", data: msg.text };
    } else if ("bytes" in msg && msg.bytes !== undefined) {
      wire = { type: "binary", data: msg.bytes.toString("base64") };
    } else {
      wire = { type: "text", data: "" };
    }
  } else if (msg.type === "websocket.close") {
    wire = {
      type: "close",
      code: msg.code ?? 1000,
      reason: msg.reason ?? "",
    };
  } else {
    wire = { type: "text", data: "" };
  }
  const json = Buffer.from(JSON.stringify(wire), "utf-8");
  const out = Buffer.alloc(4 + json.length);
  out.writeUInt32BE(json.length, 0);
  json.copy(out, 4);
  return out;
}

/**
 * Inbound bridge envelope decoded from a string/binary WS frame
 * payload.
 */
export type InboundWsEnvelope =
  | { type: "text"; data: string }
  | { type: "binary"; data: Buffer }
  | { type: "close"; code: number; reason?: string };

/**
 * Length-prefixed-JSON envelope decoder. Stateful — call repeatedly
 * with concatenated WS-frame payloads, get back fully-formed envelopes
 * as they emerge.
 *
 * Binary envelopes have their `data` field strictly base64-validated
 * (per the server contract). Malformed base64 is logged and dropped —
 * the empty result is what the runtime delivers, mirroring Python's
 * `_ws.py` behavior at the validate=True boundary.
 */
export class WsEnvelopeDecoder {
  private buf: Buffer = Buffer.alloc(0);

  feed(chunk: Buffer): InboundWsEnvelope[] {
    if (chunk.length > 0) {
      this.buf = this.buf.length === 0 ? chunk : Buffer.concat([this.buf, chunk]);
    }
    const out: InboundWsEnvelope[] = [];
    let cursor = 0;
    while (this.buf.length - cursor >= 4) {
      const length = this.buf.readUInt32BE(cursor);
      if (this.buf.length - cursor - 4 < length) break;
      const payload = this.buf.subarray(cursor + 4, cursor + 4 + length);
      cursor += 4 + length;
      let parsed: { type?: unknown; data?: unknown; code?: unknown; reason?: unknown };
      try {
        parsed = JSON.parse(payload.toString("utf-8")) as typeof parsed;
      } catch {
        continue;
      }
      const decoded = decodeOneEnvelope(parsed);
      if (decoded !== null) out.push(decoded);
    }
    if (cursor > 0) {
      this.buf = cursor === this.buf.length
        ? Buffer.alloc(0)
        : Buffer.from(this.buf.subarray(cursor));
    }
    return out;
  }

  hasPartial(): boolean {
    return this.buf.length > 0;
  }
}

function decodeOneEnvelope(parsed: {
  type?: unknown;
  data?: unknown;
  code?: unknown;
  reason?: unknown;
}): InboundWsEnvelope | null {
  if (parsed.type === "text") {
    return { type: "text", data: typeof parsed.data === "string" ? parsed.data : "" };
  }
  if (parsed.type === "binary") {
    if (typeof parsed.data !== "string") return null;
    const decoded = decodeStrictBase64(parsed.data);
    if (decoded === null) return null;
    return { type: "binary", data: decoded };
  }
  if (parsed.type === "close") {
    return {
      type: "close",
      code: typeof parsed.code === "number" ? parsed.code : 1000,
      reason: typeof parsed.reason === "string" ? parsed.reason : "",
    };
  }
  return null;
}

/**
 * Strict base64 decode: rejects non-base64 characters, requires
 * padding. Mirrors Python `base64.b64decode(..., validate=True)`.
 *
 * Node's `Buffer.from(s, "base64")` is permissive (silently strips
 * non-base64 chars and tolerates missing padding). We need the strict
 * shape to match the server's outbound encoding exactly — otherwise a
 * garbage `"@@@@"` decodes to an empty Buffer the user's app would
 * mistake for a real binary message.
 */
function decodeStrictBase64(s: string): Buffer | null {
  if (s.length === 0) return Buffer.alloc(0);
  if (s.length % 4 !== 0) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(s)) return null;
  const decoded = Buffer.from(s, "base64");
  // Round-trip: re-encode and compare. Catches edge cases the regex
  // above lets through (Node's Buffer is still tolerant of some inputs).
  if (decoded.toString("base64") !== s) return null;
  return decoded;
}

export const __testing = { decodeStrictBase64 };

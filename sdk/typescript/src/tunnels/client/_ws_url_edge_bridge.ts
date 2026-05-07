/**
 * inkbox-tunnels/client/_ws_url_edge_bridge.ts
 *
 * Edge-mode URL WebSocket bridge.
 *
 * The third party's WS frames arrive over the bridge stream as
 * length-prefixed JSON envelopes wrapped in outer WS BINARY frames
 * (the standard inkbox bridge protocol). We translate each direction:
 *
 * * Bridge → upstream: outer WS frames → inner JSON envelopes →
 *   RFC 6455 frames (masked, h1 client-side) written to the upstream
 *   socket.
 * * Upstream → bridge: RFC 6455 frames (server, unmasked) → JSON
 *   envelopes → outer WS BINARY frames (masked) sent on the bridge
 *   via ``WsBridgeIO.sendFrame``.
 *
 * PING / PONG control frames are answered locally and not propagated.
 */

import type { WsBridgeIO } from "./_ws.js";
import type { WsUpstreamHandle } from "./_ws_url_bridge.js";
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
import { decodeClientFrame } from "./_ws_passthrough.js";

export interface PumpEdgeBridgeOpts {
  upstream: WsUpstreamHandle;
  bridge: WsBridgeIO;
}

export async function pumpWsUrlEdgeBridge(
  opts: PumpEdgeBridgeOpts,
): Promise<void> {
  const { upstream, bridge } = opts;
  const socket = upstream.socket;

  // Upstream → bridge.
  // The inkbox bridge protocol carries complete WS messages inside
  // ``websocket.send`` envelopes; it cannot represent fragmentation.
  // RFC 6455 lets the upstream split a TEXT/BINARY message into a
  // first frame (TEXT/BINARY, FIN=0) followed by CONTINUATION frames
  // until FIN=1. Reassemble client-side so we emit one envelope per
  // message even when upstream streams it as fragments.
  const upstreamBuf: Buffer[] = [];
  if (upstream.leftover.length > 0) upstreamBuf.push(upstream.leftover);
  let upstreamClosed = false;
  let bridgeClosed = false;
  let messageOpcode: number | null = null;
  let messageChunks: Buffer[] = [];

  // Wake the bridge.recv() iteration on abrupt upstream close. Without
  // it, the bridge→upstream loop sits inside the iterator until the
  // third party sends another frame (which an idle upstream peer
  // crash leaves indefinitely).
  let signalUpstreamClosed: () => void = () => {};
  const upstreamClosedSignal = new Promise<void>((resolve) => {
    signalUpstreamClosed = resolve;
  });

  const drainUpstream = async (): Promise<void> => {
    while (!bridgeClosed) {
      const decoded = decodeClientFrame(upstreamBuf, { requireMask: false });
      if (decoded.kind === "need-more") return;
      if (decoded.kind === "rejected") {
        upstreamClosed = true;
        return;
      }
      const { opcode, payload, fin } = decoded;
      if (opcode === WS_OPCODE_PING) {
        try {
          socket.write(encodeWsFrame(WS_OPCODE_PONG, payload, { mask: true }));
        } catch {
          return;
        }
        continue;
      }
      if (opcode === WS_OPCODE_PONG) continue;
      if (opcode === WS_OPCODE_CLOSE) {
        const code =
          payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const env = encodeWsEnvelope({
          type: "websocket.close",
          code,
          reason: "",
        });
        try {
          await bridge.sendFrame(
            encodeWsFrame(WS_OPCODE_BINARY, env, { mask: true }),
          );
        } catch {
          /* swallow */
        }
        upstreamClosed = true;
        return;
      }
      if (opcode === WS_OPCODE_TEXT || opcode === WS_OPCODE_BINARY) {
        // Start of a (possibly fragmented) message. RFC 6455 §5.4
        // requires no two TEXT/BINARY without a FIN=1 between them.
        if (messageOpcode !== null) {
          // Defensive: upstream framed badly — drop and close.
          upstreamClosed = true;
          return;
        }
        messageOpcode = opcode;
        messageChunks = [payload];
      } else if (opcode === 0x0) {
        // CONTINUATION
        if (messageOpcode === null) {
          upstreamClosed = true;
          return;
        }
        messageChunks.push(payload);
      } else {
        // Unknown opcode — ignore safely.
        continue;
      }
      if (fin && messageOpcode !== null) {
        const full = Buffer.concat(messageChunks);
        const startedOpcode = messageOpcode;
        messageOpcode = null;
        messageChunks = [];
        if (startedOpcode === WS_OPCODE_TEXT) {
          let text: string;
          try {
            text = full.toString("utf-8");
          } catch {
            upstreamClosed = true;
            return;
          }
          const env = encodeWsEnvelope({ type: "websocket.send", text });
          try {
            await bridge.sendFrame(
              encodeWsFrame(WS_OPCODE_BINARY, env, { mask: true }),
            );
          } catch {
            return;
          }
        } else {
          const env = encodeWsEnvelope({
            type: "websocket.send",
            bytes: full,
          });
          try {
            await bridge.sendFrame(
              encodeWsFrame(WS_OPCODE_BINARY, env, { mask: true }),
            );
          } catch {
            return;
          }
        }
      }
    }
  };

  let draining = false;
  const triggerDrain = (): void => {
    if (draining) return;
    draining = true;
    drainUpstream()
      .catch(() => undefined)
      .finally(() => {
        draining = false;
      });
  };

  socket.on("data", (chunk: Buffer) => {
    upstreamBuf.push(chunk);
    triggerDrain();
  });
  socket.once("close", () => {
    upstreamClosed = true;
    signalUpstreamClosed();
  });
  socket.once("error", () => {
    upstreamClosed = true;
    signalUpstreamClosed();
  });
  // The upstream may already be gone between openWsUpstream returning
  // and pumpWsUrlEdgeBridge attaching listeners (especially for an
  // upstream that destroys after writing 101). "close" is one-shot, so
  // a listener attached after the fact never fires — check explicitly.
  if (socket.destroyed) {
    upstreamClosed = true;
    signalUpstreamClosed();
  }
  // Kick off in case the upgrade already shipped trailing frame bytes.
  triggerDrain();

  // Bridge → upstream.
  const frameDecoder = new WsFrameDecoder();
  const envelopeDecoder = new WsEnvelopeDecoder();
  const it = bridge.recv()[Symbol.asyncIterator]();
  try {
    while (!upstreamClosed && !bridgeClosed) {
      const next = await Promise.race([
        it.next(),
        upstreamClosedSignal.then(
          () => ({ done: true, value: undefined }) as IteratorResult<Buffer>,
        ),
      ]);
      if (next.done) break;
      const chunk = next.value;
      for (const frame of frameDecoder.feed(chunk)) {
        if (frame.opcode === WS_OPCODE_PING) {
          await bridge.sendFrame(
            encodeWsFrame(WS_OPCODE_PONG, frame.payload, { mask: true }),
          );
          continue;
        }
        if (frame.opcode === WS_OPCODE_PONG) continue;
        if (frame.opcode === WS_OPCODE_CLOSE) {
          bridgeClosed = true;
          break;
        }
        if (
          frame.opcode === WS_OPCODE_BINARY ||
          frame.opcode === WS_OPCODE_TEXT
        ) {
          for (const env of envelopeDecoder.feed(frame.payload)) {
            if (env.type === "text") {
              try {
                socket.write(
                  encodeWsFrame(
                    WS_OPCODE_TEXT,
                    Buffer.from(env.data, "utf-8"),
                    { mask: true },
                  ),
                );
              } catch {
                bridgeClosed = true;
                break;
              }
            } else if (env.type === "binary") {
              try {
                socket.write(
                  encodeWsFrame(
                    WS_OPCODE_BINARY,
                    env.data,
                    { mask: true },
                  ),
                );
              } catch {
                bridgeClosed = true;
                break;
              }
            } else if (env.type === "close") {
              const codeBuf = Buffer.alloc(2);
              codeBuf.writeUInt16BE(env.code, 0);
              try {
                socket.write(
                  encodeWsFrame(WS_OPCODE_CLOSE, codeBuf, { mask: true }),
                );
              } catch {
                /* swallow */
              }
              bridgeClosed = true;
              break;
            }
          }
        }
      }
      if (bridgeClosed) break;
    }
  } catch {
    /* bridge stream closed */
  } finally {
    bridgeClosed = true;
    // Release the recv iterator (esp. when we exited via the
    // upstream-closed race) so the underlying h2 stream queue isn't
    // left with a parked consumer.
    try {
      await it.return?.();
    } catch {
      /* swallow */
    }
  }
}

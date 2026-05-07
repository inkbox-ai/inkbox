/**
 * WebSocket over h2 (RFC 8441) + callable test.
 *
 * Drives an `InkboxWsHandler` through `H2TranscoderPlaintext` +
 * `CallableDispatch` end-to-end. Constructs a real `http2` client over
 * a paired Duplex, opens an Extended CONNECT stream, and exchanges
 * unmasked WS frames as DATA payloads (RFC 8441 §5.1).
 */

import { describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import { Duplex } from "node:stream";
import { CallableDispatch } from "../../src/tunnels/client/_dispatch.js";
import { H2TranscoderPlaintext } from "../../src/tunnels/client/_h2_transcode.js";
import {
  decodeClientFrame,
  encodeServerFrame,
} from "../../src/tunnels/client/_ws_passthrough.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WS_OPCODE_TEXT,
} from "../../src/tunnels/client/_wsframe.js";

class PairedDuplex extends Duplex {
  peer!: PairedDuplex;
  inbound: Buffer[] = [];

  constructor() {
    super({ allowHalfOpen: true });
  }

  static pair(): [PairedDuplex, PairedDuplex] {
    const a = new PairedDuplex();
    const b = new PairedDuplex();
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  pushIncoming(buf: Buffer): void {
    this.inbound.push(buf);
    this._read(0);
  }

  override _read(_size: number): void {
    while (this.inbound.length > 0) {
      const c = this.inbound.shift()!;
      if (!this.push(c)) return;
    }
  }

  override _write(
    chunk: Buffer | string,
    _enc: string,
    cb: (err?: Error | null) => void,
  ): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.peer.pushIncoming(buf);
    cb();
  }

  override _final(cb: (err?: Error | null) => void): void {
    cb();
  }
}

describe("ws over h2 + callable", () => {
  it("round-trips frames over Extended CONNECT", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        await ws.accept();
        for await (const msg of ws) {
          if (typeof msg === "string") {
            await ws.send(`echo:${msg}`);
          }
          break;
        }
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (chunk: Buffer) => void transcoder.feed(chunk));
    void transcoder.pumpOutbound(async (c) => {
      clientSide.pushIncoming(c);
    });

    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });
    // Wait for the server's SETTINGS so the client knows enableConnectProtocol.
    await new Promise<void>((resolve) => {
      session.once("remoteSettings", () => resolve());
      setTimeout(resolve, 1000);
    });

    const req = session.request({
      ":method": "CONNECT",
      ":protocol": "websocket",
      ":path": "/ws",
      ":authority": "agent.test",
    });

    const status = await new Promise<number>((resolve, reject) => {
      req.on("response", (h) => resolve(Number(h[":status"])));
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout-status")), 3000);
    });
    expect(status).toBe(200);

    // Send unmasked TEXT frame as DATA.
    const textFrame = encodeServerFrame(WS_OPCODE_TEXT, Buffer.from("hello-h2"));
    req.write(textFrame);

    // Read DATA frames from the server until we see a TEXT echo.
    const recv = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const onData = (c: Buffer | string) => {
        const buf = typeof c === "string" ? Buffer.from(c) : c;
        chunks.push(buf);
        const merged: Buffer[] = [Buffer.concat(chunks)];
        const decoded = decodeClientFrame(merged, { requireMask: false });
        if (decoded.kind === "frame" && decoded.opcode === WS_OPCODE_TEXT) {
          resolve(decoded.payload);
        }
      };
      req.on("data", onData);
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout-data")), 3000);
    });
    expect(recv.toString("utf-8")).toBe("echo:hello-h2");

    // Send CLOSE.
    const closeFrame = encodeServerFrame(
      WS_OPCODE_CLOSE,
      Buffer.from([0x03, 0xe8]),
    );
    req.write(closeFrame);

    session.close();
    await transcoder.aclose();
  }, 15_000);

  it("returns :status 403 when handler closes before accept", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        await ws.close(1008, "policy");
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (c: Buffer) => void transcoder.feed(c));
    void transcoder.pumpOutbound(async (c) => {
      clientSide.pushIncoming(c);
    });
    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });
    await new Promise<void>((resolve) => {
      session.once("remoteSettings", () => resolve());
      setTimeout(resolve, 1000);
    });
    const status = await new Promise<number>((resolve, reject) => {
      const req = session.request({
        ":method": "CONNECT",
        ":protocol": "websocket",
        ":path": "/ws",
        ":authority": "agent.test",
      });
      req.on("response", (h) => resolve(Number(h[":status"])));
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    expect(status).toBe(403);
    session.close();
    await transcoder.aclose();
  }, 15_000);

  it("propagates BINARY frames in both directions", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never"),
      wsHandler: async (ws) => {
        await ws.accept();
        for await (const msg of ws) {
          if (Buffer.isBuffer(msg)) {
            await ws.send(Buffer.from([...msg, 0xff]));
          }
          break;
        }
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (c: Buffer) => void transcoder.feed(c));
    void transcoder.pumpOutbound(async (c) => {
      clientSide.pushIncoming(c);
    });
    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });
    await new Promise<void>((resolve) => {
      session.once("remoteSettings", () => resolve());
      setTimeout(resolve, 1000);
    });

    const req = session.request({
      ":method": "CONNECT",
      ":protocol": "websocket",
      ":path": "/binws",
      ":authority": "agent.test",
    });
    const status = await new Promise<number>((resolve, reject) => {
      req.on("response", (h) => resolve(Number(h[":status"])));
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout-status")), 3000);
    });
    expect(status).toBe(200);

    const binFrame = encodeServerFrame(
      WS_OPCODE_BINARY, Buffer.from([1, 2, 3]),
    );
    req.write(binFrame);

    const recv = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer | string) => {
        const buf = typeof c === "string" ? Buffer.from(c) : c;
        chunks.push(buf);
        const merged: Buffer[] = [Buffer.concat(chunks)];
        const decoded = decodeClientFrame(merged, { requireMask: false });
        if (decoded.kind === "frame" && decoded.opcode === WS_OPCODE_BINARY) {
          resolve(decoded.payload);
        }
      });
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout-data")), 3000);
    });
    expect(Array.from(recv)).toEqual([1, 2, 3, 0xff]);

    const closeFrame = encodeServerFrame(
      WS_OPCODE_CLOSE, Buffer.from([0x03, 0xe8]),
    );
    req.write(closeFrame);
    session.close();
    await transcoder.aclose();
  }, 15_000);
});

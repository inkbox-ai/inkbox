/**
 * WS-over-h2 → URL upstream bridging.
 *
 * Stands up a tiny raw-socket WS upstream that echoes frames; opens an
 * Extended CONNECT through `H2TranscoderPlaintext` + `UpstreamUrlDispatch`
 * and verifies frames flow through verbatim.
 */

import { describe, expect, it } from "vitest";
import * as net from "node:net";
import * as http2 from "node:http2";
import { createHash } from "node:crypto";
import { Duplex } from "node:stream";
import { UpstreamUrlDispatch } from "../../src/tunnels/client/_dispatch.js";
import { H2TranscoderPlaintext } from "../../src/tunnels/client/_h2_transcode.js";
import {
  decodeClientFrame,
  encodeServerFrame,
} from "../../src/tunnels/client/_ws_passthrough.js";
import {
  WS_OPCODE_CLOSE,
  WS_OPCODE_TEXT,
} from "../../src/tunnels/client/_wsframe.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptFor(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID, "ascii")
    .digest("base64");
}

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

async function spawnEchoUpstream(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = net.createServer((sock) => {
    let head = Buffer.alloc(0);
    let inUpgrade = true;
    const buf: Buffer[] = [];

    sock.on("data", (chunk: Buffer) => {
      if (inUpgrade) {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headText = head.subarray(0, idx).toString("ascii");
        const rest = head.subarray(idx + 4);
        let key = "";
        for (const line of headText.split("\r\n").slice(1)) {
          const ci = line.indexOf(":");
          if (ci === -1) continue;
          if (line.slice(0, ci).trim().toLowerCase() === "sec-websocket-key") {
            key = line.slice(ci + 1).trim();
          }
        }
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${acceptFor(key)}\r\n\r\n`,
            "ascii",
          ),
        );
        inUpgrade = false;
        if (rest.length > 0) buf.push(rest);
      } else {
        buf.push(chunk);
      }
      // Decode any complete client (masked) frames and echo back unmasked.
      while (true) {
        const decoded = decodeClientFrame(buf, { requireMask: true });
        if (decoded.kind !== "frame") break;
        const { opcode, payload } = decoded;
        if (opcode === WS_OPCODE_CLOSE) {
          sock.write(encodeServerFrame(WS_OPCODE_CLOSE, payload));
          sock.end();
          sock.destroy();
          return;
        }
        sock.write(
          encodeServerFrame(
            opcode === 0x0 ? WS_OPCODE_TEXT : opcode,
            payload,
          ),
        );
      }
    });

    sock.on("error", () => {
      /* swallow */
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () =>
      new Promise<void>((r) => server.close(() => r())),
  };
}

async function spawnBadAcceptUpstream(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  // Always returns 101 with a wrong Sec-WebSocket-Accept; bridge must
  // refuse and surface a non-200 to the third party.
  const server = net.createServer((sock) => {
    let head = Buffer.alloc(0);
    sock.on("data", (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      if (head.indexOf("\r\n\r\n") === -1) return;
      sock.write(
        Buffer.from(
          "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: AAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n\r\n",
          "ascii",
        ),
      );
    });
    sock.on("error", () => {
      /* swallow */
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("ws over h2 → url upstream", () => {
  it("bridges a TEXT echo through the transcoder", async () => {
    const upstream = await spawnEchoUpstream();
    try {
      const dispatch = new UpstreamUrlDispatch({
        forwardTo: `http://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxOutboundBodyBytes: 1_000_000,
        maxInboundBodyBytes: 1_000_000,
      });
      try {
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
          ":path": "/ws",
          ":authority": "agent.test",
        });
        // Attach data listener up-front so frames coming back from the
        // bridge are buffered into our matcher before we await.
        const dataBuf: Buffer[] = [];
        let dataResolver: ((b: Buffer) => void) | null = null;
        const tryDeliver = (): void => {
          if (dataResolver === null) return;
          const decoded = decodeClientFrame(dataBuf, { requireMask: false });
          if (decoded.kind === "frame" && decoded.opcode === WS_OPCODE_TEXT) {
            const r = dataResolver;
            dataResolver = null;
            r(decoded.payload);
          }
        };
        req.on("data", (c: Buffer | string) => {
          const b = typeof c === "string" ? Buffer.from(c) : c;
          dataBuf.push(b);
          tryDeliver();
        });

        const status = await new Promise<number>((resolve, reject) => {
          req.on("response", (h) => resolve(Number(h[":status"])));
          req.on("error", reject);
          setTimeout(() => reject(new Error("timeout-status")), 5000);
        });
        expect(status).toBe(200);

        // Send TEXT (unmasked, h2).
        req.write(encodeServerFrame(WS_OPCODE_TEXT, Buffer.from("ping-bridge")));

        const recv = await new Promise<Buffer>((resolve, reject) => {
          dataResolver = resolve;
          tryDeliver();
          setTimeout(() => reject(new Error("timeout-data")), 5000);
        });
        expect(recv.toString("utf-8")).toBe("ping-bridge");

        // Tear down: write CLOSE, end the request, give the bridge a
        // tick to forward it upstream and clean up before we kill the
        // session and the transcoder.
        req.write(encodeServerFrame(WS_OPCODE_CLOSE, Buffer.from([0x03, 0xe8])));
        req.end();
        await new Promise((r) => setTimeout(r, 100));
        session.destroy();
        await transcoder.aclose();
      } finally {
        await dispatch.aclose();
      }
    } finally {
      await upstream.close();
    }
  }, 20_000);

  it("rejects when upstream returns wrong Sec-WebSocket-Accept", async () => {
    const upstream = await spawnBadAcceptUpstream();
    try {
      const dispatch = new UpstreamUrlDispatch({
        forwardTo: `http://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxOutboundBodyBytes: 1_000_000,
        maxInboundBodyBytes: 1_000_000,
      });
      try {
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
          ":path": "/ws",
          ":authority": "agent.test",
        });
        const status = await new Promise<number>((resolve, reject) => {
          req.on("response", (h) => resolve(Number(h[":status"])));
          req.on("error", reject);
          setTimeout(() => reject(new Error("timeout-status")), 5000);
        });
        // Wrong accept → 502 surfaced to the third party (NOT 200).
        expect(status).toBe(502);
        session.destroy();
        await transcoder.aclose();
      } finally {
        await dispatch.aclose();
      }
    } finally {
      await upstream.close();
    }
  }, 20_000);
});

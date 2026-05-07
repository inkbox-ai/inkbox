/**
 * End-to-end edge URL WebSocket bridge tests.
 *
 * Drives `TunnelRuntime.dispatchWsUpgradeToUrl` through a real
 * `FakeH2Server` + a real WS upstream socket. Catches the lifecycle
 * bug where the bridge CONNECT stream never opens (the helper-only
 * `ws_edge_url.test.ts` cannot see this — it stops at the upstream
 * handshake hop).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as net from "node:net";
import * as http2 from "node:http2";
import { createHash } from "node:crypto";
import { TunnelRuntime } from "../../src/tunnels/client/_runtime.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_TEXT,
  WsFrameDecoder,
  encodeWsEnvelope,
  encodeWsFrame,
} from "../../src/tunnels/client/_wsframe.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

interface EchoUpstream {
  port: number;
  awaitNextFrame: (
    timeoutMs?: number,
  ) => Promise<{ opcode: number; payload: Buffer }>;
  sendFrameToBridge: (opcode: number, payload: Buffer) => Promise<void>;
  close: () => Promise<void>;
}

async function spawnEchoUpstream(): Promise<EchoUpstream> {
  const decoder = new WsFrameDecoder();
  const queue: Array<{ opcode: number; payload: Buffer }> = [];
  const waiters: Array<(f: { opcode: number; payload: Buffer }) => void> = [];
  let activeSocket: net.Socket | null = null;

  const server = net.createServer((sock) => {
    activeSocket = sock;
    let head = Buffer.alloc(0);
    let upgraded = false;
    sock.on("data", (chunk: Buffer) => {
      if (!upgraded) {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headText = head.subarray(0, idx).toString("ascii");
        let key = "";
        for (const line of headText.split("\r\n").slice(1)) {
          const ci = line.indexOf(":");
          if (ci === -1) continue;
          if (line.slice(0, ci).trim().toLowerCase() === "sec-websocket-key") {
            key = line.slice(ci + 1).trim();
          }
        }
        const accept = createHash("sha1")
          .update(key + WS_GUID, "ascii")
          .digest("base64");
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
            "ascii",
          ),
        );
        upgraded = true;
        const trailing = head.subarray(idx + 4);
        if (trailing.length > 0) {
          for (const f of decoder.feed(trailing)) {
            const item = { opcode: f.opcode, payload: f.payload };
            const w = waiters.shift();
            if (w) w(item);
            else queue.push(item);
          }
        }
        return;
      }
      for (const f of decoder.feed(chunk)) {
        const item = { opcode: f.opcode, payload: f.payload };
        const w = waiters.shift();
        if (w) w(item);
        else queue.push(item);
      }
    });
    sock.on("error", () => undefined);
    sock.on("close", () => {
      if (activeSocket === sock) activeSocket = null;
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;

  return {
    port,
    awaitNextFrame: (timeoutMs = 5000) =>
      new Promise((resolve, reject) => {
        const queued = queue.shift();
        if (queued !== undefined) {
          resolve(queued);
          return;
        }
        const timer = setTimeout(
          () => reject(new Error("awaitNextFrame timeout")),
          timeoutMs,
        );
        waiters.push((f) => {
          clearTimeout(timer);
          resolve(f);
        });
      }),
    sendFrameToBridge: (opcode, payload) =>
      new Promise((resolve, reject) => {
        if (activeSocket === null) {
          reject(new Error("upstream not connected"));
          return;
        }
        // Server -> client direction: must be unmasked.
        activeSocket.write(
          encodeWsFrame(opcode, payload, { mask: false }),
          (err) => (err ? reject(err) : resolve()),
        );
      }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server({
    helloBody: {
      owner_token: "tok-test",
      default_pool_size: 1,
      response_deadline_seconds: 30,
      intake_idle_seconds: 600,
    },
  });
});

afterEach(async () => {
  await fakeServer.close();
});

describe("WS edge URL forward — bridge stream lifecycle (Finding 1 regression)", () => {
  it("opens the bridge CONNECT stream and round-trips frames between bridge and URL upstream", async () => {
    const upstream = await spawnEchoUpstream();
    try {
      fakeServer.setIntakeResponse({
        status: 200,
        headers: [
          ["inkbox-request-id", "req-edge-url-1"],
          ["inkbox-method", "GET"],
          ["inkbox-path", "/ws"],
          ["inkbox-route-kind", "ws-upgrade"],
          ["inkbox-ws-id", "ws-edge-1"],
        ],
        body: Buffer.alloc(0),
      });

      const runtime = new TunnelRuntime({
        tunnelId: "22222222-2222-2222-2222-222222222222",
        secret: "sek-test",
        zone: fakeServer.authority,
        publicHost: "agent.test",
        poolSize: null,
        // URL forward only — no wsHandler. The Finding 1 path.
        dispatch: { forwardTo: `http://127.0.0.1:${upstream.port}` },
        http2Connect: (authority, options) =>
          http2.connect(authority, {
            ...(options as object),
            rejectUnauthorized: false,
          } as http2.SecureClientSessionOptions),
      });
      const servePromise = runtime.serveForever();

      // Runtime should: open upstream WS, then post 200 + open the
      // bridge CONNECT stream (the bug: it skipped the bridge open).
      const responsePost = await fakeServer.awaitResponsePost(
        "req-edge-url-1",
        5000,
      );
      expect(responsePost.headers["inkbox-status"]).toBe("200");

      // Bridge stream must actually open. Without the fix this times
      // out — connectStreamId stays null inside openWsBridge.
      const bridgeStream = await fakeServer.awaitNextBridgeStream(
        "/_system/ws/ws-edge-1",
        5000,
      );
      bridgeStream.respond({ ":status": 200 });

      // Bridge -> upstream: send a TEXT envelope, expect a TEXT frame at
      // upstream.
      const env = encodeWsEnvelope({
        type: "websocket.send",
        text: "hello-from-bridge",
      });
      bridgeStream.write(
        encodeWsFrame(WS_OPCODE_BINARY, env, { mask: false }),
      );
      const upstreamFrame = await upstream.awaitNextFrame(5000);
      expect(upstreamFrame.opcode).toBe(WS_OPCODE_TEXT);
      expect(upstreamFrame.payload.toString("utf-8")).toBe(
        "hello-from-bridge",
      );

      // Upstream -> bridge: send a BINARY frame, expect a websocket.send
      // bytes envelope on the bridge.
      const upstreamPayload = Buffer.from([0x01, 0x02, 0x03, 0xff, 0x80]);
      await upstream.sendFrameToBridge(WS_OPCODE_BINARY, upstreamPayload);

      const bridgeChunks: Buffer[] = [];
      const bridgeReady = new Promise<void>((resolve) => {
        const onData = (chunk: Buffer | string): void => {
          bridgeChunks.push(
            Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
          );
          // 4 bytes of WS frame header is the minimum, then envelope...
          if (Buffer.concat(bridgeChunks).length > 4) resolve();
        };
        bridgeStream.on("data", onData);
      });
      await Promise.race([
        bridgeReady,
        new Promise((_, rej) =>
          setTimeout(() => rej(new Error("bridge data timeout")), 5000),
        ),
      ]);
      // Decode the outer WS frame from the bridge (server -> client,
      // unmasked from runtime's perspective as h1 client to bridge —
      // actually the runtime IS h1 client to the bridge so it MASKS).
      const bridgeOuter = new WsFrameDecoder();
      const frames = bridgeOuter.feed(Buffer.concat(bridgeChunks));
      expect(frames.length).toBeGreaterThanOrEqual(1);
      // Inner envelope decode:
      const { WsEnvelopeDecoder } = await import(
        "../../src/tunnels/client/_wsframe.js"
      );
      const envDecoder = new WsEnvelopeDecoder();
      let sawBinaryEcho = false;
      for (const f of frames) {
        for (const e of envDecoder.feed(f.payload)) {
          if (e.type === "binary") {
            expect(Array.from(e.data)).toEqual(Array.from(upstreamPayload));
            sawBinaryEcho = true;
          }
        }
      }
      expect(sawBinaryEcho).toBe(true);

      await runtime.aclose();
      await servePromise;
    } finally {
      await upstream.close();
    }
  }, 15_000);
});

describe("WS edge URL forward — upstream 101 response headers", () => {
  it("forwards application-defined upgrade response headers to the third party", async () => {
    // Upstream that completes the 101 with extra app-defined headers
    // (X-Use-Inkbox-* opt-out flags, Set-Cookie, custom value).
    const appHeaderServer = net.createServer((sock) => {
      let head = Buffer.alloc(0);
      sock.on("data", (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headText = head.subarray(0, idx).toString("ascii");
        let key = "";
        for (const line of headText.split("\r\n").slice(1)) {
          const ci = line.indexOf(":");
          if (ci === -1) continue;
          if (line.slice(0, ci).trim().toLowerCase() === "sec-websocket-key") {
            key = line.slice(ci + 1).trim();
          }
        }
        const accept = createHash("sha1")
          .update(key + WS_GUID, "ascii")
          .digest("base64");
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n` +
              "X-Custom: value-1\r\n" +
              "X-Use-Inkbox-Text-To-Speech: false\r\n" +
              "X-Use-Inkbox-Speech-To-Text: false\r\n" +
              "Set-Cookie: session=abc; Path=/\r\n\r\n",
            "ascii",
          ),
        );
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) =>
      appHeaderServer.listen(0, "127.0.0.1", () => r()),
    );
    const port = (appHeaderServer.address() as net.AddressInfo).port;
    try {
      fakeServer.setIntakeResponse({
        status: 200,
        headers: [
          ["inkbox-request-id", "req-edge-headers"],
          ["inkbox-method", "GET"],
          ["inkbox-path", "/ws"],
          ["inkbox-route-kind", "ws-upgrade"],
          ["inkbox-ws-id", "ws-headers"],
        ],
        body: Buffer.alloc(0),
      });

      const runtime = new TunnelRuntime({
        tunnelId: "44444444-4444-4444-4444-444444444444",
        secret: "sek-test",
        zone: fakeServer.authority,
        publicHost: "agent.test",
        poolSize: null,
        dispatch: { forwardTo: `http://127.0.0.1:${port}` },
        http2Connect: (authority, options) =>
          http2.connect(authority, {
            ...(options as object),
            rejectUnauthorized: false,
          } as http2.SecureClientSessionOptions),
      });
      const servePromise = runtime.serveForever();

      const responsePost = await fakeServer.awaitResponsePost(
        "req-edge-headers",
        5000,
      );
      // The fake server's awaitResponsePost returns parsed h2 headers
      // as an object; iterate and verify the app headers are present.
      expect(responsePost.headers["inkbox-status"]).toBe("200");

      // Drill down into the inkbox-h-* prefixed headers — that's the
      // wire shape for forwarded response headers via the bridge.
      // (postResponse encodes headers as "inkbox-h-<name>: <value>".)
      const lower = (k: string) => k.toLowerCase();
      const sawHeader = (
        name: string, expectedValue: string,
      ): boolean => {
        for (const [k, v] of Object.entries(responsePost.headers)) {
          const kl = lower(k);
          if (kl === `inkbox-h-${name}` && v === expectedValue) return true;
          if (Array.isArray(v)) {
            for (const vi of v) {
              if (kl === `inkbox-h-${name}` && vi === expectedValue) return true;
            }
          }
        }
        return false;
      };

      expect(sawHeader("x-custom", "value-1")).toBe(true);
      expect(sawHeader("x-use-inkbox-text-to-speech", "false")).toBe(true);
      expect(sawHeader("x-use-inkbox-speech-to-text", "false")).toBe(true);
      expect(sawHeader("set-cookie", "session=abc; Path=/")).toBe(true);

      // Hop-by-hop and handshake-control must NOT be forwarded.
      const wireKeys = Object.keys(responsePost.headers).map(lower);
      expect(wireKeys).not.toContain("inkbox-h-connection");
      expect(wireKeys).not.toContain("inkbox-h-upgrade");
      expect(wireKeys).not.toContain("inkbox-h-sec-websocket-accept");
      expect(wireKeys).not.toContain("inkbox-h-sec-websocket-key");

      await runtime.aclose();
      await servePromise;
    } finally {
      await new Promise<void>((r) => appHeaderServer.close(() => r()));
    }
  }, 15_000);
});

describe("WS edge URL forward — abrupt upstream close (Finding 2 regression)", () => {
  it("ends the bridge pump promptly when the upstream socket closes without a CLOSE frame", async () => {
    // Upstream that completes the 101 handshake then immediately
    // destroys the socket — simulates an upstream crash / RST mid-WS.
    const dropServer = net.createServer((sock) => {
      let head = Buffer.alloc(0);
      sock.on("data", (chunk: Buffer) => {
        head = Buffer.concat([head, chunk]);
        const idx = head.indexOf("\r\n\r\n");
        if (idx === -1) return;
        const headText = head.subarray(0, idx).toString("ascii");
        let key = "";
        for (const line of headText.split("\r\n").slice(1)) {
          const ci = line.indexOf(":");
          if (ci === -1) continue;
          if (line.slice(0, ci).trim().toLowerCase() === "sec-websocket-key") {
            key = line.slice(ci + 1).trim();
          }
        }
        const accept = createHash("sha1")
          .update(key + WS_GUID, "ascii")
          .digest("base64");
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
            "ascii",
          ),
          () => {
            // Flush, then drop on the floor.
            try { sock.destroy(); } catch { /* swallow */ }
          },
        );
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) =>
      dropServer.listen(0, "127.0.0.1", () => r()),
    );
    const port = (dropServer.address() as net.AddressInfo).port;
    try {
      fakeServer.setIntakeResponse({
        status: 200,
        headers: [
          ["inkbox-request-id", "req-edge-drop"],
          ["inkbox-method", "GET"],
          ["inkbox-path", "/ws"],
          ["inkbox-route-kind", "ws-upgrade"],
          ["inkbox-ws-id", "ws-drop"],
        ],
        body: Buffer.alloc(0),
      });

      const runtime = new TunnelRuntime({
        tunnelId: "33333333-3333-3333-3333-333333333333",
        secret: "sek-test",
        zone: fakeServer.authority,
        publicHost: "agent.test",
        poolSize: null,
        dispatch: { forwardTo: `http://127.0.0.1:${port}` },
        http2Connect: (authority, options) =>
          http2.connect(authority, {
            ...(options as object),
            rejectUnauthorized: false,
          } as http2.SecureClientSessionOptions),
      });
      const servePromise = runtime.serveForever();

      const responsePost = await fakeServer.awaitResponsePost(
        "req-edge-drop",
        5000,
      );
      expect(responsePost.headers["inkbox-status"]).toBe("200");

      // The bridge stream opens — so far so good. The third party
      // never sends a frame; the upstream is already gone. Without
      // wakeup, the pump would sit inside bridge.recv() until the
      // third party closes.
      const bridgeStream = await fakeServer.awaitNextBridgeStream(
        "/_system/ws/ws-drop",
        5000,
      );
      bridgeStream.respond({ ":status": 200 });

      // Wait for the runtime to react to the upstream close. With
      // the wakeup in place, the pump exits → bridge stream end()s →
      // we observe the stream's "end" event quickly (well under 1s).
      const bridgeEnded = new Promise<void>((resolve) => {
        bridgeStream.once("end", () => resolve());
        bridgeStream.once("close", () => resolve());
      });
      await Promise.race([
        bridgeEnded,
        new Promise((_, rej) =>
          setTimeout(
            () => rej(new Error("bridge did not end after upstream close")),
            3000,
          ),
        ),
      ]);

      await runtime.aclose();
      await servePromise;
    } finally {
      await new Promise<void>((r) => dropServer.close(() => r()));
    }
  }, 15_000);
});

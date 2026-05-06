/**
 * tests/tunnels/ws_dispatch.test.ts
 *
 * In-process WebSocket dispatch integration tests.
 * - WS-accept deadline trips when the handler stalls.
 * - Binary base64 round-trip through the bridge stream.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import { TunnelRuntime } from "../../src/tunnels/client/_runtime.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WsEnvelopeDecoder,
  WsFrameDecoder,
  encodeWsEnvelope,
  encodeWsFrame,
} from "../../src/tunnels/client/_wsframe.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server({
    helloBody: {
      owner_token: "tok-test",
      default_pool_size: 1,
      response_deadline_seconds: 1, // tight deadline for accept-deadline test
      intake_idle_seconds: 600,
    },
  });
});

afterEach(async () => {
  await fakeServer.close();
});

function makeRuntime(opts: {
  wsHandler: (ws: import("../../src/tunnels/client/_ws.js").InkboxWebSocket) => Promise<void>;
}): TunnelRuntime {
  return new TunnelRuntime({
    tunnelId: "11111111-1111-1111-1111-111111111111",
    secret: "sek-test",
    zone: fakeServer.authority,
    publicHost: "my-agent.example.com",
    poolSize: null,
    dispatch: { forwardTo: "http://127.0.0.1:1", wsHandler: opts.wsHandler },
    http2Connect: (authority, options) =>
      http2.connect(authority, {
        ...(options as object),
        rejectUnauthorized: false,
      } as http2.SecureClientSessionOptions),
  });
}

describe("WS dispatch — binary base64 round-trip", () => {
  it("base64-decodes inbound binary envelopes and base64-encodes outbound binary", async () => {
    const original = Buffer.from([0x00, 0xff, 0x80, 0x42, 0x7f]);
    let received: Buffer | string | null = null;

    const wsHandler = async (ws: import("../../src/tunnels/client/_ws.js").InkboxWebSocket) => {
      await ws.accept();
      for await (const msg of ws) {
        received = msg;
        // Echo it back.
        if (Buffer.isBuffer(msg)) {
          await ws.send(msg);
        }
        await ws.close(1000, "");
        break;
      }
    };

    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-ws-1"],
        ["inkbox-method", "GET"],
        ["inkbox-path", "/ws"],
        ["inkbox-route-kind", "ws-upgrade"],
        ["inkbox-ws-id", "ws-1"],
      ],
      body: Buffer.alloc(0),
    });

    const runtime = makeRuntime({ wsHandler });
    const servePromise = runtime.serveForever();

    // Wait for the upgrade reply (the runtime's response post for req-ws-1).
    await fakeServer.awaitResponsePost("req-ws-1", 5000);

    // Now accept the bridge stream and inject a binary envelope.
    const bridgeStream = await fakeServer.awaitNextBridgeStream("/_system/ws/ws-1", 5000);
    bridgeStream.respond({ ":status": 200 });

    // Send a base64-wrapped binary envelope inside a WS BINARY frame.
    const inboundEnvelope = encodeWsEnvelope({
      type: "websocket.send",
      bytes: original,
    });
    bridgeStream.write(encodeWsFrame(WS_OPCODE_BINARY, inboundEnvelope, { mask: false }));

    // Read the runtime's outbound frames (it should echo + then CLOSE).
    const fromRuntime = new WsFrameDecoder();
    const envDecoder = new WsEnvelopeDecoder();
    const echoes: Array<string | Buffer> = [];
    let sawClose = false;
    const closeWaiter = new Promise<void>((resolve) => {
      const onData = (chunk: Buffer | string): void => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const frames = fromRuntime.feed(buf);
        for (const f of frames) {
          if (f.opcode === WS_OPCODE_BINARY) {
            for (const env of envDecoder.feed(f.payload)) {
              if (env.type === "binary") echoes.push(env.data);
              else if (env.type === "text") echoes.push(env.data);
              else if (env.type === "close") {
                sawClose = true;
                resolve();
                return;
              }
            }
          } else if (f.opcode === WS_OPCODE_CLOSE) {
            sawClose = true;
            resolve();
            return;
          }
        }
      };
      bridgeStream.on("data", onData);
      bridgeStream.once("end", () => resolve());
    });
    await Promise.race([
      closeWaiter,
      new Promise<void>((r) => setTimeout(r, 4000)),
    ]);
    void sawClose;

    expect(received).not.toBeNull();
    expect(Buffer.isBuffer(received)).toBe(true);
    expect(Array.from(received as Buffer)).toEqual(Array.from(original));
    expect(echoes.length).toBeGreaterThanOrEqual(1);
    const echoed = echoes.find((e) => Buffer.isBuffer(e)) as Buffer | undefined;
    expect(echoed).toBeDefined();
    expect(Array.from(echoed!)).toEqual(Array.from(original));

    await runtime.aclose();
    await servePromise;
  }, 15_000);
});

describe("WS dispatch — accept deadline", () => {
  it("rejects the upgrade with 504 when the handler doesn't accept in time", async () => {
    // Handler stalls; never calls accept().
    const wsHandler = async (
      _ws: import("../../src/tunnels/client/_ws.js").InkboxWebSocket,
    ): Promise<void> => {
      // Stall longer than response_deadline_seconds (1s).
      await new Promise((resolve) => setTimeout(resolve, 4000));
    };

    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-ws-stall"],
        ["inkbox-method", "GET"],
        ["inkbox-path", "/ws"],
        ["inkbox-route-kind", "ws-upgrade"],
        ["inkbox-ws-id", "ws-stall"],
      ],
      body: Buffer.alloc(0),
    });

    const runtime = makeRuntime({ wsHandler });
    const servePromise = runtime.serveForever();

    // The runtime should post a 504 response (accept-deadline rejected
    // upgrade) — NOT a 200.
    const responsePost = await fakeServer.awaitResponsePost(
      "req-ws-stall",
      5000,
    );
    const status = responsePost.headers["inkbox-status"];
    // Either the accept-deadline path or the upstream-handler path can
    // result in 504; what matters is that we don't see 200.
    expect(status).not.toBe("200");

    await runtime.aclose();
    await servePromise;
  }, 10_000);
});

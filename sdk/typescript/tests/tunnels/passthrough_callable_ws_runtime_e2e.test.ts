/**
 * Runtime-level e2e for passthrough + ``CallableDispatch.dispatchWebSocket``.
 *
 * Drives ``TunnelRuntime.dispatchTcpStream`` against ``FakeH2Server`` with
 * a real third-party ``tls.connect`` riding the bridge stream, then opens
 * an h2 session over that TLS and issues an RFC 8441 Extended CONNECT
 * (``:method CONNECT :protocol websocket``) — which is the path the
 * Inkbox phone backend uses for WS upgrades. Verifies the customer's
 * ``wsHandler`` actually fires and frames round-trip end-to-end.
 *
 * The h1 sibling case (``Upgrade: websocket``) is exercised separately;
 * h2 is the priority repro because that's what the failing call uses.
 *
 * Companion to ``passthrough_callable_e2e.test.ts`` (HTTP-only). Named
 * with ``_ws_runtime_e2e`` so a future reader can find "the test that
 * validates passthrough+callable+wsHandler end-to-end" without reading
 * test bodies.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Duplex } from "node:stream";
import * as http2 from "node:http2";
import * as tls from "node:tls";
import { TunnelRuntime } from "../../src/tunnels/client/_runtime.js";
import { TlsTerminator } from "../../src/tunnels/client/_tls.js";
import {
  WS_OPCODE_BINARY,
  WsFrameDecoder,
  encodeWsFrame,
} from "../../src/tunnels/client/_wsframe.js";
import { generateSelfSignedCert } from "./_test_cert.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

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

/** Bridge a real TLS client to a server-side bridge h2 stream via WS BINARY frames. */
function bridgeDuplex(
  bridgeStream: http2.ServerHttp2Stream,
): Duplex {
  const decoder = new WsFrameDecoder();
  const dx = new Duplex({
    allowHalfOpen: true,
    write(chunk: Buffer | string, _enc, cb) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      const frame = encodeWsFrame(WS_OPCODE_BINARY, buf, { mask: false });
      try {
        bridgeStream.write(frame, (err) => cb(err ?? null));
      } catch (e) {
        cb(e as Error);
      }
    },
    read() { /* push-based via "data" listener below */ },
    final(cb) { cb(); },
  });
  bridgeStream.on("data", (chunk: Buffer | string) => {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    for (const frame of decoder.feed(buf)) {
      if (frame.opcode === WS_OPCODE_BINARY) {
        dx.push(frame.payload);
      }
    }
  });
  bridgeStream.on("end", () => dx.push(null));
  bridgeStream.on("close", () => dx.push(null));
  bridgeStream.on("error", (err) => dx.destroy(err));
  return dx;
}

describe("passthrough + CallableDispatch — runtime-level WS e2e (h2 / Extended CONNECT)", () => {
  it("h2 Extended CONNECT through dispatchTcpStream → wsHandler invoked, frames round-trip", async () => {
    const { cert, key } = await generateSelfSignedCert();

    let wsHandlerInvoked = false;
    let wsHandlerSawAccept = false;
    let receivedMsg: string | Buffer | null = null;

    type InkboxWebSocket = import("../../src/tunnels/client/_ws.js").InkboxWebSocket;
    const wsHandler = async (ws: InkboxWebSocket): Promise<void> => {
      wsHandlerInvoked = true;
      await ws.accept();
      wsHandlerSawAccept = true;
      for await (const msg of ws) {
        receivedMsg = msg;
        const text = typeof msg === "string" ? msg : msg.toString("utf-8");
        await ws.send(`echo:${text}`);
        await ws.close(1000, "");
        break;
      }
    };

    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-pt-cb-ws-h2-1"],
        ["inkbox-route-kind", "tcp-stream"],
        ["inkbox-tcp-id", "tcp-pt-cb-ws-h2-1"],
        ["inkbox-sni-host", "agent.test"],
      ],
      body: Buffer.alloc(0),
    });

    const runtime = new TunnelRuntime({
      tunnelId: "66666666-6666-6666-6666-666666666666",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "agent.test",
      poolSize: null,
      dispatch: {
        httpHandler: async () =>
          new Response("not used in this test", { status: 200 }),
        wsHandler,
      },
      tlsTerminator: new TlsTerminator({
        certChainPem: cert,
        keyPem: key,
        // h2 first so ALPN picks h2 (Extended CONNECT requires h2).
        alpnProtocols: ["h2", "http/1.1"],
      }),
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
    });
    const servePromise = runtime.serveForever();

    try {
      const bridgeStream = await fakeServer.awaitNextBridgeStream(
        "/_system/tcp/tcp-pt-cb-ws-h2-1",
        5000,
      );
      bridgeStream.respond({ ":status": 200 });

      const dx = bridgeDuplex(bridgeStream);

      const tlsSock = tls.connect({
        socket: dx as unknown as tls.TLSSocket,
        rejectUnauthorized: false,
        ALPNProtocols: ["h2"],
        servername: "agent.test",
      });
      await new Promise<void>((resolve, reject) => {
        tlsSock.once("secureConnect", () => resolve());
        tlsSock.once("error", reject);
        setTimeout(() => reject(new Error("handshake timeout")), 5_000);
      });

      // Open an h2 session over the TLS-encapsulated bridge.
      const h2session = http2.connect(
        "https://agent.test",
        { createConnection: () => tlsSock } as unknown as http2.ClientSessionOptions,
      );
      await new Promise<void>((resolve, reject) => {
        // Wait for SETTINGS exchange so enableConnectProtocol is
        // negotiated before we send the Extended CONNECT.
        h2session.once("connect", () => resolve());
        h2session.once("error", reject);
        setTimeout(() => reject(new Error("h2 connect timeout")), 5_000);
      });

      // Extended CONNECT (RFC 8441) — :method CONNECT + :protocol.
      const reqStream = h2session.request({
        ":method": "CONNECT",
        ":scheme": "https",
        ":path": "/phone/media/ws",
        ":authority": "agent.test",
        ":protocol": "websocket",
        "sec-websocket-version": "13",
      });

      // Wait for :status 200 (Extended CONNECT success — RFC 8441 §4).
      const statusPromise = new Promise<number>((resolve, reject) => {
        reqStream.once("response", (h) => {
          resolve(Number(h[":status"] ?? 0));
        });
        reqStream.once("error", reject);
        setTimeout(() => reject(new Error("ws upgrade timeout")), 5_000);
      });

      const status = await statusPromise;
      expect(status).toBe(200);
      expect(wsHandlerInvoked).toBe(true);
      expect(wsHandlerSawAccept).toBe(true);

      // Frame round-trip: send a TEXT frame (RFC 8441 §5.1: WS frames
      // ride h2 DATA, unmasked since the h2 stream is the framing
      // boundary).
      const { encodeWsFrame: enc, WS_OPCODE_TEXT } = await import(
        "../../src/tunnels/client/_wsframe.js"
      );
      const textFrame = enc(WS_OPCODE_TEXT, Buffer.from("ping", "utf-8"), {
        mask: false,
      });
      reqStream.write(textFrame);

      const echoChunks: Buffer[] = [];
      const echoPromise = new Promise<void>((resolve, reject) => {
        reqStream.on("data", (c: Buffer | string) => {
          const buf = Buffer.isBuffer(c) ? c : Buffer.from(c);
          echoChunks.push(buf);
          if (Buffer.concat(echoChunks).includes(Buffer.from("echo:ping"))) {
            resolve();
          }
        });
        reqStream.on("error", reject);
        setTimeout(() => reject(new Error("echo timeout")), 5_000);
      });

      await echoPromise;

      const text =
        typeof receivedMsg === "string"
          ? receivedMsg
          : Buffer.isBuffer(receivedMsg)
            ? (receivedMsg as Buffer).toString("utf-8")
            : "";
      expect(text).toBe("ping");

      try { reqStream.close(); } catch { /* swallow */ }
      try { h2session.close(); } catch { /* swallow */ }
    } finally {
      await runtime.aclose();
      await servePromise;
    }
  }, 20_000);
});

describe("passthrough + CallableDispatch — runtime-level WS e2e (multi-call)", () => {
  it("two sequential WS calls on the same runtime should both succeed (regression for second-call hang)", async () => {
    const { cert, key } = await generateSelfSignedCert();

    let invocations = 0;
    type InkboxWebSocket = import("../../src/tunnels/client/_ws.js").InkboxWebSocket;
    const wsHandler = async (ws: InkboxWebSocket): Promise<void> => {
      invocations += 1;
      const myInvocation = invocations;
      await ws.accept();
      for await (const msg of ws) {
        const text = typeof msg === "string" ? msg : msg.toString("utf-8");
        await ws.send(`echo${myInvocation}:${text}`);
        await ws.close(1000, "");
        break;
      }
    };

    const runtime = new TunnelRuntime({
      tunnelId: "88888888-8888-8888-8888-888888888888",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "agent.test",
      poolSize: null,
      dispatch: {
        httpHandler: async () =>
          new Response("not used", { status: 200 }),
        wsHandler,
      },
      tlsTerminator: new TlsTerminator({
        certChainPem: cert,
        keyPem: key,
        alpnProtocols: ["http/1.1"],
      }),
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
    });
    const servePromise = runtime.serveForever();

    const driveOneCall = async (
      requestId: string,
      tcpId: string,
      payload: string,
    ): Promise<string> => {
      fakeServer.setIntakeResponse({
        status: 200,
        headers: [
          ["inkbox-request-id", requestId],
          ["inkbox-route-kind", "tcp-stream"],
          ["inkbox-tcp-id", tcpId],
          ["inkbox-sni-host", "agent.test"],
        ],
        body: Buffer.alloc(0),
      });

      const bridgeStream = await fakeServer.awaitNextBridgeStream(
        `/_system/tcp/${tcpId}`,
        5000,
      );
      bridgeStream.respond({ ":status": 200 });

      const dx = bridgeDuplex(bridgeStream);
      const client = tls.connect({
        socket: dx as unknown as tls.TLSSocket,
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
        servername: "agent.test",
      });
      await new Promise<void>((resolve, reject) => {
        client.once("secureConnect", () => resolve());
        client.once("error", reject);
        setTimeout(() => reject(new Error(`handshake timeout for ${tcpId}`)), 5_000);
      });

      const wsKey = "dGhlIHNhbXBsZSBub25jZQ==";
      const respChunks: Buffer[] = [];
      const upgradePromise = new Promise<Buffer>((resolve, reject) => {
        const checkDone = (): void => {
          const merged = Buffer.concat(respChunks);
          if (merged.includes("\r\n\r\n")) resolve(merged);
        };
        client.on("data", (c: Buffer) => {
          respChunks.push(c);
          checkDone();
        });
        client.on("error", reject);
        setTimeout(
          () => reject(new Error(`upgrade timeout for ${tcpId}`)),
          5_000,
        );
      });

      client.write(
        `GET /ws HTTP/1.1\r\n` +
          "Host: agent.test\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );

      const head = (await upgradePromise).toString("utf-8");
      if (!/HTTP\/1\.1 101/.test(head)) {
        throw new Error(`upgrade did not 101 for ${tcpId}: ${head.slice(0, 200)}`);
      }

      const { encodeWsFrame: enc, WS_OPCODE_TEXT } = await import(
        "../../src/tunnels/client/_wsframe.js"
      );
      const masked = enc(WS_OPCODE_TEXT, Buffer.from(payload, "utf-8"), {
        mask: true,
      });
      client.write(masked);

      const echoChunks: Buffer[] = [];
      const echoBytes = await new Promise<Buffer>((resolve, reject) => {
        client.on("data", (c: Buffer) => {
          echoChunks.push(c);
          const merged = Buffer.concat(echoChunks);
          // Find an unmasked text echo of "echo<n>:<payload>"
          if (merged.includes(Buffer.from(`:${payload}`))) {
            resolve(merged);
          }
        });
        client.on("error", reject);
        setTimeout(
          () => reject(new Error(`echo timeout for ${tcpId}`)),
          5_000,
        );
      });
      // Tear down client side; SDK pump should observe socket close.
      try { client.end(); } catch { /* swallow */ }

      // Allow the orchestrator's bridge teardown to complete before the
      // next call. The bridge stream's "close" event will fire on the
      // server side; we wait for it.
      await new Promise<void>((resolve) => {
        if (bridgeStream.closed || bridgeStream.destroyed) {
          resolve();
          return;
        }
        bridgeStream.once("close", () => resolve());
        // Bound the wait — if teardown doesn't happen, we want the
        // test to still proceed and fail at the second call (where
        // the visible symptom is).
        setTimeout(resolve, 1_500);
      });

      return echoBytes.toString("utf-8");
    };

    try {
      const first = await driveOneCall("req-call-1", "tcp-call-1", "ping1");
      expect(first).toContain("echo1:ping1");
      expect(invocations).toBe(1);

      // Brief pause to let the SDK re-park its intake slot; the test
      // fixture's setIntakeResponse hands the queued envelope to the
      // already-parked stream, mirroring the real tunnel server's
      // "push to whichever pool slot is parked" behavior.
      await new Promise<void>((r) => setTimeout(r, 100));

      const second = await driveOneCall("req-call-2", "tcp-call-2", "ping2");
      expect(second).toContain("echo2:ping2");
      expect(invocations).toBe(2);

      // Both bridges should have re-parked their intake slot — the
      // pool size is 1, so two successful calls need two re-parks.
      expect(fakeServer.receivedIntakePosts().length).toBeGreaterThanOrEqual(2);
    } finally {
      await runtime.aclose();
      await servePromise;
    }
  }, 30_000);
});

describe("passthrough + CallableDispatch — runtime survives session death (Finding: ERR_HTTP2_INVALID_SESSION retry-storm)", () => {
  it("intake loops do NOT retry-storm on a destroyed session; serveForever reconnects", async () => {
    const { cert, key } = await generateSelfSignedCert();

    type InkboxWebSocket = import("../../src/tunnels/client/_ws.js").InkboxWebSocket;
    const wsHandler = async (ws: InkboxWebSocket): Promise<void> => {
      await ws.accept();
      for await (const msg of ws) {
        const text = typeof msg === "string" ? msg : msg.toString("utf-8");
        await ws.send(`echo:${text}`);
        await ws.close(1000, "");
        break;
      }
    };

    const statusEvents: string[] = [];

    const runtime = new TunnelRuntime({
      tunnelId: "99999999-9999-9999-9999-999999999999",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "agent.test",
      poolSize: null,
      dispatch: {
        httpHandler: async () =>
          new Response("not used", { status: 200 }),
        wsHandler,
      },
      tlsTerminator: new TlsTerminator({
        certChainPem: cert,
        keyPem: key,
        alpnProtocols: ["http/1.1"],
      }),
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
      onStatus: (s) => statusEvents.push(s),
    });
    const servePromise = runtime.serveForever();

    // Wait for the initial connect.
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("initial connect timeout")),
        5_000,
      );
      const check = (): void => {
        if (statusEvents.includes("connected")) {
          clearTimeout(t);
          resolve();
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });
    const connectedCountAfterInitial = statusEvents.filter(
      (s) => s === "connected",
    ).length;
    expect(connectedCountAfterInitial).toBeGreaterThanOrEqual(1);

    // Inject GOAWAY from the server. SDK's session goes terminal.
    // Intake loops will hit ERR_HTTP2_GOAWAY_SESSION on next openStream;
    // pre-fix code treats this as transient and retry-storms forever.
    // Post-fix code exits the slot, lets runOnce return, and
    // serveForever reconnects — observable via a second "connected".
    fakeServer.injectGoaway(http2.constants.NGHTTP2_INTERNAL_ERROR);

    // Wait for a SECOND connected event (the reconnect).
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(
          "did not reconnect within 8s; intake loop retry-storming on dead session",
        )),
        8_000,
      );
      const check = (): void => {
        const connectedCount = statusEvents.filter(
          (s) => s === "connected",
        ).length;
        if (connectedCount > connectedCountAfterInitial) {
          clearTimeout(t);
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });

    expect(statusEvents.filter((s) => s === "connected").length)
      .toBeGreaterThanOrEqual(2);

    await runtime.aclose();
    await servePromise;
  }, 20_000);
});

describe("passthrough + CallableDispatch — runtime-level WS e2e (h1 Upgrade)", () => {
  it("h1 Upgrade: websocket through dispatchTcpStream → wsHandler invoked, frames round-trip", async () => {
    const { cert, key } = await generateSelfSignedCert();

    let wsHandlerInvoked = false;
    let receivedMsg: string | Buffer | null = null;

    type InkboxWebSocket = import("../../src/tunnels/client/_ws.js").InkboxWebSocket;
    const wsHandler = async (ws: InkboxWebSocket): Promise<void> => {
      wsHandlerInvoked = true;
      await ws.accept();
      for await (const msg of ws) {
        receivedMsg = msg;
        const text = typeof msg === "string" ? msg : msg.toString("utf-8");
        await ws.send(`echo:${text}`);
        await ws.close(1000, "");
        break;
      }
    };

    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-pt-cb-ws-h1-1"],
        ["inkbox-route-kind", "tcp-stream"],
        ["inkbox-tcp-id", "tcp-pt-cb-ws-h1-1"],
        ["inkbox-sni-host", "agent.test"],
      ],
      body: Buffer.alloc(0),
    });

    const runtime = new TunnelRuntime({
      tunnelId: "77777777-7777-7777-7777-777777777777",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "agent.test",
      poolSize: null,
      dispatch: {
        httpHandler: async () =>
          new Response("not used in this test", { status: 200 }),
        wsHandler,
      },
      tlsTerminator: new TlsTerminator({
        certChainPem: cert,
        keyPem: key,
        alpnProtocols: ["http/1.1"],
      }),
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
    });
    const servePromise = runtime.serveForever();

    try {
      const bridgeStream = await fakeServer.awaitNextBridgeStream(
        "/_system/tcp/tcp-pt-cb-ws-h1-1",
        5000,
      );
      bridgeStream.respond({ ":status": 200 });

      const dx = bridgeDuplex(bridgeStream);

      const client = tls.connect({
        socket: dx as unknown as tls.TLSSocket,
        rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
        servername: "agent.test",
      });
      await new Promise<void>((resolve, reject) => {
        client.once("secureConnect", () => resolve());
        client.once("error", reject);
        setTimeout(() => reject(new Error("handshake timeout")), 5_000);
      });

      const wsKey = "dGhlIHNhbXBsZSBub25jZQ==";
      const respChunks: Buffer[] = [];
      const upgradePromise = new Promise<Buffer>((resolve, reject) => {
        const checkDone = (): void => {
          const merged = Buffer.concat(respChunks);
          if (merged.includes("\r\n\r\n")) resolve(merged);
        };
        client.on("data", (c: Buffer) => {
          respChunks.push(c);
          checkDone();
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("ws upgrade timeout")), 5_000);
      });

      client.write(
        "GET /phone/media/ws HTTP/1.1\r\n" +
          "Host: agent.test\r\n" +
          "Connection: Upgrade\r\n" +
          "Upgrade: websocket\r\n" +
          `Sec-WebSocket-Key: ${wsKey}\r\n` +
          "Sec-WebSocket-Version: 13\r\n\r\n",
      );

      const head = (await upgradePromise).toString("utf-8");
      expect(head).toMatch(/HTTP\/1\.1 101/);
      expect(wsHandlerInvoked).toBe(true);

      const { encodeWsFrame: enc, WS_OPCODE_TEXT } = await import(
        "../../src/tunnels/client/_wsframe.js"
      );
      // Client → server frames must be masked per RFC 6455.
      const masked = enc(WS_OPCODE_TEXT, Buffer.from("ping", "utf-8"), {
        mask: true,
      });
      client.write(masked);

      const echoChunks: Buffer[] = [];
      const echoPromise = new Promise<void>((resolve, reject) => {
        client.on("data", (c: Buffer) => {
          echoChunks.push(c);
          if (Buffer.concat(echoChunks).includes(Buffer.from("echo:ping"))) {
            resolve();
          }
        });
        client.on("error", reject);
        setTimeout(() => reject(new Error("echo timeout")), 5_000);
      });

      await echoPromise;

      const text =
        typeof receivedMsg === "string"
          ? receivedMsg
          : Buffer.isBuffer(receivedMsg)
            ? (receivedMsg as Buffer).toString("utf-8")
            : "";
      expect(text).toBe("ping");

      try { client.end(); } catch { /* swallow */ }
    } finally {
      await runtime.aclose();
      await servePromise;
    }
  }, 20_000);
});

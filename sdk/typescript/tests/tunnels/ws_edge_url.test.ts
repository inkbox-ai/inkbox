/**
 * Edge-mode URL WS bridging — focused tests for the upstream WS hop.
 *
 * The full bridge-stream pump (`pumpWsUrlEdgeBridge`) requires h2 stream
 * fixtures that mirror the inkbox bridge protocol. Those are exercised
 * indirectly via the URL-WS passthrough tests since they share the same
 * `openWsUpstream` helper. These tests pin the helper's contract:
 * successful 101 + accept verification, structured error on upstream
 * unreachable, structured error on bad accept.
 */

import { describe, expect, it } from "vitest";
import * as net from "node:net";
import { createHash } from "node:crypto";
import {
  WsUpstreamError,
  openWsUpstream,
} from "../../src/tunnels/client/_ws_url_bridge.js";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptFor(key: string): string {
  return createHash("sha1")
    .update(key + WS_GUID, "ascii")
    .digest("base64");
}

async function spawnGoodUpstream(
  subprotocol?: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((sock) => {
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
      const lines = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptFor(key)}`,
      ];
      if (subprotocol) lines.push(`Sec-WebSocket-Protocol: ${subprotocol}`);
      sock.write(Buffer.from(lines.join("\r\n") + "\r\n\r\n", "ascii"));
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function spawnBadAcceptUpstream(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
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
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function spawnAppHeaderUpstream(
  extraHeaders: Array<[string, string]>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((sock) => {
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
      const lines = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptFor(key)}`,
        ...extraHeaders.map(([k, v]) => `${k}: ${v}`),
      ];
      sock.write(Buffer.from(lines.join("\r\n") + "\r\n\r\n", "ascii"));
    });
    sock.on("error", () => undefined);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

describe("openWsUpstream — edge-mode URL WS hop", () => {
  it("passthrough: UpstreamUrlDispatch.dispatchWebSocket forwards app headers via ws.accept", async () => {
    const upstream = await spawnAppHeaderUpstream([
      ["Sec-WebSocket-Protocol", "chat"],
      ["X-Custom", "value-1"],
      ["X-Use-Inkbox-Text-To-Speech", "false"],
      ["X-Use-Inkbox-Speech-To-Text", "false"],
      ["Set-Cookie", "session=abc; Path=/"],
      // Should be stripped by SDK filter:
      ["Connection", "Upgrade"],
      ["Upgrade", "websocket"],
    ]);
    try {
      const { UpstreamUrlDispatch } = await import(
        "../../src/tunnels/client/_dispatch.js"
      );
      const dispatch = new UpstreamUrlDispatch({
        forwardTo: `http://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxOutboundBodyBytes: 1_000_000,
        maxInboundBodyBytes: 1_000_000,
      });

      let captured: { subprotocol?: string; extraHeaders?: Array<[string, string]>; rejected?: number } = {};
      const fakeSink = {
        async accept(opts?: { subprotocol?: string; extraHeaders?: Array<[string, string]> }) {
          captured.subprotocol = opts?.subprotocol;
          captured.extraHeaders = opts?.extraHeaders ? [...opts.extraHeaders] : undefined;
        },
        async reject(opts?: { status?: number }) {
          captured.rejected = opts?.status ?? 400;
        },
        async sendFrame() { /* no-op */ },
        async recvFrame() { return null; },
        async aclose() { /* no-op */ },
      };

      try {
        await dispatch.dispatchWebSocket(
          {
            method: "GET",
            path: "/ws",
            headers: [["sec-websocket-protocol", "chat"]],
            body: (async function* () { /* empty */ })(),
            forwardedForIp: null,
            sniHost: null,
            isWebSocket: true,
            wsSubprotocol: "chat",
            transport: "h1",
          },
          fakeSink,
        );
      } finally {
        await dispatch.aclose();
      }

      expect(captured.rejected).toBeUndefined();
      expect(captured.subprotocol).toBe("chat");
      const fwd = new Map(captured.extraHeaders ?? []);
      expect(fwd.get("x-custom")).toBe("value-1");
      expect(fwd.get("x-use-inkbox-text-to-speech")).toBe("false");
      expect(fwd.get("x-use-inkbox-speech-to-text")).toBe("false");
      expect(fwd.get("set-cookie")).toBe("session=abc; Path=/");
      // Hop-by-hop / handshake-control / pseudo MUST NOT be forwarded.
      expect(fwd.has("connection")).toBe(false);
      expect(fwd.has("upgrade")).toBe(false);
      expect(fwd.has("sec-websocket-accept")).toBe(false);
      expect(fwd.has("sec-websocket-extensions")).toBe(false);
      expect(fwd.has("sec-websocket-key")).toBe(false);
      expect(fwd.has("sec-websocket-version")).toBe(false);
      // sec-websocket-protocol rides the subprotocol field, not headers.
      expect(fwd.has("sec-websocket-protocol")).toBe(false);
    } finally {
      await upstream.close();
    }
  }, 5000);

  it("captures all 101 response headers (lowercased) for the runtime to forward", async () => {
    const upstream = await spawnAppHeaderUpstream([
      ["X-Custom", "value-1"],
      ["X-Use-Inkbox-Text-To-Speech", "false"],
      ["X-Use-Inkbox-Speech-To-Text", "false"],
      ["Set-Cookie", "session=abc; Path=/"],
    ]);
    try {
      const handle = await openWsUpstream({
        forwardTo: new URL(`http://127.0.0.1:${upstream.port}`),
        publicHost: "agent.test",
        verifyTls: true,
        caBundle: null,
        requestPath: "/ws",
        requestHeaders: [],
        wsSubprotocol: null,
        forwardedForIp: null,
      });
      const map = new Map(handle.headers);
      expect(map.get("x-custom")).toBe("value-1");
      expect(map.get("x-use-inkbox-text-to-speech")).toBe("false");
      expect(map.get("x-use-inkbox-speech-to-text")).toBe("false");
      expect(map.get("set-cookie")).toBe("session=abc; Path=/");
      // Names must be lowercased.
      for (const [k] of handle.headers) {
        expect(k).toBe(k.toLowerCase());
      }
      handle.socket.destroy();
    } finally {
      await upstream.close();
    }
  }, 5000);

  it("succeeds and returns the negotiated subprotocol", async () => {
    const upstream = await spawnGoodUpstream("v2.proto");
    try {
      const handle = await openWsUpstream({
        forwardTo: new URL(`http://127.0.0.1:${upstream.port}`),
        publicHost: "agent.test",
        verifyTls: true,
        caBundle: null,
        requestPath: "/ws",
        requestHeaders: [],
        wsSubprotocol: "v1.proto, v2.proto",
        forwardedForIp: "1.2.3.4",
      });
      expect(handle.subprotocol).toBe("v2.proto");
      handle.socket.destroy();
    } finally {
      await upstream.close();
    }
  }, 5000);

  it("raises WsUpstreamError(502) when upstream is unreachable", async () => {
    // Bind a port then release it.
    const tmp = net.createServer();
    await new Promise<void>((r) => tmp.listen(0, "127.0.0.1", () => r()));
    const port = (tmp.address() as net.AddressInfo).port;
    await new Promise<void>((r) => tmp.close(() => r()));

    let err: unknown = null;
    try {
      await openWsUpstream({
        forwardTo: new URL(`http://127.0.0.1:${port}`),
        publicHost: "agent.test",
        verifyTls: true,
        caBundle: null,
        requestPath: "/ws",
        requestHeaders: [],
        wsSubprotocol: null,
        forwardedForIp: null,
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(WsUpstreamError);
    expect((err as WsUpstreamError).status).toBe(502);
  }, 5000);

  it("raises WsUpstreamError(504) when upstream stalls past the handshake timeout", async () => {
    // Accept the TCP, swallow the upgrade request, never write anything.
    const stallServer = net.createServer((sock) => {
      sock.on("data", () => undefined);
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) =>
      stallServer.listen(0, "127.0.0.1", () => r()),
    );
    const port = (stallServer.address() as net.AddressInfo).port;
    try {
      let err: unknown = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: null,
          forwardedForIp: null,
          handshakeTimeoutMs: 200,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
      expect((err as WsUpstreamError).status).toBe(504);
      expect((err as WsUpstreamError).reason).toMatch(/timeout/i);
    } finally {
      await new Promise<void>((r) => stallServer.close(() => r()));
    }
  }, 5000);

  it("raises WsUpstreamError(502) when upstream confirms an extension we didn't offer", async () => {
    const server = net.createServer((sock) => {
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
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${acceptFor(key)}\r\n` +
              "Sec-WebSocket-Extensions: permessage-deflate\r\n\r\n",
            "ascii",
          ),
        );
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      let err: unknown = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: null,
          forwardedForIp: null,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
      expect((err as WsUpstreamError).status).toBe(502);
      expect((err as WsUpstreamError).reason).toMatch(/extension/i);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 5000);

  it("raises WsUpstreamError(502) when upstream picks a subprotocol the client never offered", async () => {
    // Build a server that always returns Sec-WebSocket-Protocol: admin
    // regardless of what the client offered.
    const server = net.createServer((sock) => {
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
        sock.write(
          Buffer.from(
            "HTTP/1.1 101 Switching Protocols\r\n" +
              "Upgrade: websocket\r\n" +
              "Connection: Upgrade\r\n" +
              `Sec-WebSocket-Accept: ${acceptFor(key)}\r\n` +
              "Sec-WebSocket-Protocol: admin\r\n\r\n",
            "ascii",
          ),
        );
      });
      sock.on("error", () => undefined);
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
    const port = (server.address() as net.AddressInfo).port;
    try {
      // Client offered nothing.
      let err: unknown = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: null,
          forwardedForIp: null,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
      expect((err as WsUpstreamError).status).toBe(502);
      expect((err as WsUpstreamError).reason).toMatch(/subprotocol/i);

      // Client offered "chat" but upstream still picked "admin".
      err = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: "chat",
          forwardedForIp: null,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
      expect((err as WsUpstreamError).status).toBe(502);
      expect((err as WsUpstreamError).reason).toMatch(/subprotocol/i);

      // Client offered both — upstream picks "admin" which is not in
      // the offer; still rejected.
      err = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: "chat, v1",
          forwardedForIp: null,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }
  }, 5000);

  it("raises WsUpstreamError(502) when Sec-WebSocket-Accept mismatches", async () => {
    const upstream = await spawnBadAcceptUpstream();
    try {
      let err: unknown = null;
      try {
        await openWsUpstream({
          forwardTo: new URL(`http://127.0.0.1:${upstream.port}`),
          publicHost: "agent.test",
          verifyTls: true,
          caBundle: null,
          requestPath: "/ws",
          requestHeaders: [],
          wsSubprotocol: null,
          forwardedForIp: null,
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(WsUpstreamError);
      expect((err as WsUpstreamError).status).toBe(502);
      expect((err as WsUpstreamError).reason).toMatch(/accept/i);
    } finally {
      await upstream.close();
    }
  }, 5000);
});

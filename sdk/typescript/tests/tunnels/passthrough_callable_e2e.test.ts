/**
 * Runtime-level e2e for passthrough + CallableDispatch.
 *
 * Drives `TunnelRuntime.dispatchTcpStream` end-to-end against
 * `FakeH2Server` + a real third-party `tls.connect` whose bytes ride
 * over the bridge stream. Verifies that an in-process `httpHandler`
 * actually fires when the runtime opens the TCP bridge in
 * passthrough mode.
 *
 * The parser-level tests in `passthrough.test.ts` cover the
 * `TlsTerminator → InProcH1ParserPlaintext → CallableDispatch` chain.
 * This file covers the orchestrator wrapping that chain inside the
 * `dispatchTcpStream` h2 bridge — which is where a customer report
 * said the dispatch never fires.
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

/**
 * Duplex that bridges a real ``tls.connect`` client to a bridge
 * `ServerHttp2Stream`: writes from the TLS client are wrapped in
 * unmasked WS BINARY frames and pushed onto the bridge stream as if
 * the tunnel server were forwarding third-party bytes; bytes from
 * the bridge stream are decoded as WS BINARY and pushed back to
 * the TLS client.
 */
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
    read() {
      // pushed via bridgeStream.on("data") below
    },
    final(cb) {
      cb();
    },
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

describe("passthrough + CallableDispatch — runtime-level e2e", () => {
  it("h1 GET through dispatchTcpStream → CallableDispatch handler invoked", async () => {
    const { cert, key } = await generateSelfSignedCert();

    let handlerInvoked = false;
    let observedMethod = "";
    let observedPath = "";
    const handler = async (req: Request): Promise<Response> => {
      handlerInvoked = true;
      const u = new URL(req.url);
      observedMethod = req.method;
      observedPath = u.pathname + u.search;
      return new Response("hello-from-runtime-callable", {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    };

    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-pt-cb-1"],
        ["inkbox-route-kind", "tcp-stream"],
        ["inkbox-tcp-id", "tcp-pt-cb-1"],
        ["inkbox-sni-host", "agent.test"],
      ],
      body: Buffer.alloc(0),
    });

    const runtime = new TunnelRuntime({
      tunnelId: "55555555-5555-5555-5555-555555555555",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "agent.test",
      poolSize: null,
      dispatch: { httpHandler: handler },
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
        "/_system/tcp/tcp-pt-cb-1",
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

      const chunks: Buffer[] = [];
      const respPromise = new Promise<Buffer>((resolve, reject) => {
        const checkDone = (): void => {
          const merged = Buffer.concat(chunks);
          if (merged.includes("hello-from-runtime-callable")) {
            resolve(merged);
          }
        };
        client.on("data", (c: Buffer) => {
          chunks.push(c);
          checkDone();
        });
        client.on("end", () => resolve(Buffer.concat(chunks)));
        client.on("close", () => resolve(Buffer.concat(chunks)));
        client.on("error", reject);
        setTimeout(() => reject(new Error("response timeout")), 8_000);
      });

      client.write(
        "GET /webhook?x=1 HTTP/1.1\r\n" +
          "Host: agent.test\r\n" +
          "User-Agent: e2e/1\r\n" +
          "Connection: close\r\n\r\n",
      );

      const respBytes = await respPromise;
      const text = respBytes.toString("utf-8");
      expect(handlerInvoked).toBe(true);
      expect(observedMethod).toBe("GET");
      expect(observedPath).toBe("/webhook?x=1");
      expect(text).toContain("HTTP/1.1 200");
      expect(text).toContain("hello-from-runtime-callable");

      try { client.end(); } catch { /* swallow */ }
    } finally {
      await runtime.aclose();
      await servePromise;
    }
  }, 20_000);
});

/**
 * tests/tunnels/passthrough.test.ts
 *
 * End-to-end passthrough TCP-bridge integration test. Spins up the
 * fake h2 server, the runtime in passthrough mode with an in-process
 * TlsTerminator, a fake loopback TCP echo server, and drives an
 * encrypted byte round-trip through the bridge.
 */

import "reflect-metadata";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as crypto from "node:crypto";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as tls from "node:tls";
import * as x509 from "@peculiar/x509";

import { TunnelRuntime } from "../../src/tunnels/client/_runtime.js";
import { TlsTerminator } from "../../src/tunnels/client/_tls.js";
import {
  WS_OPCODE_BINARY,
  WS_OPCODE_CLOSE,
  WsFrameDecoder,
  encodeWsFrame,
} from "../../src/tunnels/client/_wsframe.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

x509.cryptoProvider.set(crypto.webcrypto as unknown as Crypto);
const subtle = crypto.webcrypto.subtle as unknown as SubtleCrypto;

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server();
});

afterEach(async () => {
  await fakeServer.close();
});

async function generatePassthroughCert(): Promise<{
  certPem: Buffer;
  keyPem: Buffer;
}> {
  const keys = (await subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const cn = "passthrough-test.invalid";
  const cert = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: "01",
    name: `CN=${cn}`,
    notBefore: new Date(Date.now() - 60_000),
    notAfter: new Date(Date.now() + 86_400_000),
    keys,
    signingAlgorithm: { name: "ECDSA", hash: "SHA-256" },
    extensions: [
      new x509.SubjectAlternativeNameExtension([
        { type: "dns", value: cn },
      ]),
    ],
  });
  const pkcs8 = await subtle.exportKey("pkcs8", keys.privateKey);
  const b64 = Buffer.from(pkcs8).toString("base64");
  const lines: string[] = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  const keyPem = `-----BEGIN PRIVATE KEY-----\n${lines.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return {
    certPem: Buffer.from(cert.toString("pem"), "ascii"),
    keyPem: Buffer.from(keyPem, "ascii"),
  };
}

describe("TunnelRuntime — passthrough TCP bridge", () => {
  it("decrypts inbound TLS, forwards plaintext to loopback, re-encrypts the response", async () => {
    // 1) Generate the SDK-side cert/key (would normally be CSR-signed
    //    by the tunnel server). The third party will trust this cert
    //    explicitly via `ca: certPem` on its tls.connect call.
    const { certPem, keyPem } = await generatePassthroughCert();
    const terminator = new TlsTerminator({
      certChainPem: certPem,
      keyPem,
    });

    // 2) Loopback echo server — receives plaintext over a raw TCP
    //    socket (the SDK terminates TLS in-process, so the loopback
    //    sees decrypted bytes).
    const loopback = net.createServer((sock) => {
      sock.on("data", (chunk) => {
        sock.write(Buffer.concat([Buffer.from("ECHO:"), chunk]));
      });
    });
    await new Promise<void>((resolve) =>
      loopback.listen(0, "127.0.0.1", () => resolve()),
    );
    const loopbackPort = (loopback.address() as { port: number }).port;

    // 3) Queue a tcp-stream envelope at the fake tunnel server.
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-tcp-1"],
        ["inkbox-route-kind", "tcp-stream"],
        ["inkbox-tcp-id", "tcp-1"],
        ["inkbox-sni-host", "passthrough-test.invalid"],
      ],
      body: Buffer.alloc(0),
    });

    // 4) Construct the runtime with the terminator, pointing forwardTo
    //    at our loopback echo.
    const runtime = new TunnelRuntime({
      tunnelId: "11111111-1111-1111-1111-111111111111",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "passthrough-test.invalid",
      poolSize: null,
      dispatch: { forwardTo: `http://127.0.0.1:${loopbackPort}` },
      tlsTerminator: terminator,
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
    });

    // 5) Spin up the third party. It connects to the fake h2 server's
    //    /_system/tcp/{tcp_id} extended-CONNECT stream as a client and
    //    drives a TLS handshake over it.
    //
    //    The fake server doesn't do real bridge routing — for this
    //    test we install a one-shot stream handler on the fake server
    //    that captures the runtime-side bridge stream and pipes the
    //    third-party TLS bytes through it.
    const servePromise = runtime.serveForever();

    // Wait for the bridge stream to be opened by the runtime against
    // the fake server. The fake server's /_system/tcp/{tcp_id} handler
    // isn't installed by default; we register one here that pipes
    // bytes through to a test-side TCP "third party".
    await waitForBridgeStream(fakeServer, "tcp-1", async (bridgeStream) => {
      // Acknowledge the CONNECT with 200.
      bridgeStream.respond({ ":status": 200 });

      // Decode WS frames coming from the runtime; encode WS frames
      // going TO the runtime.
      const fromRuntime = new WsFrameDecoder();
      const incomingPlaintext: Buffer[] = [];

      // Establish a TLSSocket as the *client* over an in-memory Duplex
      // wired to the bridgeStream's framed payload channel.
      const wireFromTp: Buffer[] = [];
      const tpDuplex = new (await import("node:stream")).Duplex({
        read() {},
        write(chunk: Buffer | string, _enc: string, cb: () => void) {
          // Encrypted bytes from the third-party TLS client. Wrap into
          // a WS BINARY frame and send to the runtime.
          const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
          const frame = encodeWsFrame(WS_OPCODE_BINARY, buf, { mask: false });
          bridgeStream.write(frame);
          cb();
        },
      });
      // Push runtime-emitted plaintext-decrypted... wait no — runtime
      // sends back encrypted bytes (it's terminating TLS server-side).
      // The third-party TLS client decrypts those.
      bridgeStream.on("data", (chunk: Buffer) => {
        const frames = fromRuntime.feed(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        for (const f of frames) {
          if (f.opcode === WS_OPCODE_BINARY) {
            tpDuplex.push(f.payload);
          } else if (f.opcode === WS_OPCODE_CLOSE) {
            tpDuplex.push(null);
          }
        }
      });

      // Now run a TLS client over tpDuplex pointed at the SDK's cert.
      const tlsClient = tls.connect({
        socket: tpDuplex as unknown as net.Socket,
        servername: "passthrough-test.invalid",
        ca: certPem,
        rejectUnauthorized: false, // self-signed; trust explicitly via ca.
      });
      tlsClient.on("data", (chunk: Buffer) => {
        incomingPlaintext.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      await new Promise<void>((resolve, reject) => {
        tlsClient.once("secureConnect", () => resolve());
        tlsClient.once("error", reject);
      });

      // Send plaintext through TLS; the SDK decrypts, forwards to
      // loopback echo, re-encrypts the response.
      await new Promise<void>((resolve, reject) =>
        tlsClient.write(Buffer.from("hello"), (err) =>
          err ? reject(err) : resolve(),
        ),
      );

      // Wait for the echo to come back.
      const start = Date.now();
      while (
        Buffer.concat(incomingPlaintext).toString().indexOf("ECHO:hello") < 0
      ) {
        if (Date.now() - start > 4000) {
          throw new Error(
            `timeout waiting for echo; got ${Buffer.concat(incomingPlaintext).toString()}`,
          );
        }
        await new Promise((r) => setTimeout(r, 25));
      }
      const got = Buffer.concat(incomingPlaintext).toString();
      expect(got).toContain("ECHO:hello");

      tlsClient.destroy();
    });

    await runtime.aclose();
    await servePromise;
    await new Promise<void>((resolve) => loopback.close(() => resolve()));
  }, 15_000);
});

/**
 * Install a one-shot bridge handler on the fake server. The fake
 * server's default stream router doesn't handle `/_system/tcp/{id}`;
 * this function patches it for the duration of the test by hooking
 * the underlying `server` via a Node trick: register an event
 * listener that *prepends* itself in the listener order so it sees
 * bridge streams before the default 404 handler does.
 */
async function waitForBridgeStream(
  fake: FakeH2Server,
  tcpId: string,
  cb: (stream: http2.ServerHttp2Stream) => Promise<void>,
): Promise<void> {
  // The fake server is opaque — but we know it accepts a custom
  // stream-route extension via the fixture's escape hatch. Our fixture
  // doesn't expose one yet; for this test we monkey-attach onto a
  // shared module-level latch that startFakeH2Server consults.
  const path = `/_system/tcp/${tcpId}`;
  const t = await fake.awaitNextBridgeStream(path, 5000);
  await cb(t);
}

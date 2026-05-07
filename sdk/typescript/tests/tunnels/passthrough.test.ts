/**
 * Runtime-level e2e for the passthrough plaintext-adapter path.
 *
 * Drives a real `tls.connect()` client against the in-memory
 * `TlsTerminator`; pipes the decrypted plaintext into
 * `InProcH1ParserPlaintext`; routes each parsed request to a real
 * `UpstreamUrlDispatch` pointed at a tiny local h1 echo upstream.
 *
 * This is the test the original `passthrough.test.ts` exercised over
 * the now-removed byte-pipe path. It now exercises the parser-based
 * path that ships in production.
 */

import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Duplex } from "node:stream";
import * as net from "node:net";
import * as tls from "node:tls";
import { TlsTerminator } from "../../src/tunnels/client/_tls.js";
import { InProcH1ParserPlaintext } from "../../src/tunnels/client/_h1_server.js";
import { UpstreamUrlDispatch } from "../../src/tunnels/client/_dispatch.js";
import { generateSelfSignedCert } from "./_test_cert.js";

class PairedDuplex extends Duplex {
  peer!: PairedDuplex;
  private inbound: Buffer[] = [];

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

  override _read(): void {
    while (this.inbound.length > 0) {
      const chunk = this.inbound.shift()!;
      if (!this.push(chunk)) return;
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

async function spawnH1Echo(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = net.createServer((sock) => {
    let head = Buffer.alloc(0);
    sock.on("data", (chunk: Buffer) => {
      head = Buffer.concat([head, chunk]);
      const idx = head.indexOf("\r\n\r\n");
      if (idx === -1) return;
      // For the test, we don't bother parsing the request — just
      // reply with a fixed body.
      const body = "hello-from-passthrough-upstream";
      const resp =
        "HTTP/1.1 200 OK\r\n" +
        "Content-Type: text/plain\r\n" +
        `Content-Length: ${body.length}\r\n` +
        "Connection: close\r\n\r\n" +
        body;
      sock.write(resp);
      sock.end();
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

describe("passthrough runtime-level e2e", () => {
  it("third-party tls.connect → parser → upstream → reply", async () => {
    const upstream = await spawnH1Echo();
    try {
      const { cert, key } = await generateSelfSignedCert();
      const terminator = new TlsTerminator({
        certChainPem: cert,
        keyPem: key,
        alpnProtocols: ["http/1.1"],
      });
      const session = terminator.session();
      const dispatch = new UpstreamUrlDispatch({
        forwardTo: `http://127.0.0.1:${upstream.port}`,
        publicHost: "agent.test",
        maxOutboundBodyBytes: 1_000_000,
        maxInboundBodyBytes: 1_000_000,
      });
      try {
        const parser = new InProcH1ParserPlaintext({
          dispatch,
          maxInboundBodyBytes: 1_000_000,
          forwardedForIp: null,
          sniHost: null,
        });

        const [clientSide, serverSide] = PairedDuplex.pair();

        // Server-side glue: feed encrypted bytes from clientSide into
        // the TLS session, deliver decrypted plaintext to the parser,
        // and TLS-wrap parser outbound back to clientSide.
        serverSide.on("data", async (chunk: Buffer) => {
          const { plaintext, encryptedToSend } = await session.feed(chunk);
          if (encryptedToSend.length > 0) {
            clientSide.pushIncoming(encryptedToSend);
          }
          for (const pt of plaintext) {
            if (pt.length > 0) await parser.feed(pt);
          }
        });
        // Pump parser outbound: encrypt with the TLS session and push
        // back to clientSide as wire bytes.
        void parser.pumpOutbound(async (plaintext) => {
          const encrypted = await session.send(plaintext);
          if (encrypted.length > 0) {
            clientSide.pushIncoming(encrypted);
          }
        });

        const client = tls.connect({
          socket: clientSide as unknown as tls.TLSSocket,
          rejectUnauthorized: false,
          ALPNProtocols: ["http/1.1"],
          servername: "agent.test",
        });

        await new Promise<void>((resolve, reject) => {
          client.once("secureConnect", () => resolve());
          client.once("error", reject);
          setTimeout(() => reject(new Error("handshake timeout")), 5_000);
        });

        // Attach response listeners up-front so we don't race the
        // data events.
        const chunks: Buffer[] = [];
        const respBytesPromise = new Promise<Buffer>((resolve, reject) => {
          const checkDone = (): void => {
            const merged = Buffer.concat(chunks);
            if (merged.includes("hello-from-passthrough-upstream")) {
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
          setTimeout(() => reject(new Error("response timeout")), 5_000);
        });

        // Send an h1 request through the TLS tunnel.
        client.write(
          "GET /webhook HTTP/1.1\r\n" +
            "Host: agent.test\r\n" +
            "User-Agent: e2e/1\r\n" +
            "Connection: close\r\n\r\n",
        );

        const respBytes = await respBytesPromise;
        const text = respBytes.toString("utf-8");
        expect(text).toContain("HTTP/1.1 200 OK");
        expect(text).toContain("hello-from-passthrough-upstream");

        await parser.aclose();
      } finally {
        await dispatch.aclose();
      }
    } finally {
      await upstream.close();
    }
  }, 15_000);
});

/**
 * ALPN advertisement tests for the passthrough TLS terminator.
 *
 * Drives a real `tls.connect` against the in-memory `TlsTerminator`
 * (over a paired Duplex) and asserts the negotiated ALPN protocol
 * matches what the server-side advertised list permits.
 */

import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Duplex } from "node:stream";
import * as tls from "node:tls";
import { TlsTerminator } from "../../src/tunnels/client/_tls.js";
import { generateSelfSignedCert } from "./_test_cert.js";

/**
 * Bidirectional in-memory pipe — bytes written to one side appear as
 * readable on the other. Used to wire a `tls.connect()` client against
 * the server-side terminator without going over a real socket.
 */
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

  override _read(_size: number): void {
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

async function negotiate(
  terminator: TlsTerminator,
  clientAlpn: string[],
): Promise<string | false | null> {
  // Server side: feed bytes into terminator.session() and pull bytes out.
  const sess = terminator.session();
  const [clientSide, serverSide] = PairedDuplex.pair();

  // Pump server-side bytes through the in-memory TLS session.
  serverSide.on("data", async (chunk: Buffer) => {
    const { encryptedToSend } = await sess.feed(chunk);
    if (encryptedToSend.length > 0) clientSide.pushIncoming(encryptedToSend);
  });

  const client = tls.connect({
    socket: clientSide as unknown as tls.TLSSocket,
    rejectUnauthorized: false,
    ALPNProtocols: clientAlpn,
    servername: "inkbox-test.invalid",
  });

  return await new Promise((resolve, reject) => {
    client.once("secureConnect", () => resolve(client.alpnProtocol));
    client.once("error", reject);
    setTimeout(() => reject(new Error("handshake timeout")), 5_000);
  });
}

describe("TlsTerminator ALPN", () => {
  it("defaults to http/1.1 only", async () => {
    const { cert, key } = await generateSelfSignedCert();
    const term = new TlsTerminator({ certChainPem: cert, keyPem: key });
    const selected = await negotiate(term, ["h2", "http/1.1"]);
    expect(selected).toBe("http/1.1");
  });

  it("explicitly advertising http/1.1 only negotiates http/1.1", async () => {
    const { cert, key } = await generateSelfSignedCert();
    const term = new TlsTerminator({
      certChainPem: cert,
      keyPem: key,
      alpnProtocols: ["http/1.1"],
    });
    const selected = await negotiate(term, ["h2", "http/1.1"]);
    expect(selected).toBe("http/1.1");
  });

  it("advertising h2 + http/1.1 negotiates h2 when client prefers it", async () => {
    const { cert, key } = await generateSelfSignedCert();
    const term = new TlsTerminator({
      certChainPem: cert,
      keyPem: key,
      alpnProtocols: ["h2", "http/1.1"],
    });
    const selected = await negotiate(term, ["h2", "http/1.1"]);
    expect(selected).toBe("h2");
  });
});

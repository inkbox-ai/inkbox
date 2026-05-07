/**
 * inkbox-tunnels/client/_tls.ts
 *
 * Server-side TLS terminator over an in-memory Duplex. Used by the
 * passthrough TCP bridge: third parties open TLS to the public host,
 * encrypted bytes ride inside h2 DATA frames, and we decrypt them
 * in-process with the customer's LE-issued cert + private key.
 *
 * Node 22's `new tls.TLSSocket(duplex, { isServer: true, secureContext
 * })` works over an arbitrary Duplex; we use the high-level API.
 */

import { Duplex } from "node:stream";
import * as tls from "node:tls";

export interface TlsTerminatorOpts {
  certChainPem: Buffer;
  keyPem: Buffer;
  /**
   * ALPN protocols advertised to the third party during the handshake.
   * Default is `["http/1.1"]` — we only commit to a protocol the rest
   * of the data plane can actually deliver.
   */
  alpnProtocols?: readonly string[];
}

export interface TlsSession {
  /**
   * Feed encrypted bytes received on the bridge stream into the TLS
   * state machine. Returns the decrypted plaintext (one or more
   * chunks) and any encrypted handshake/control bytes that need to be
   * sent back to the third party.
   */
  feed(encrypted: Buffer): Promise<{
    plaintext: Buffer[];
    encryptedToSend: Buffer;
  }>;
  /** Encrypt plaintext from the loopback socket for transmission back. */
  send(plaintext: Buffer): Promise<Buffer>;
  /** Close the TLS session and flush any pending close-notify. */
  close(): Promise<Buffer>;
  readonly handshakeDone: boolean;
}

/**
 * Pre-validated terminator factory. Constructing this is cheap and
 * reusable — each bridge flow calls `session()` to get a fresh state
 * machine.
 */
export class TlsTerminator {
  private readonly secureContext: tls.SecureContext;
  private readonly alpnProtocols: readonly string[];

  constructor(opts: TlsTerminatorOpts) {
    this.secureContext = tls.createSecureContext({
      cert: opts.certChainPem,
      key: opts.keyPem,
    });
    this.alpnProtocols = opts.alpnProtocols ?? ["http/1.1"];
  }

  session(): TlsSession {
    return new InMemoryTlsSession(this.secureContext, this.alpnProtocols);
  }
}

/**
 * Internal Duplex subclass that the `TLSSocket` wraps as its
 * underlying socket. Reads pull from a queue of incoming encrypted
 * bytes; writes capture outgoing encrypted bytes to a queue.
 */
class WireDuplex extends Duplex {
  private readBacklog: Buffer[] = [];
  private outboundQueue: Buffer[] = [];

  constructor() {
    super({ allowHalfOpen: true });
  }

  /** Push encrypted bytes to be delivered as `_read` output. */
  pushIncoming(buf: Buffer): void {
    this.readBacklog.push(buf);
    this._read(0);
  }

  /** Drain captured outbound encrypted bytes. */
  drainOutbound(): Buffer[] {
    const out = this.outboundQueue;
    this.outboundQueue = [];
    return out;
  }

  override _read(_size: number): void {
    while (this.readBacklog.length > 0) {
      const chunk = this.readBacklog.shift()!;
      if (!this.push(chunk)) return; // back-pressure
    }
  }

  override _write(
    chunk: Buffer | string,
    _encoding: string,
    cb: (err?: Error | null) => void,
  ): void {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    this.outboundQueue.push(buf);
    cb();
  }

  override _final(cb: (err?: Error | null) => void): void {
    cb();
  }
}

class InMemoryTlsSession implements TlsSession {
  private readonly wire: WireDuplex;
  private readonly tlsSocket: tls.TLSSocket;
  private plaintextBuffer: Buffer[] = [];
  private _handshakeDone = false;
  private closed = false;

  constructor(
    secureContext: tls.SecureContext,
    alpnProtocols: readonly string[],
  ) {
    this.wire = new WireDuplex();
    this.tlsSocket = new tls.TLSSocket(this.wire as unknown as tls.TLSSocket, {
      isServer: true,
      secureContext,
      // ALPN must be set on the socket options bag, not on the secure
      // context — Node only honors it from here.
      ALPNProtocols: [...alpnProtocols],
    });
    this.tlsSocket.on("data", (chunk: Buffer | string) => {
      this.plaintextBuffer.push(
        Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk),
      );
    });
    this.tlsSocket.on("secureConnect", () => {
      this._handshakeDone = true;
    });
    this.tlsSocket.on("error", () => {
      // Surface as eof on the next feed/send.
    });
  }

  get handshakeDone(): boolean {
    return this._handshakeDone;
  }

  async feed(encrypted: Buffer): Promise<{
    plaintext: Buffer[];
    encryptedToSend: Buffer;
  }> {
    if (encrypted.length > 0) this.wire.pushIncoming(encrypted);
    // Yield to allow the TLSSocket to process.
    await new Promise<void>((resolve) => setImmediate(resolve));
    const plaintext = this.plaintextBuffer;
    this.plaintextBuffer = [];
    const enc = this.wire.drainOutbound();
    return {
      plaintext,
      encryptedToSend: enc.length === 0 ? Buffer.alloc(0) : Buffer.concat(enc),
    };
  }

  async send(plaintext: Buffer): Promise<Buffer> {
    if (this.closed) return Buffer.alloc(0);
    if (plaintext.length > 0) {
      await new Promise<void>((resolve, reject) => {
        this.tlsSocket.write(plaintext, (err) =>
          err ? reject(err) : resolve(),
        );
      });
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const enc = this.wire.drainOutbound();
    return enc.length === 0 ? Buffer.alloc(0) : Buffer.concat(enc);
  }

  async close(): Promise<Buffer> {
    if (this.closed) return Buffer.alloc(0);
    this.closed = true;
    try {
      this.tlsSocket.end();
    } catch {
      /* swallow */
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    const enc = this.wire.drainOutbound();
    return enc.length === 0 ? Buffer.alloc(0) : Buffer.concat(enc);
  }
}

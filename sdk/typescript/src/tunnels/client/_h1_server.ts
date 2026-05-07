/**
 * inkbox-tunnels/client/_h1_server.ts
 *
 * In-process HTTP/1.1 server-side parser. Drives `node:http`'s server
 * over an in-memory Duplex (the "WireDuplex" pattern — the underlying
 * Socket surface is mocked just enough that node:http accepts it) to
 * turn plaintext bytes from the third party into `DispatchRequest`
 * objects, hands them to a `Dispatch` impl, and serializes responses
 * back to plaintext bytes.
 *
 * Implements the Plaintext adapter contract used by the runtime in
 * passthrough mode after the TLS terminator.
 */

import * as http from "node:http";
import { Duplex } from "node:stream";
import type {
  Dispatch,
  DispatchRequest,
  DispatchResponseHead,
  DispatchResponseSink,
} from "./_dispatch.js";
import { HOP_BY_HOP_RESPONSE } from "./_protocol.js";
import {
  ByteChannelWebSocketSink,
  computeWsAccept,
} from "./_ws_passthrough.js";

/** Sentinel pushed onto the outbound queue to signal "no more bytes". */
const OUTBOUND_END = Symbol("outbound-end");

/**
 * Bidirectional in-memory pipe that we feed wire bytes into and read
 * wire bytes out of. `node:http`'s server treats this as a connection
 * via `server.emit("connection", duplex)`.
 */
class H1WireDuplex extends Duplex {
  private inbound: Buffer[] = [];
  private outboundQueue: Array<Buffer | typeof OUTBOUND_END> = [];
  private outboundResolvers: Array<
    (value: Buffer | typeof OUTBOUND_END) => void
  > = [];

  constructor() {
    super({ allowHalfOpen: true });
  }

  pushIncoming(buf: Buffer): void {
    this.inbound.push(buf);
    this._read(0);
  }

  /** Wait for one outbound chunk; returns `OUTBOUND_END` on close. */
  takeOutbound(): Promise<Buffer | typeof OUTBOUND_END> {
    if (this.outboundQueue.length > 0) {
      return Promise.resolve(this.outboundQueue.shift()!);
    }
    return new Promise((resolve) => this.outboundResolvers.push(resolve));
  }

  endOutbound(): void {
    this._enqueueOutbound(OUTBOUND_END);
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
    this._enqueueOutbound(buf);
    cb();
  }

  override _final(cb: (err?: Error | null) => void): void {
    cb();
  }

  // Socket-like methods node:http's server probes for. These cover the
  // surface it touches when the underlying transport isn't a real net
  // socket (return self / no-ops are fine — there's no kernel socket
  // to configure).
  setTimeout(_ms: number, _cb?: () => void): this { return this; }
  setNoDelay(_b?: boolean): this { return this; }
  setKeepAlive(_b?: boolean, _ms?: number): this { return this; }
  unref(): this { return this; }
  ref(): this { return this; }
  address(): { port: number; family: string; address: string } {
    return { port: 0, family: "IPv4", address: "127.0.0.1" };
  }
  get remoteAddress(): string { return "127.0.0.1"; }
  get remoteFamily(): string { return "IPv4"; }
  get remotePort(): number { return 0; }
  get localAddress(): string { return "127.0.0.1"; }
  get localPort(): number { return 0; }

  private _enqueueOutbound(item: Buffer | typeof OUTBOUND_END): void {
    if (this.outboundResolvers.length > 0) {
      const resolve = this.outboundResolvers.shift()!;
      resolve(item);
      return;
    }
    this.outboundQueue.push(item);
  }
}

export interface InProcH1ParserPlaintextOpts {
  dispatch: Dispatch;
  maxInboundBodyBytes: number;
  forwardedForIp: string | null;
  sniHost: string | null;
}

/**
 * h1 parser exposed as a Plaintext adapter. One instance per third-
 * party TLS session.
 */
export class InProcH1ParserPlaintext {
  private readonly wire: H1WireDuplex;
  private readonly server: http.Server;
  private readonly maxInboundBodyBytes: number;
  private closed = false;

  constructor(opts: InProcH1ParserPlaintextOpts) {
    this.wire = new H1WireDuplex();
    this.maxInboundBodyBytes = opts.maxInboundBodyBytes;
    this.server = http.createServer();

    this.server.on("request", (req, res) => {
      void this.handleRequest(opts.dispatch, opts.forwardedForIp, opts.sniHost, req, res);
    });
    this.server.on("upgrade", (req, socket, head) => {
      void this.handleUpgrade(
        opts.dispatch, opts.forwardedForIp, opts.sniHost, req, socket, head,
      );
    });

    this.server.emit("connection", this.wire);
  }

  async feed(plaintext: Buffer): Promise<void> {
    if (this.closed) return;
    this.wire.pushIncoming(plaintext);
  }

  async pumpOutbound(send: (chunk: Buffer) => Promise<void>): Promise<void> {
    while (true) {
      const item = await this.wire.takeOutbound();
      if (item === OUTBOUND_END) return;
      try {
        await send(item);
      } catch {
        return;
      }
    }
  }

  async aclose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      this.server.close();
    } catch {
      /* swallow */
    }
    this.wire.endOutbound();
  }

  private async handleUpgrade(
    dispatch: Dispatch,
    forwardedForIp: string | null,
    sniHost: string | null,
    req: http.IncomingMessage,
    socket: import("node:stream").Duplex,
    head: Buffer,
  ): Promise<void> {
    const headers: Array<[string, string]> = [];
    let isWebSocket = false;
    let wsSubprotocol: string | null = null;
    let wsKey: string | null = null;
    const rawHeaders = req.rawHeaders;
    for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
      const name = rawHeaders[i].toLowerCase();
      const value = rawHeaders[i + 1];
      headers.push([name, value]);
      if (name === "upgrade" && value.toLowerCase() === "websocket") {
        isWebSocket = true;
      } else if (name === "sec-websocket-protocol") {
        wsSubprotocol = value;
      } else if (name === "sec-websocket-key") {
        wsKey = value;
      }
    }

    if (
      !isWebSocket ||
      wsKey === null ||
      typeof dispatch.dispatchWebSocket !== "function"
    ) {
      try {
        socket.write(
          "HTTP/1.1 501 Not Implemented\r\n" +
            "Connection: close\r\n" +
            "Content-Length: 0\r\n" +
            "\r\n",
        );
        socket.end();
      } catch {
        /* swallow */
      }
      return;
    }

    const acceptValue = computeWsAccept(wsKey);
    const buildAccept = (
      subprotocol: string | null,
      extraHeaders: Array<[string, string]> | null,
    ): Buffer => {
      const lines = [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${acceptValue}`,
      ];
      if (subprotocol !== null) {
        lines.push(`Sec-WebSocket-Protocol: ${subprotocol}`);
      }
      if (extraHeaders !== null) {
        for (const [hk, hv] of extraHeaders) {
          lines.push(`${hk}: ${hv}`);
        }
      }
      return Buffer.from(lines.join("\r\n") + "\r\n\r\n", "ascii");
    };
    const buildReject = (status: number): Buffer => {
      const phrase =
        status === 400
          ? "Bad Request"
          : status === 403
            ? "Forbidden"
            : status === 500
              ? "Internal Server Error"
              : "Error";
      const body = "upgrade refused";
      return Buffer.from(
        `HTTP/1.1 ${status} ${phrase}\r\n` +
          `Content-Type: text/plain\r\n` +
          `Content-Length: ${body.length}\r\n` +
          `Connection: close\r\n\r\n${body}`,
        "ascii",
      );
    };

    const sendPlaintext = async (data: Buffer): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        socket.write(data, (err) => (err ? reject(err) : resolve()));
      });
    };

    const sink = new ByteChannelWebSocketSink({
      sendPlaintext,
      buildAcceptResponse: buildAccept,
      buildRejectResponse: buildReject,
      onClose: async () => {
        try {
          socket.end();
        } catch {
          /* swallow */
        }
      },
    });

    socket.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      sink.feedInbound(buf);
    });
    socket.on("end", () => sink.signalInboundEof());
    socket.on("close", () => sink.signalInboundEof());
    socket.on("error", () => sink.signalInboundEof());

    if (head !== undefined && head.length > 0) {
      sink.feedInbound(head);
    }

    const dispatchRequest: DispatchRequest = {
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers,
      body: emptyAsyncIter(),
      forwardedForIp,
      sniHost,
      isWebSocket: true,
      wsSubprotocol,
      transport: "h1",
    };

    try {
      await dispatch.dispatchWebSocket(dispatchRequest, sink);
    } catch {
      try {
        await sink.aclose();
      } catch {
        /* swallow */
      }
    }
  }

  private async handleRequest(
    dispatch: Dispatch,
    forwardedForIp: string | null,
    sniHost: string | null,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    const headers: Array<[string, string]> = [];
    let isWebSocket = false;
    let wsSubprotocol: string | null = null;
    const rawHeaders = req.rawHeaders;
    for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
      const name = rawHeaders[i].toLowerCase();
      const value = rawHeaders[i + 1];
      headers.push([name, value]);
      if (name === "upgrade" && value.toLowerCase() === "websocket") {
        isWebSocket = true;
      } else if (name === "sec-websocket-protocol") {
        wsSubprotocol = value;
      }
    }

    let inboundCount = 0;
    let oversize = false;
    const bodyChunks: Buffer[] = [];
    const bodyResolvers: Array<(value: Buffer | null) => void> = [];

    const enqueue = (item: Buffer | null): void => {
      if (bodyResolvers.length > 0) {
        bodyResolvers.shift()!(item);
        return;
      }
      bodyChunks.push(item ?? Buffer.alloc(0));
      if (item === null) bodyChunks.push(Buffer.alloc(0)); // sentinel marker
    };

    req.on("data", (chunk: Buffer | string) => {
      if (oversize) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      inboundCount += buf.length;
      if (inboundCount > this.maxInboundBodyBytes) {
        oversize = true;
        // Best-effort 413, then destroy.
        if (!res.headersSent) {
          res.statusCode = 413;
          res.setHeader("content-type", "text/plain");
          res.setHeader("content-length", String("payload too large".length));
          res.setHeader("connection", "close");
          res.end("payload too large");
        }
        req.destroy();
        return;
      }
      enqueue(buf);
    });
    req.on("end", () => enqueue(null));
    req.on("error", () => enqueue(null));

    async function* bodyIter(): AsyncIterable<Buffer> {
      while (true) {
        if (bodyChunks.length === 0) {
          const item = await new Promise<Buffer | null>((resolve) =>
            bodyResolvers.push(resolve),
          );
          if (item === null) return;
          yield item;
          continue;
        }
        const chunk = bodyChunks.shift()!;
        // Empty buffer = sentinel for end.
        if (chunk.length === 0 && bodyChunks.length === 0) return;
        if (chunk.length > 0) yield chunk;
      }
    }

    const dispatchRequest: DispatchRequest = {
      method: req.method ?? "GET",
      path: req.url ?? "/",
      headers,
      body: bodyIter(),
      forwardedForIp,
      sniHost,
      isWebSocket,
      wsSubprotocol,
      transport: "h1",
    };

    const sink = makeResponseSink(res);
    try {
      await dispatch.dispatch(dispatchRequest, sink);
    } catch {
      if (!res.headersSent) {
        try {
          res.statusCode = 502;
          res.setHeader("content-type", "text/plain");
          res.end("upstream error");
        } catch {
          /* swallow */
        }
      }
    }
    try {
      if (!res.writableEnded) res.end();
    } catch {
      /* swallow */
    }
  }
}

async function* emptyAsyncIter(): AsyncIterable<Buffer> {
  if (false as boolean) yield Buffer.alloc(0);
}

function makeResponseSink(res: http.ServerResponse): DispatchResponseSink {
  let headSent = false;
  let bodyEnded = false;
  return {
    async sendHead(head: DispatchResponseHead): Promise<void> {
      if (headSent) return;
      headSent = true;
      res.statusCode = head.status;
      // Strip hop-by-hop response headers; let node:http manage
      // transfer-encoding from the rest. Accumulate values per name
      // before calling setHeader once: setHeader(name, value) overwrites
      // the previous value, which would drop earlier Set-Cookie /
      // multi-value entries when iterating one-at-a-time.
      const grouped = new Map<string, string[]>();
      for (const [k, v] of head.headers) {
        const kl = k.toLowerCase();
        if (HOP_BY_HOP_RESPONSE.has(kl)) continue;
        const list = grouped.get(kl);
        if (list === undefined) {
          grouped.set(kl, [v]);
        } else {
          list.push(v);
        }
      }
      for (const [kl, values] of grouped) {
        try {
          // node:http accepts string | string[]; passing an array of
          // length 1 is equivalent to a single string, but using the
          // array form keeps the multi-value Set-Cookie path correct.
          res.setHeader(kl, values.length === 1 ? values[0] : values);
        } catch {
          /* invalid header — skip */
        }
      }
      // node:http calls writeHead lazily on first write; force it now
      // so headers are flushed before any body bytes.
      res.flushHeaders();
    },
    async sendBody(chunk: Buffer): Promise<void> {
      if (bodyEnded) return;
      await new Promise<void>((resolve, reject) => {
        res.write(chunk, (err) => (err ? reject(err) : resolve()));
      });
    },
    async endBody(): Promise<void> {
      if (bodyEnded) return;
      bodyEnded = true;
      await new Promise<void>((resolve) => res.end(resolve));
    },
    async reset(reason: string): Promise<void> {
      bodyEnded = true;
      // h1 has no graceful mid-response reset — destroy the socket.
      // Reason surfaces in logs only; transport closes.
      void reason;
      try {
        res.destroy();
      } catch {
        /* swallow */
      }
    },
  };
}

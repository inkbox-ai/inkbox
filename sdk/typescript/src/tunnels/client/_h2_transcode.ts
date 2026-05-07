/**
 * inkbox-tunnels/client/_h2_transcode.ts
 *
 * Server-side HTTP/2 fed by TLS plaintext via the WireDuplex pattern.
 * Each h2 stream becomes a `DispatchRequest` handed to a `Dispatch`
 * impl; the dispatcher's streamed response is encoded back into
 * HEADERS+DATA+END_STREAM frames.
 *
 * Implements the Plaintext adapter contract used by the runtime in
 * passthrough mode after the TLS terminator.
 *
 * WebSocket-over-h2 (RFC 8441 Extended CONNECT) is supported when the
 * dispatcher exposes ``dispatchWebSocket``: the transcoder builds a
 * byte-channel sink whose inbound DATA frames feed a frame decoder
 * (unmasked per RFC 8441 §5.1) and whose outbound bytes ride h2 DATA
 * frames. Dispatchers without that method respond ``:status 501``.
 */

import * as http2 from "node:http2";
import { Duplex } from "node:stream";
import type {
  Dispatch,
  DispatchRequest,
  DispatchResponseHead,
  DispatchResponseSink,
} from "./_dispatch.js";
import { HOP_BY_HOP_RESPONSE } from "./_protocol.js";
import { ByteChannelWebSocketSink } from "./_ws_passthrough.js";

const OUTBOUND_END = Symbol("outbound-end");

/**
 * Wire-bytes Duplex injected into `http2.createServer()` via
 * `server.emit("connection", duplex)`. Node's h2 server probes a small
 * Socket-like surface on its underlying transport — the methods listed
 * below cover the contract.
 */
class H2WireDuplex extends Duplex {
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
      this.outboundResolvers.shift()!(item);
      return;
    }
    this.outboundQueue.push(item);
  }
}

// Re-exported under the legacy local name; canonical source is
// ``_protocol.HOP_BY_HOP_RESPONSE``. Earlier copies drifted to the
// wrong "trailers" token (TE/Connection value) instead of the
// "trailer" header name.
const RESPONSE_HOP_BY_HOP = HOP_BY_HOP_RESPONSE;

export interface H2TranscoderPlaintextOpts {
  dispatch: Dispatch;
  maxInboundBodyBytes: number;
  forwardedForIp: string | null;
  sniHost: string | null;
}

/**
 * h2 server fed by TLS plaintext; routes streams to a Dispatch impl.
 * One instance per third-party TLS session.
 */
export class H2TranscoderPlaintext {
  private readonly wire: H2WireDuplex;
  private readonly server: http2.Http2Server;
  private readonly maxInboundBodyBytes: number;
  private readonly forwardedForIp: string | null;
  private readonly sniHost: string | null;
  private closed = false;

  constructor(opts: H2TranscoderPlaintextOpts) {
    this.wire = new H2WireDuplex();
    this.maxInboundBodyBytes = opts.maxInboundBodyBytes;
    this.forwardedForIp = opts.forwardedForIp;
    this.sniHost = opts.sniHost;
    this.server = http2.createServer({
      settings: {
        enablePush: false,
        maxConcurrentStreams: 100,
        enableConnectProtocol: true,
      },
    });
    this.server.on("stream", (stream, headers) => {
      void this.handleStream(
        opts.dispatch,
        stream as http2.ServerHttp2Stream,
        headers,
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

  private async handleStream(
    dispatch: Dispatch,
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
  ): Promise<void> {
    const method = (headers[":method"] as string) ?? "GET";
    const path = (headers[":path"] as string) ?? "/";
    const protocol = headers[":protocol"];
    const isWebSocket =
      method === "CONNECT" &&
      typeof protocol === "string" &&
      protocol.toLowerCase() === "websocket";

    // WebSocket-over-h2 — if the dispatcher exposes
    // ``dispatchWebSocket``, build a byte-channel sink whose inbound
    // bytes come from the stream's DATA frames (unmasked per RFC 8441
    // §5.1) and whose outbound bytes flow back as DATA frames. Falls
    // back to 501 when the dispatcher can't service WS upgrades.
    if (isWebSocket) {
      if (typeof dispatch.dispatchWebSocket === "function") {
        await this.handleWebSocketStream(
          dispatch,
          stream,
          headers,
          method,
          path,
        );
        return;
      }
      try {
        stream.respond({
          ":status": 501,
          "content-type": "text/plain",
          "inkbox-reason": "websocket-over-h2-not-implemented",
        });
        stream.end();
      } catch {
        /* swallow */
      }
      return;
    }

    const flatHeaders: Array<[string, string]> = [];
    let wsSubprotocol: string | null = null;
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) {
        for (const item of v) flatHeaders.push([k, item]);
      } else if (typeof v === "string") {
        flatHeaders.push([k, v]);
      }
      if (k === "sec-websocket-protocol" && typeof v === "string") {
        wsSubprotocol = v;
      }
    }

    let inboundCount = 0;
    let oversize = false;
    const bodyChunks: Array<Buffer | null> = [];
    const bodyResolvers: Array<(value: Buffer | null) => void> = [];

    const enqueue = (item: Buffer | null): void => {
      if (bodyResolvers.length > 0) {
        bodyResolvers.shift()!(item);
        return;
      }
      bodyChunks.push(item);
    };

    stream.on("data", (chunk: Buffer | string) => {
      if (oversize) return;
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      inboundCount += buf.length;
      if (inboundCount > this.maxInboundBodyBytes) {
        oversize = true;
        try {
          stream.close(http2.constants.NGHTTP2_REFUSED_STREAM);
        } catch {
          /* swallow */
        }
        enqueue(null);
        return;
      }
      enqueue(buf);
    });
    stream.on("end", () => enqueue(null));
    stream.on("error", () => enqueue(null));
    stream.on("close", () => enqueue(null));

    async function* bodyIter(): AsyncIterable<Buffer> {
      while (true) {
        if (bodyChunks.length > 0) {
          const item = bodyChunks.shift()!;
          if (item === null) return;
          yield item;
          continue;
        }
        const item = await new Promise<Buffer | null>((resolve) =>
          bodyResolvers.push(resolve),
        );
        if (item === null) return;
        yield item;
      }
    }

    const dispatchRequest: DispatchRequest = {
      method,
      path,
      headers: flatHeaders,
      body: bodyIter(),
      forwardedForIp: this.forwardedForIp,
      sniHost: this.sniHost,
      isWebSocket: false,
      wsSubprotocol,
      transport: "h2",
    };

    const sink = makeSink(stream);
    try {
      await dispatch.dispatch(dispatchRequest, sink);
    } catch {
      try {
        if (!sink.headSent) {
          stream.respond({ ":status": 502 });
          stream.end("upstream error");
        }
      } catch {
        /* swallow */
      }
    }
    try {
      if (!stream.closed && !sink.bodyEnded) stream.end();
    } catch {
      /* swallow */
    }
  }

  private async handleWebSocketStream(
    dispatch: Dispatch,
    stream: http2.ServerHttp2Stream,
    headers: http2.IncomingHttpHeaders,
    method: string,
    path: string,
  ): Promise<void> {
    const flatHeaders: Array<[string, string]> = [];
    let wsSubprotocol: string | null = null;
    for (const [k, v] of Object.entries(headers)) {
      if (Array.isArray(v)) {
        for (const item of v) flatHeaders.push([k, item]);
      } else if (typeof v === "string") {
        flatHeaders.push([k, v]);
      }
      if (k === "sec-websocket-protocol" && typeof v === "string") {
        wsSubprotocol = v;
      }
    }

    let acceptInvoked = false;

    const buildAccept = (
      subprotocol: string | null,
      extraHeaders: Array<[string, string]> | null,
    ): Buffer => {
      acceptInvoked = true;
      const out: http2.OutgoingHttpHeaders = { ":status": 200 };
      if (subprotocol !== null) {
        out["sec-websocket-protocol"] = subprotocol;
      }
      if (extraHeaders !== null) {
        // Application-defined response headers — set-cookie, custom
        // X-* flags, etc. Multi-value support via array, mirroring
        // the h1 path. Caller has already filtered hop-by-hop /
        // handshake-control headers.
        for (const [hk, hv] of extraHeaders) {
          const kl = hk.toLowerCase();
          const existing = out[kl];
          if (existing === undefined) {
            out[kl] = hv;
          } else if (Array.isArray(existing)) {
            existing.push(hv);
          } else {
            out[kl] = [String(existing), hv];
          }
        }
      }
      try {
        stream.respond(out);
      } catch {
        /* swallow */
      }
      return Buffer.alloc(0);
    };

    const buildReject = (status: number): Buffer => {
      try {
        stream.respond(
          {
            ":status": status,
            "inkbox-reason": "websocket-rejected",
          },
          { endStream: true },
        );
      } catch {
        /* swallow */
      }
      return Buffer.alloc(0);
    };

    const sendPlaintext = async (data: Buffer): Promise<void> => {
      if (data.length === 0) return;
      await new Promise<void>((resolve) => {
        try {
          if (stream.write(data)) {
            resolve();
          } else {
            stream.once("drain", () => resolve());
          }
        } catch {
          resolve();
        }
      });
    };

    const sink = new ByteChannelWebSocketSink({
      sendPlaintext,
      buildAcceptResponse: buildAccept,
      buildRejectResponse: buildReject,
      requireClientMask: false, // RFC 8441 §5.1 — h2 WS frames unmasked
      onClose: async () => {
        try {
          if (!stream.closed) stream.end();
        } catch {
          /* swallow */
        }
      },
    });
    const wsSink: ByteChannelWebSocketSink = sink;

    stream.on("data", (chunk: Buffer | string) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      wsSink.feedInbound(buf);
    });
    stream.on("end", () => wsSink.signalInboundEof());
    stream.on("close", () => wsSink.signalInboundEof());
    stream.on("error", () => wsSink.signalInboundEof());

    const dispatchRequest: DispatchRequest = {
      method,
      path,
      headers: flatHeaders,
      body: emptyAsyncIter(),
      forwardedForIp: this.forwardedForIp,
      sniHost: this.sniHost,
      isWebSocket: true,
      wsSubprotocol,
      transport: "h2",
    };

    try {
      await dispatch.dispatchWebSocket!(dispatchRequest, wsSink);
    } catch {
      if (!acceptInvoked) {
        try {
          await wsSink.reject({ status: 500 });
        } catch {
          /* swallow */
        }
      }
    } finally {
      try {
        await wsSink.aclose();
      } catch {
        /* swallow */
      }
    }
  }
}

async function* emptyAsyncIter(): AsyncIterable<Buffer> {
  if (false as boolean) yield Buffer.alloc(0);
}

function makeSink(
  stream: http2.ServerHttp2Stream,
): DispatchResponseSink & { headSent: boolean; bodyEnded: boolean } {
  const state = { headSent: false, bodyEnded: false };
  return {
    get headSent() { return state.headSent; },
    get bodyEnded() { return state.bodyEnded; },
    async sendHead(head: DispatchResponseHead): Promise<void> {
      if (state.headSent) return;
      state.headSent = true;
      const out: http2.OutgoingHttpHeaders = { ":status": head.status };
      for (const [k, v] of head.headers) {
        const kl = k.toLowerCase();
        if (RESPONSE_HOP_BY_HOP.has(kl)) continue;
        if (kl.startsWith(":")) continue;
        // Accumulate duplicates as arrays.
        const existing = out[kl];
        if (existing === undefined) {
          out[kl] = v;
        } else if (Array.isArray(existing)) {
          existing.push(v);
        } else {
          out[kl] = [String(existing), v];
        }
      }
      try {
        stream.respond(out);
      } catch {
        /* stream closed before respond — swallow */
      }
    },
    async sendBody(chunk: Buffer): Promise<void> {
      if (state.bodyEnded || chunk.length === 0) return;
      await new Promise<void>((resolve) => {
        // stream.write may return false → wait for drain.
        const ok = stream.write(chunk, (err) => {
          if (err) resolve(); // best effort; let the server drain naturally
          else resolve();
        });
        if (!ok) {
          // Still resolved by the callback; nothing else to do here.
        }
      });
    },
    async endBody(): Promise<void> {
      if (state.bodyEnded) return;
      state.bodyEnded = true;
      try {
        await new Promise<void>((resolve) => stream.end(resolve));
      } catch {
        /* swallow */
      }
    },
    async reset(reason: string): Promise<void> {
      if (state.bodyEnded) return;
      state.bodyEnded = true;
      try {
        stream.close(http2.constants.NGHTTP2_INTERNAL_ERROR);
      } catch {
        /* swallow */
      }
      void reason;
    },
  };
}

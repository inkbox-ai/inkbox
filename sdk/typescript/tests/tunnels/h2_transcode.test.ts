/**
 * Unit tests for the in-process h2 transcoder plaintext adapter (TS).
 */

import { describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import { Duplex } from "node:stream";
import { H2TranscoderPlaintext } from "../../src/tunnels/client/_h2_transcode.js";
import type {
  Dispatch,
  DispatchRequest,
  DispatchResponseSink,
} from "../../src/tunnels/client/_dispatch.js";

class StubDispatch implements Dispatch {
  captured: DispatchRequest | null = null;
  capturedBody = Buffer.alloc(0);

  constructor(
    private status: number = 200,
    private body: Buffer = Buffer.from("hello-h2"),
  ) {}

  async dispatch(
    request: DispatchRequest,
    response: DispatchResponseSink,
  ): Promise<void> {
    this.captured = request;
    const chunks: Buffer[] = [];
    for await (const chunk of request.body) {
      chunks.push(chunk);
    }
    this.capturedBody = Buffer.concat(chunks);
    await response.sendHead({
      status: this.status,
      headers: [["content-type", "text/plain"]],
    });
    if (this.body.length > 0) await response.sendBody(this.body);
    await response.endBody();
  }

  async aclose(): Promise<void> {}
}

class PairedDuplex extends Duplex {
  peer!: PairedDuplex;
  inbound: Buffer[] = [];

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
      const c = this.inbound.shift()!;
      if (!this.push(c)) return;
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

  override _final(cb: (err?: Error | null) => void): void { cb(); }
}

describe("H2TranscoderPlaintext", () => {
  it("round-trips a basic GET via http2.connect", async () => {
    const dispatch = new StubDispatch(200, Buffer.from("hello-from-transcoder"));
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: "1.2.3.4",
      sniHost: "my-agent.example",
    });

    // Wire the transcoder's I/O to a paired Duplex pair so http2.connect
    // can drive it directly.
    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (chunk: Buffer) => {
      void transcoder.feed(chunk);
    });
    void transcoder.pumpOutbound(async (chunk) => {
      clientSide.pushIncoming(chunk);
    });

    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });

    const respBody = await new Promise<string>((resolve, reject) => {
      const req = session.request({ ":method": "GET", ":path": "/x" });
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
      req.end();
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(respBody).toBe("hello-from-transcoder");
    expect(dispatch.captured).not.toBeNull();
    expect(dispatch.captured!.method).toBe("GET");
    expect(dispatch.captured!.path).toBe("/x");
    expect(dispatch.captured!.forwardedForIp).toBe("1.2.3.4");

    session.close();
    await transcoder.aclose();
  }, 10_000);

  it("rejects WebSocket-over-h2 with 501 when dispatcher has no dispatchWebSocket", async () => {
    const dispatch = new StubDispatch();
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (chunk: Buffer) => void transcoder.feed(chunk));
    void transcoder.pumpOutbound(async (c) => {
      clientSide.pushIncoming(c);
    });
    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });
    // Wait for SETTINGS to indicate enableConnectProtocol.
    await new Promise<void>((resolve) => {
      session.once("remoteSettings", () => resolve());
      setTimeout(resolve, 1000);
    });
    const status = await new Promise<number>((resolve, reject) => {
      const req = session.request({
        ":method": "CONNECT",
        ":protocol": "websocket",
        ":path": "/ws",
        ":authority": "localhost",
      });
      req.on("response", (headers) => resolve(Number(headers[":status"])));
      req.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });

    expect(status).toBe(501);

    session.close();
    await transcoder.aclose();
  }, 10_000);
});

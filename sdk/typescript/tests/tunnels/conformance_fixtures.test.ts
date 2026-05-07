/**
 * Cross-language conformance fixtures.
 *
 * Same JSON fixtures live under `<repo>/tests/fixtures/`. Both the
 * Python and TypeScript SDKs consume them and assert the parsed
 * `DispatchRequest` shape matches. If a fixture diverges between SDKs,
 * one side is wrong.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as http2 from "node:http2";
import { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";

import { InProcH1ParserPlaintext } from "../../src/tunnels/client/_h1_server.js";
import { H2TranscoderPlaintext } from "../../src/tunnels/client/_h2_transcode.js";
import type {
  Dispatch,
  DispatchRequest,
  DispatchResponseSink,
} from "../../src/tunnels/client/_dispatch.js";

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(
  path.dirname(__filename),
  "..",
  "..",
  "..",
  "..",
);
const FIXTURES_DIR = path.join(REPO_ROOT, "tests", "fixtures");

interface CapturingDispatchResult {
  captured: DispatchRequest | null;
  body: Buffer;
}

class CapturingDispatch implements Dispatch {
  result: CapturingDispatchResult = {
    captured: null,
    body: Buffer.alloc(0),
  };

  async dispatch(
    request: DispatchRequest,
    response: DispatchResponseSink,
  ): Promise<void> {
    this.result.captured = request;
    const chunks: Buffer[] = [];
    for await (const chunk of request.body) {
      chunks.push(chunk);
    }
    this.result.body = Buffer.concat(chunks);
    await response.sendHead({ status: 200, headers: [] });
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

  override _read(): void {
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

  override _final(cb: (err?: Error | null) => void): void {
    cb();
  }
}

function loadFixture(rel: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, rel), "utf-8"),
  );
}

describe("h1 envelope conformance fixtures", () => {
  it("basic_get fixture matches", async () => {
    const fixture = loadFixture(
      "h1_envelope_reference/basic_get.json",
    ) as {
      input_raw_h1: string;
      expected_dispatch_request: {
        method: string;
        path: string;
        is_websocket: boolean;
        headers: Array<[string, string]>;
      };
    };
    const dispatch = new CapturingDispatch();
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const drain: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      drain.push(c);
    });
    await parser.feed(Buffer.from(fixture.input_raw_h1, "ascii"));

    for (let i = 0; i < 100; i++) {
      if (dispatch.result.captured !== null) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 1000)),
      ]);
    } catch {
      /* swallow */
    }

    expect(dispatch.result.captured).not.toBeNull();
    const c = dispatch.result.captured!;
    expect(c.method).toBe(fixture.expected_dispatch_request.method);
    expect(c.path).toBe(fixture.expected_dispatch_request.path);
    expect(c.isWebSocket).toBe(
      fixture.expected_dispatch_request.is_websocket,
    );
    const lowered = c.headers.map(
      ([k, v]) => [k.toLowerCase(), v] as [string, string],
    );
    expect(lowered).toEqual(fixture.expected_dispatch_request.headers);
  }, 5000);

  it("post_with_chunked_body fixture matches", async () => {
    const fixture = loadFixture(
      "h1_envelope_reference/post_with_chunked_body.json",
    ) as {
      input_raw_h1: string;
      expected_dispatch_request: {
        method: string;
        path: string;
        is_websocket: boolean;
        headers: Array<[string, string]>;
        body_bytes_b64?: string;
      };
    };
    const dispatch = new CapturingDispatch();
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const drain: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      drain.push(c);
    });
    await parser.feed(Buffer.from(fixture.input_raw_h1, "ascii"));

    for (let i = 0; i < 100; i++) {
      if (dispatch.result.captured !== null) break;
      await new Promise((r) => setTimeout(r, 5));
    }
    await new Promise((r) => setTimeout(r, 50));
    await parser.aclose();
    try {
      await Promise.race([
        pump,
        new Promise((r) => setTimeout(r, 1000)),
      ]);
    } catch {
      /* swallow */
    }

    expect(dispatch.result.captured).not.toBeNull();
    const c = dispatch.result.captured!;
    expect(c.method).toBe(fixture.expected_dispatch_request.method);
    expect(c.path).toBe(fixture.expected_dispatch_request.path);
    if (fixture.expected_dispatch_request.body_bytes_b64) {
      const expectedBody = Buffer.from(
        fixture.expected_dispatch_request.body_bytes_b64,
        "base64",
      );
      expect(dispatch.result.body.equals(expectedBody)).toBe(true);
    }
  }, 5000);
});

describe("h2 transcode conformance fixtures", () => {
  it("basic_get fixture matches", async () => {
    const fixture = loadFixture(
      "h2_transcode_reference/basic_get.json",
    ) as {
      input_h2_pseudo_headers: Array<[string, string]>;
      input_h2_regular_headers: Array<[string, string]>;
      expected_dispatch_request: {
        method: string;
        path: string;
        is_websocket: boolean;
        transport: string;
        headers_must_contain: Array<[string, string]>;
      };
    };
    const dispatch = new CapturingDispatch();
    const transcoder = new H2TranscoderPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const [clientSide, serverSide] = PairedDuplex.pair();
    serverSide.on("data", (c: Buffer) => void transcoder.feed(c));
    void transcoder.pumpOutbound(async (c) => {
      clientSide.pushIncoming(c);
    });

    const session = http2.connect("http://localhost", {
      createConnection: () => clientSide,
    });
    await new Promise<void>((resolve) => {
      session.once("remoteSettings", () => resolve());
      setTimeout(resolve, 1000);
    });

    const headers: http2.OutgoingHttpHeaders = {};
    for (const [k, v] of fixture.input_h2_pseudo_headers) {
      headers[k] = v;
    }
    for (const [k, v] of fixture.input_h2_regular_headers) {
      headers[k] = v;
    }
    const req = session.request(headers, { endStream: true });
    req.on("error", () => {
      /* swallow */
    });

    for (let i = 0; i < 100; i++) {
      if (dispatch.result.captured !== null) break;
      await new Promise((r) => setTimeout(r, 10));
    }

    session.destroy();
    await transcoder.aclose();

    expect(dispatch.result.captured).not.toBeNull();
    const c = dispatch.result.captured!;
    expect(c.method).toBe(fixture.expected_dispatch_request.method);
    expect(c.path).toBe(fixture.expected_dispatch_request.path);
    expect(c.transport).toBe(fixture.expected_dispatch_request.transport);
    const headerSet = new Set(
      c.headers.map(([k, v]) => `${k}|${v}`),
    );
    for (const [k, v] of fixture.expected_dispatch_request.headers_must_contain) {
      expect(headerSet.has(`${k}|${v}`)).toBe(true);
    }
  }, 10_000);
});

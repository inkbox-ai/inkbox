/**
 * Unit tests for the in-process h1 parser plaintext adapter (TS).
 */

import { describe, expect, it } from "vitest";
import { InProcH1ParserPlaintext } from "../../src/tunnels/client/_h1_server.js";
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
    private body: Buffer = Buffer.from("hello"),
    private extraHeaders: Array<[string, string]> = [],
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
      headers: [
        ["content-type", "text/plain"],
        ["content-length", String(this.body.length)],
        ...this.extraHeaders,
      ],
    });
    if (this.body.length > 0) await response.sendBody(this.body);
    await response.endBody();
  }

  async aclose(): Promise<void> {}
}

async function driveParser(
  parser: InProcH1ParserPlaintext,
  request: Buffer,
  timeoutMs = 1000,
): Promise<Buffer> {
  const out: Buffer[] = [];
  const pump = parser.pumpOutbound(async (chunk) => {
    out.push(chunk);
  });
  await parser.feed(request);
  await Promise.race([
    pump,
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  await parser.aclose();
  await pump.catch(() => undefined);
  return Buffer.concat(out);
}

describe("InProcH1ParserPlaintext", () => {
  it("parses a basic GET and serializes the response", async () => {
    const dispatch = new StubDispatch(200, Buffer.from("hello-world"));
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: "1.2.3.4",
      sniHost: "my-agent.example",
    });
    const req = Buffer.from(
      "GET /webhook?x=1 HTTP/1.1\r\n" +
        "Host: my-agent.example\r\n" +
        "Connection: close\r\n" +
        "\r\n",
    );
    const out = await driveParser(parser, req);
    expect(out.toString()).toContain("HTTP/1.1 200");
    expect(out.toString()).toContain("hello-world");
    expect(dispatch.captured).not.toBeNull();
    expect(dispatch.captured!.method).toBe("GET");
    expect(dispatch.captured!.path).toBe("/webhook?x=1");
    expect(dispatch.captured!.forwardedForIp).toBe("1.2.3.4");
    expect(dispatch.captured!.sniHost).toBe("my-agent.example");
  });

  it("decodes a POST body via Content-Length", async () => {
    const dispatch = new StubDispatch();
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const req = Buffer.from(
      "POST /e HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Content-Length: 11\r\n" +
        "Connection: close\r\n" +
        "\r\n" +
        "hello-world",
    );
    const out = await driveParser(parser, req);
    expect(out.toString()).toContain("HTTP/1.1 200");
    expect(dispatch.capturedBody.toString()).toBe("hello-world");
  });

  it("decodes a chunked POST body", async () => {
    const dispatch = new StubDispatch();
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const req = Buffer.from(
      "POST /e HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Transfer-Encoding: chunked\r\n" +
        "Connection: close\r\n" +
        "\r\n" +
        "5\r\nhello\r\n" +
        "5\r\nworld\r\n" +
        "0\r\n\r\n",
    );
    const out = await driveParser(parser, req);
    expect(out.toString()).toContain("HTTP/1.1 200");
    expect(dispatch.capturedBody.toString()).toBe("helloworld");
  });

  it("preserves duplicate response headers (e.g. multi-Set-Cookie)", async () => {
    // Earlier shape called res.setHeader(name, value) once per header,
    // so two Set-Cookie responses overwrote each other and the third
    // party only saw the last one. Now the head sender accumulates
    // values per name and passes the array form to setHeader.
    const dispatch = new StubDispatch(200, Buffer.from("ok"), [
      ["set-cookie", "session=abc; Path=/"],
      ["set-cookie", "csrf=xyz; Path=/; HttpOnly"],
      ["x-custom", "value-1"],
    ]);
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });
    const req = Buffer.from(
      "GET /e HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Connection: close\r\n" +
        "\r\n",
    );
    const out = (await driveParser(parser, req)).toString();
    expect(out).toContain("HTTP/1.1 200");
    expect(out).toMatch(/set-cookie:\s*session=abc/i);
    expect(out).toMatch(/set-cookie:\s*csrf=xyz/i);
    expect(out).toMatch(/x-custom:\s*value-1/i);
  });

  it("returns 413 on inbound body cap exceeded", async () => {
    const dispatch = new StubDispatch();
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 8,
      forwardedForIp: null,
      sniHost: null,
    });
    const req = Buffer.from(
      "POST /e HTTP/1.1\r\n" +
        "Host: localhost\r\n" +
        "Content-Length: 100\r\n" +
        "Connection: close\r\n" +
        "\r\n" +
        "X".repeat(100),
    );
    const out = await driveParser(parser, req);
    expect(out.toString()).toContain("HTTP/1.1 413");
    expect(out.toString()).toContain("payload too large");
  });
});

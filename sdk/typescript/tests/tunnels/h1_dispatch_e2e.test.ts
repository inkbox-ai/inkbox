/**
 * Direct e2e: in-process h1 parser + UpstreamUrlDispatch against a
 * real http upstream. Independent of the runtime / TLS layer.
 */

import { describe, expect, it } from "vitest";
import * as http from "node:http";
import { InProcH1ParserPlaintext } from "../../src/tunnels/client/_h1_server.js";
import { UpstreamUrlDispatch } from "../../src/tunnels/client/_dispatch.js";

async function startEcho(): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  return await new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) =>
        chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)),
      );
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(Buffer.concat(chunks));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as { port: number }).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("h1 parser + UpstreamUrlDispatch e2e", () => {
  it("forwards a POST through the parser into a real h1 upstream", async () => {
    const upstream = await startEcho();
    const dispatch = new UpstreamUrlDispatch({
      forwardTo: `http://127.0.0.1:${upstream.port}`,
      publicHost: "test.example",
      maxOutboundBodyBytes: 1_000_000,
      maxInboundBodyBytes: 1_000_000,
    });
    const parser = new InProcH1ParserPlaintext({
      dispatch,
      maxInboundBodyBytes: 1_000_000,
      forwardedForIp: null,
      sniHost: null,
    });

    const out: Buffer[] = [];
    const pump = parser.pumpOutbound(async (c) => {
      out.push(c);
    });

    const reqBody = "ping-from-parser";
    await parser.feed(
      Buffer.from(
        "POST /x HTTP/1.1\r\n" +
          "Host: test.example\r\n" +
          `Content-Length: ${reqBody.length}\r\n` +
          "Connection: close\r\n" +
          "\r\n" +
          reqBody,
      ),
    );
    await new Promise((r) => setTimeout(r, 500));
    await parser.aclose();
    await pump.catch(() => undefined);
    await dispatch.aclose();
    await upstream.close();

    const text = Buffer.concat(out).toString();
    expect(text).toContain("HTTP/1.1 200");
    expect(text).toContain(reqBody);
  }, 10_000);
});

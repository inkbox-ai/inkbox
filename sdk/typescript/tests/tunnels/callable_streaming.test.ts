/**
 * CallableDispatch + invokeHandlerStreaming tests.
 */

import { describe, expect, it } from "vitest";
import { CallableDispatch } from "../../src/tunnels/client/_dispatch.js";
import type {
  DispatchRequest,
  DispatchResponseHead,
  DispatchResponseSink,
} from "../../src/tunnels/client/_dispatch.js";

class CapturingSink implements DispatchResponseSink {
  head: DispatchResponseHead | null = null;
  body: Buffer[] = [];
  ended = false;
  resetReason: string | null = null;

  async sendHead(h: DispatchResponseHead) { this.head = h; }
  async sendBody(c: Buffer) { this.body.push(c); }
  async endBody() { this.ended = true; }
  async reset(r: string) { this.resetReason = r; }
}

async function* emptyBody(): AsyncIterable<Buffer> {
  // No body chunks.
  if (false) yield Buffer.alloc(0);
}

async function* bodyOf(...chunks: string[]): AsyncIterable<Buffer> {
  for (const c of chunks) yield Buffer.from(c);
}

describe("CallableDispatch", () => {
  it("invokes a Fetch-style handler and streams the response", async () => {
    const dispatch = new CallableDispatch({
      handler: async (req, _ctx) => {
        expect(req.method).toBe("GET");
        expect(new URL(req.url).pathname).toBe("/x");
        return new Response("hello-handler", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const sink = new CapturingSink();
    const request: DispatchRequest = {
      method: "GET",
      path: "/x",
      headers: [["host", "agent.test"]],
      body: emptyBody(),
      forwardedForIp: "1.2.3.4",
      sniHost: null,
      isWebSocket: false,
      wsSubprotocol: null,
    };
    await dispatch.dispatch(request, sink);
    expect(sink.head?.status).toBe(200);
    expect(Buffer.concat(sink.body).toString()).toBe("hello-handler");
    expect(sink.ended).toBe(true);
  });

  it("streams a POST body through to the handler", async () => {
    let received = "";
    const dispatch = new CallableDispatch({
      handler: async (req, _ctx) => {
        received = await req.text();
        return new Response("ok", { status: 200 });
      },
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const sink = new CapturingSink();
    const request: DispatchRequest = {
      method: "POST",
      path: "/e",
      headers: [["host", "agent.test"]],
      body: bodyOf("hello-", "world"),
      forwardedForIp: null,
      sniHost: null,
      isWebSocket: false,
      wsSubprotocol: null,
    };
    await dispatch.dispatch(request, sink);
    expect(received).toBe("hello-world");
    expect(sink.head?.status).toBe(200);
  });

  it("rejects WebSocket upgrades with 501", async () => {
    const dispatch = new CallableDispatch({
      handler: async () => new Response("never", { status: 200 }),
      publicHost: "agent.test",
      maxOutboundBodyBytes: 1_000_000,
    });
    const sink = new CapturingSink();
    const request: DispatchRequest = {
      method: "GET",
      path: "/ws",
      headers: [],
      body: emptyBody(),
      forwardedForIp: null,
      sniHost: null,
      isWebSocket: true,
      wsSubprotocol: null,
    };
    await dispatch.dispatch(request, sink);
    expect(sink.head?.status).toBe(501);
  });

  it("resets the stream when handler response exceeds outbound cap", async () => {
    const dispatch = new CallableDispatch({
      handler: async () =>
        new Response("X".repeat(100), { status: 200 }),
      publicHost: "agent.test",
      maxOutboundBodyBytes: 8,
    });
    const sink = new CapturingSink();
    const request: DispatchRequest = {
      method: "GET",
      path: "/big",
      headers: [],
      body: emptyBody(),
      forwardedForIp: null,
      sniHost: null,
      isWebSocket: false,
      wsSubprotocol: null,
    };
    await dispatch.dispatch(request, sink);
    expect(sink.resetReason).toBe("response-too-large");
  });
});

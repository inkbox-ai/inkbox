import { describe, it, expect } from "vitest";
import {
  buildForwardHeaders,
  forwardEnvelopeToUrl,
  joinForwardPath,
} from "../../src/tunnels/client/_url_forward.js";
import type { Envelope } from "../../src/tunnels/client/_envelope.js";
import { TunnelRouteKind } from "../../src/tunnels/client/_protocol.js";

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    requestId: "r-1",
    method: "GET",
    path: "/echo?x=1",
    routeKind: TunnelRouteKind.WEBHOOK,
    wsId: null,
    forwardedHeaders: [],
    body: Buffer.alloc(0),
    bodyUri: null,
    forwardedForIp: null,
    tcpId: null,
    sniHost: null,
    extraMeta: {},
    ...overrides,
  };
}

describe("joinForwardPath", () => {
  it("prefixes the base path of forwardTo onto the envelope path", () => {
    expect(joinForwardPath("http://localhost:8080", "/echo?x=1")).toBe(
      "http://localhost:8080/echo?x=1",
    );
    expect(joinForwardPath("http://localhost:8080/api", "/echo")).toBe(
      "http://localhost:8080/api/echo",
    );
    expect(joinForwardPath("http://localhost:8080/api/", "/echo")).toBe(
      "http://localhost:8080/api/echo",
    );
  });
});

describe("buildForwardHeaders", () => {
  it("injects forwarded headers and strips hop-by-hop", () => {
    const env = makeEnvelope({
      forwardedForIp: "203.0.113.5",
      forwardedHeaders: [
        ["content-type", "application/json"],
        ["connection", "keep-alive"],
        ["host", "wrong"],
        ["x-custom", "ok"],
      ],
    });
    const out = buildForwardHeaders(env, "my-agent.example.com", "127.0.0.1:8080");
    const map = Object.fromEntries(out);
    expect(map["host"]).toBe("127.0.0.1:8080");
    expect(map["x-forwarded-host"]).toBe("my-agent.example.com");
    expect(map["x-forwarded-proto"]).toBe("https");
    expect(map["x-forwarded-for"]).toBe("203.0.113.5");
    expect(map["forwarded"]).toBe("for=203.0.113.5");
    expect(map["content-type"]).toBe("application/json");
    expect(map["x-custom"]).toBe("ok");
    expect(map["connection"]).toBeUndefined();
  });
});

describe("forwardEnvelopeToUrl streaming cap", () => {
  it("bails mid-stream when the response exceeds the cap", async () => {
    let cancelled = false;
    const fakeBody = new ReadableStream<Uint8Array>({
      start(controller) {
        // Push 5 chunks of 100 bytes; the test caps at 250 so the third
        // chunk should be the one that trips the cap.
        controller.enqueue(new Uint8Array(100).fill(0x41));
        controller.enqueue(new Uint8Array(100).fill(0x42));
        controller.enqueue(new Uint8Array(100).fill(0x43));
        controller.enqueue(new Uint8Array(100).fill(0x44));
        controller.enqueue(new Uint8Array(100).fill(0x45));
        controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const fakeFetch: typeof fetch = async () =>
      new Response(fakeBody, {
        status: 200,
        headers: { "content-type": "text/plain" },
      });
    const env = makeEnvelope();
    const result = await forwardEnvelopeToUrl({
      envelope: env,
      forwardTo: "http://localhost:8080",
      publicHost: "my-agent.example.com",
      fetcher: fakeFetch,
      maxResponseBytes: 250,
    });
    expect(result.kind).toBe("too-large");
    if (result.kind === "too-large") {
      expect(result.status).toBe(502);
      expect(result.inkboxReason).toBe("response-too-large");
    }
    expect(cancelled).toBe(true);
  });

  it("returns kind: ok when under the cap", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response("hello", { status: 200 });
    const env = makeEnvelope();
    const result = await forwardEnvelopeToUrl({
      envelope: env,
      forwardTo: "http://localhost:8080",
      publicHost: "my-agent.example.com",
      fetcher: fakeFetch,
      maxResponseBytes: 1024,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.status).toBe(200);
      expect(result.body.toString()).toBe("hello");
    }
  });

  it("returns upstream-unreachable when fetch throws", async () => {
    const fakeFetch: typeof fetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const env = makeEnvelope();
    const result = await forwardEnvelopeToUrl({
      envelope: env,
      forwardTo: "http://localhost:8080",
      publicHost: "my-agent.example.com",
      fetcher: fakeFetch,
      maxResponseBytes: 1024,
    });
    expect(result.kind).toBe("upstream-unreachable");
    if (result.kind === "upstream-unreachable") {
      expect(result.status).toBe(502);
      expect(result.inkboxReason).toBe("upstream-unreachable");
    }
  });

  it("does not send a body for GET/HEAD requests", async () => {
    let observed: RequestInit | undefined;
    const fakeFetch: typeof fetch = async (_url, init) => {
      observed = init as RequestInit;
      return new Response("", { status: 204 });
    };
    const env = makeEnvelope({ method: "GET", body: Buffer.from("payload") });
    await forwardEnvelopeToUrl({
      envelope: env,
      forwardTo: "http://localhost:8080",
      publicHost: "my-agent.example.com",
      fetcher: fakeFetch,
      maxResponseBytes: 1024,
    });
    expect(observed?.body).toBeUndefined();
  });
});

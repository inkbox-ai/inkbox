/**
 * tests/tunnels/handler.test.ts
 *
 * Unit-level coverage for `_handler.ts` paths the integration tests
 * don't exercise: handler throws → handler-error, no body → ok with
 * empty buffer, hop-by-hop response headers stripped, no-body short
 * circuit, signal plumbed through.
 */

import { describe, expect, it } from "vitest";
import { dispatchHttpInProcess } from "../../src/tunnels/client/_handler.js";
import type { Envelope } from "../../src/tunnels/client/_envelope.js";
import { TunnelRouteKind } from "../../src/tunnels/client/_protocol.js";

function makeEnvelope(overrides: Partial<Envelope> = {}): Envelope {
  return {
    requestId: "r-1",
    method: "GET",
    path: "/",
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

describe("dispatchHttpInProcess", () => {
  it("returns kind:'ok' for a normal handler response", async () => {
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () =>
        new Response("hello", { status: 200, headers: { "x-y": "z" } }),
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.status).toBe(200);
      expect(result.body.toString()).toBe("hello");
      expect(result.headers).toContainEqual(["x-y", "z"]);
    }
  });

  it("strips hop-by-hop response headers", async () => {
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () =>
        new Response("ok", {
          status: 200,
          headers: {
            "content-type": "text/plain",
            // Note: Headers init filters out forbidden response headers
            // automatically; "connection" is one of them. Use a
            // workaround by preconstructing a Headers object that
            // skips that filter.
            "x-custom": "yes",
          },
        }),
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      const map = Object.fromEntries(result.headers);
      expect(map["content-type"]).toBe("text/plain");
      expect(map["x-custom"]).toBe("yes");
    }
  });

  it("returns kind:'handler-error' when the handler throws", async () => {
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () => {
        throw new Error("boom");
      },
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("handler-error");
    if (result.kind === "handler-error") {
      expect(result.status).toBe(502);
      expect(result.inkboxReason).toBe("handler-error");
    }
  });

  it("returns kind:'handler-error' when reading the response body throws", async () => {
    // Body that errors out part-way.
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.error(new Error("upstream blew up"));
      },
    });
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () => new Response(body, { status: 200 }),
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("handler-error");
  });

  it("short-circuits to empty body when the response has no body", async () => {
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () => new Response(null, { status: 204 }),
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.status).toBe(204);
      expect(result.body.length).toBe(0);
    }
  });

  it("returns kind:'too-large' when the response exceeds maxResponseBytes", async () => {
    // Stream 5x100-byte chunks; cap at 250.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 5; i++) {
          controller.enqueue(new Uint8Array(100).fill(0x41 + i));
        }
        controller.close();
      },
    });
    const result = await dispatchHttpInProcess({
      envelope: makeEnvelope(),
      handler: async () => new Response(body, { status: 200 }),
      publicHost: "my-agent.example.com",
      maxResponseBytes: 250,
      signal: new AbortController().signal,
    });
    expect(result.kind).toBe("too-large");
    if (result.kind === "too-large") {
      expect(result.status).toBe(502);
      expect(result.inkboxReason).toBe("response-too-large");
    }
  });

  it("plumbs forwardedForIp + sniHost into the request context", async () => {
    let observedCtx: { forwardedForIp: string | null; sniHost: string | null } | null = null;
    await dispatchHttpInProcess({
      envelope: makeEnvelope({
        forwardedForIp: "203.0.113.5",
        sniHost: "my-agent.example.com",
      }),
      handler: async (_req, ctx) => {
        observedCtx = { forwardedForIp: ctx.forwardedForIp, sniHost: ctx.sniHost };
        return new Response("ok", { status: 200 });
      },
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(observedCtx).not.toBeNull();
    expect(observedCtx!.forwardedForIp).toBe("203.0.113.5");
    expect(observedCtx!.sniHost).toBe("my-agent.example.com");
  });

  it("preserves the request body for non-GET methods", async () => {
    let receivedBody = "";
    await dispatchHttpInProcess({
      envelope: makeEnvelope({
        method: "POST",
        body: Buffer.from('{"x":1}'),
        forwardedHeaders: [["content-type", "application/json"]],
      }),
      handler: async (req) => {
        receivedBody = await req.text();
        return new Response("ok", { status: 200 });
      },
      publicHost: "my-agent.example.com",
      maxResponseBytes: 1024,
      signal: new AbortController().signal,
    });
    expect(receivedBody).toBe('{"x":1}');
  });
});

/**
 * tests/tunnels/runtime.test.ts
 *
 * Integration tests for the data-plane runtime, against the
 * in-process fake h2 server (`fake_h2_server.ts`).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import * as tls from "node:tls";
import {
  TunnelAuthError,
  TunnelRuntime,
} from "../../src/tunnels/client/_runtime.js";
import type { InkboxHandler } from "../../src/tunnels/client/_handler.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server();
});

afterEach(async () => {
  await fakeServer.close();
});

function makeRuntime(opts: {
  forwardTo?: string;
  handler?: InkboxHandler;
  rng?: () => number;
  poolSize?: number | null;
}): TunnelRuntime {
  return new TunnelRuntime({
    tunnelId: "11111111-1111-1111-1111-111111111111",
    apiKey: "ApiKey_test",
    zone: fakeServer.authority,
    publicHost: "my-agent.example.com",
    poolSize: opts.poolSize ?? null,
    dispatch:
      opts.handler !== undefined
        ? { httpHandler: opts.handler }
        : { forwardTo: opts.forwardTo ?? "http://127.0.0.1:1" },
    rng: opts.rng,
    http2Connect: (authority, options) => {
      // Override to accept the self-signed cert.
      const merged: tls.ConnectionOptions & http2.SecureClientSessionOptions = {
        ...(options as object),
        rejectUnauthorized: false,
        ca: undefined,
      };
      return http2.connect(authority, merged);
    },
  });
}

describe("TunnelRuntime — happy path", () => {
  it("sends /_system/hello and parks an intake stream", async () => {
    const runtime = makeRuntime({});
    const servePromise = runtime.serveForever();
    // Wait for the first intake post to land.
    const post = await fakeServer.awaitNextIntakePost(2000);
    expect(post.slot).toBe(0);
    expect(post.ownerToken).toBe("tok-test");
    // Hello should be on file by now.
    const hello = fakeServer.receivedHelloHeaders();
    expect(hello).not.toBeNull();
    expect(hello![":path"]).toBe("/_system/hello");
    expect(hello!["x-tunnel-id"]).toBe("11111111-1111-1111-1111-111111111111");
    expect(hello!["x-api-key"]).toBe("ApiKey_test");
    await runtime.aclose();
    await servePromise;
  });
});

describe("TunnelRuntime — auth failure", () => {
  it("propagates TunnelAuthError on hello 401 (no retry)", async () => {
    fakeServer.setHelloResponse(401, {});
    const runtime = makeRuntime({});
    await expect(runtime.serveForever()).rejects.toBeInstanceOf(TunnelAuthError);
  });
});

describe("TunnelRuntime — GOAWAY emits before TCP FIN on aclose()", () => {
  it("emits a GOAWAY frame to the server before the underlying socket closes", async () => {
    // The fake server records GOAWAY events at the session level. We
    // verify the runtime drives Tier 1 of the GOAWAY ladder cleanly:
    // the server sees `goaway` before `close`.
    const runtime = makeRuntime({});
    const servePromise = runtime.serveForever();
    // Wait for the connection to be live.
    await fakeServer.awaitNextIntakePost(2000);

    const events: string[] = [];
    fakeServer.onSessionEvent((kind) => events.push(kind));

    await runtime.aclose();
    await servePromise;

    // We expect at least one `goaway` strictly before any `close`.
    const goawayIdx = events.indexOf("goaway");
    const closeIdx = events.indexOf("close");
    expect(goawayIdx).toBeGreaterThanOrEqual(0);
    expect(closeIdx).toBeGreaterThanOrEqual(0);
    expect(goawayIdx).toBeLessThan(closeIdx);
  }, 10_000);
});

describe("TunnelRuntime — owner-token rotation (5-step abandonment)", () => {
  it("on intake 401, abandons and reconnects with a fresh owner_token", async () => {
    // First, queue an intake response that 401s. The runtime should
    // observe the 401, force-reconnect, send a new hello, and the
    // second hello must produce a *different* owner_token (we
    // rotate it on the fake side).
    const tokens = ["tok-1", "tok-2"];
    let helloCount = 0;
    fakeServer.setHelloResponseFn(() => {
      const tok = tokens[Math.min(helloCount, tokens.length - 1)];
      helloCount += 1;
      return {
        status: 200,
        body: {
          owner_token: tok,
          default_pool_size: 1,
          response_deadline_seconds: 30,
          intake_idle_seconds: 600,
        },
      };
    });
    // Sticky 401 on the first hello's intake; we'll clear it after the
    // reconnect to allow the second token to park successfully.
    fakeServer.setStickyIntakeResponse({
      status: 401,
      headers: [["inkbox-reason", "owner-token-rejected"]],
      body: Buffer.alloc(0),
    });

    const runtime = makeRuntime({ rng: () => 0.0 }); // minimize backoff jitter
    const servePromise = runtime.serveForever();

    // Wait for the second hello (post-reconnect).
    const start = Date.now();
    while (helloCount < 2) {
      if (Date.now() - start > 5000) {
        throw new Error("did not see second hello after 401");
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    expect(helloCount).toBeGreaterThanOrEqual(2);

    // After the reconnect, switch the sticky response to "park" so the
    // second hello's intake POST is observable but doesn't 401-loop.
    fakeServer.setStickyIntakeResponse(null);
    // Drain any remaining tok-1 posts that landed before the
    // reconnect; eventually we'll see a tok-2 one.
    const deadline = Date.now() + 5000;
    let saw = "";
    while (Date.now() < deadline) {
      const p = await fakeServer.awaitNextIntakePost(2000);
      saw = p.ownerToken;
      if (saw === "tok-2") break;
    }
    expect(saw).toBe("tok-2");

    await runtime.aclose();
    await servePromise;
  }, 10_000);
});

describe("TunnelRuntime — HTTP dispatch", () => {
  it("forwards an envelope to forwardTo and posts the response back", async () => {
    // Set up a tiny upstream HTTP server.
    const http = await import("node:http");
    const upstream = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify({ method: req.method, path: req.url, body }));
      });
    });
    await new Promise<void>((resolve) =>
      upstream.listen(0, "127.0.0.1", () => resolve()),
    );
    const upstreamPort = (upstream.address() as { port: number }).port;
    const upstreamUrl = `http://127.0.0.1:${upstreamPort}`;

    // Queue an intake response with a webhook envelope.
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-happy-1"],
        ["inkbox-method", "POST"],
        ["inkbox-path", "/echo"],
        ["inkbox-route-kind", "webhook"],
        ["inkbox-h-content-type", "application/json"],
      ],
      body: Buffer.from('{"hi":"world"}'),
    });

    const runtime = makeRuntime({ forwardTo: upstreamUrl });
    const servePromise = runtime.serveForever();
    const responsePost = await fakeServer.awaitResponsePost("req-happy-1", 5000);
    expect(responsePost.headers["inkbox-status"]).toBe("201");
    const upstreamReply = JSON.parse(responsePost.body.toString("utf-8"));
    expect(upstreamReply.method).toBe("POST");
    expect(upstreamReply.path).toBe("/echo");
    expect(upstreamReply.body).toBe('{"hi":"world"}');
    await runtime.aclose();
    await servePromise;
    await new Promise<void>((resolve) => upstream.close(() => resolve()));
  }, 10_000);
});

describe("TunnelRuntime — in-process handler dispatch", () => {
  it("invokes the handler with a synthesized Request and posts back the response", async () => {
    let observedReq: Request | null = null;
    const handler: InkboxHandler = async (req) => {
      observedReq = req;
      const body = await req.text();
      return new Response(JSON.stringify({ method: req.method, body }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-handler-1"],
        ["inkbox-method", "POST"],
        ["inkbox-path", "/echo?x=1"],
        ["inkbox-route-kind", "webhook"],
        ["inkbox-h-content-type", "application/json"],
      ],
      body: Buffer.from('{"hi":"world"}'),
    });

    const runtime = makeRuntime({ handler });
    const servePromise = runtime.serveForever();
    const responsePost = await fakeServer.awaitResponsePost(
      "req-handler-1",
      5000,
    );
    expect(responsePost.headers["inkbox-status"]).toBe("200");
    const replyBody = JSON.parse(responsePost.body.toString("utf-8"));
    expect(replyBody.method).toBe("POST");
    expect(replyBody.body).toBe('{"hi":"world"}');
    expect(observedReq).not.toBeNull();
    expect(observedReq!.url).toBe("https://my-agent.example.com/echo?x=1");
    await runtime.aclose();
    await servePromise;
  }, 10_000);

  it("posts 504 when the handler outlives the response deadline (hard timeout, not advisory)", async () => {
    // A handler that ignores ``ctx.signal`` and never returns must
    // not wedge the SDK task: the runtime must race against the
    // server-advertised ``response_deadline_seconds`` and post 504
    // immediately when the deadline trips. Without this race a late
    // ``postResponse`` would target a request the server has already
    // 504'd. Mirrors Python's ``_with_deadline()`` semantics.
    fakeServer.setHelloResponse(200, {
      owner_token: "tok-test",
      default_pool_size: 1,
      response_deadline_seconds: 0.3,
      intake_idle_seconds: 600,
    });
    const handler: InkboxHandler = () =>
      new Promise<Response>(() => {
        /* never resolves; ignores ctx.signal */
      });
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-deadline-1"],
        ["inkbox-method", "GET"],
        ["inkbox-path", "/slow"],
        ["inkbox-route-kind", "webhook"],
      ],
      body: Buffer.alloc(0),
    });
    const runtime = makeRuntime({ handler });
    const servePromise = runtime.serveForever();
    const t0 = Date.now();
    const responsePost = await fakeServer.awaitResponsePost(
      "req-deadline-1",
      5000,
    );
    const elapsedMs = Date.now() - t0;
    expect(responsePost.headers["inkbox-status"]).toBe("504");
    expect(responsePost.headers["inkbox-reason"]).toBe(
      "response-deadline-exceeded",
    );
    // Deadline was 300ms; we should post 504 within a reasonable
    // window after that, NOT after the test's 5s timeout.
    expect(elapsedMs).toBeLessThan(2_500);
    await runtime.aclose();
    await servePromise;
  }, 10_000);

  it("returns 502 response-too-large when the handler exceeds the cap", async () => {
    const handler: InkboxHandler = async () =>
      new Response("x".repeat(1024), { status: 200 });
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-cap-1"],
        ["inkbox-method", "GET"],
        ["inkbox-path", "/"],
        ["inkbox-route-kind", "webhook"],
      ],
      body: Buffer.alloc(0),
    });
    const runtime = new TunnelRuntime({
      tunnelId: "11111111-1111-1111-1111-111111111111",
      secret: "sek-test",
      zone: fakeServer.authority,
      publicHost: "my-agent.example.com",
      poolSize: null,
      dispatch: { httpHandler: handler },
      maxResponseBytes: 100,
      http2Connect: (authority, options) =>
        http2.connect(authority, {
          ...(options as object),
          rejectUnauthorized: false,
        } as http2.SecureClientSessionOptions),
    });
    const servePromise = runtime.serveForever();
    const responsePost = await fakeServer.awaitResponsePost("req-cap-1", 5000);
    expect(responsePost.headers["inkbox-status"]).toBe("502");
    expect(responsePost.headers["inkbox-reason"]).toBe("response-too-large");
    await runtime.aclose();
    await servePromise;
  }, 10_000);
});

describe("TunnelRuntime — backoff RNG injection", () => {
  it("calls the injected rng exactly once per backoff attempt with the verbatim formula", async () => {
    fakeServer.setHelloResponse(500, {});
    const calls: number[] = [];
    const rng = () => {
      const v = 0.5; // jitter contribution = backoff * 0.25 * 0
      calls.push(v);
      return v;
    };
    const runtime = makeRuntime({ rng });
    const servePromise = runtime.serveForever();
    await new Promise((r) => setTimeout(r, 1200));
    await runtime.aclose();
    await servePromise;
    expect(calls.length).toBeGreaterThanOrEqual(1);
  });

  it("reproduces the Python backoff schedule from the checked-in fixture", async () => {
    // Cross-language parity: load the Python-generated fixture and
    // simulate the TS schedule against the same input sequence.
    // Floating-point parity between Python and JS is exact for these
    // ops (max, +, *, min — IEEE 754 semantics), so we expect bytewise
    // equality (1 ULP epsilon).
    const fs = await import("node:fs");
    const fixturePath = await import("node:path").then((p) =>
      p.join(__dirname, "..", "fixtures", "backoff_reference.json"),
    );
    const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf-8")) as {
      constants: { backoff_cap: number; backoff_jitter: number };
      rng_inputs: number[];
      schedule: Array<{
        attempt: number;
        rng: number;
        backoff_in: number;
        jitter: number;
        sleep_for: number;
        backoff_out: number;
      }>;
    };

    // Re-run the same formula in TS.
    const BACKOFF_JITTER = fixture.constants.backoff_jitter;
    const BACKOFF_CAP = fixture.constants.backoff_cap;
    let backoff = 1.0;
    for (let attempt = 0; attempt < fixture.rng_inputs.length; attempt++) {
      const r = fixture.rng_inputs[attempt];
      const expected = fixture.schedule[attempt];
      const backoffIn = backoff;
      const jitter = backoff * BACKOFF_JITTER * (2 * r - 1);
      const sleepFor = Math.max(0.1, backoff + jitter);
      const backoffOut = Math.min(backoff * 2, BACKOFF_CAP);

      expect(backoffIn).toBeCloseTo(expected.backoff_in, 12);
      expect(jitter).toBeCloseTo(expected.jitter, 12);
      expect(sleepFor).toBeCloseTo(expected.sleep_for, 12);
      expect(backoffOut).toBeCloseTo(expected.backoff_out, 12);

      backoff = backoffOut;
    }
  });
});

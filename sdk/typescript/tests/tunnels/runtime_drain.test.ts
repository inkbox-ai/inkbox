/**
 * tests/tunnels/runtime_drain.test.ts
 *
 * Make-before-break drain behavior: on a NO_ERROR GOAWAY the runtime
 * stands up a fresh connection + parks a new pool before closing the old
 * one, posts in-flight HTTP replies on the new connection, lets live
 * bridges finish on the old one, and surfaces a typed close to WS handlers.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import * as tls from "node:tls";
import { TunnelRuntime } from "../../src/tunnels/client/_runtime.js";
import type { InkboxHandler } from "../../src/tunnels/client/_handler.js";
import {
  SERVER_DRAINING_WS_CLOSE_CODE,
  WsClosed,
  WsServerDraining,
} from "../../src/tunnels/client/_ws.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server();
});

afterEach(async () => {
  await fakeServer.close();
});

function rotatingHello(): void {
  let n = 0;
  fakeServer.setHelloResponseFn(() => {
    n += 1;
    return {
      status: 200,
      body: {
        owner_token: `tok-${n}`,
        default_pool_size: 1,
        response_deadline_seconds: 30,
        intake_idle_seconds: 600,
      },
    };
  });
}

function makeRuntime(opts: {
  handler?: InkboxHandler;
  forwardTo?: string;
  onStatus?: (s: string) => void;
}): TunnelRuntime {
  return new TunnelRuntime({
    tunnelId: "11111111-1111-1111-1111-111111111111",
    apiKey: "ApiKey_test",
    zone: fakeServer.authority,
    publicHost: "my-agent.example.com",
    poolSize: null,
    dispatch:
      opts.handler !== undefined
        ? { httpHandler: opts.handler }
        : { forwardTo: opts.forwardTo ?? "http://127.0.0.1:1" },
    onStatus: opts.onStatus,
    http2Connect: (authority, options) =>
      http2.connect(authority, {
        ...(options as object),
        rejectUnauthorized: false,
        ca: undefined,
      } as tls.ConnectionOptions & http2.SecureClientSessionOptions),
  });
}

async function waitFor(
  pred: () => boolean,
  timeoutMs = 5000,
  label = "condition",
): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timeout: ${label}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("TunnelRuntime — make-before-break on NO_ERROR GOAWAY", () => {
  it("dials a new connection + parks a fresh pool, without a cold reconnect", async () => {
    rotatingHello();
    const statuses: string[] = [];
    const runtime = makeRuntime({ onStatus: (s) => statuses.push(s) });
    const servePromise = runtime.serveForever();

    // First pool parked under tok-1.
    const first = await fakeServer.awaitNextIntakePost(3000);
    expect(first.ownerToken).toBe("tok-1");
    expect(fakeServer.helloCount()).toBe(1);

    // Drain signal: NO_ERROR GOAWAY on the live session.
    fakeServer.injectGoaway(http2.constants.NGHTTP2_NO_ERROR);

    // A second hello must arrive and a fresh pool park under tok-2 —
    // proving the runtime made a new connection before going cold.
    await waitFor(() => fakeServer.helloCount() >= 2, 5000, "second hello");
    const deadline = Date.now() + 5000;
    let sawTok2 = false;
    while (Date.now() < deadline && !sawTok2) {
      const p = await fakeServer.awaitNextIntakePost(3000);
      if (p.ownerToken === "tok-2") sawTok2 = true;
    }
    expect(sawTok2).toBe(true);

    // Make-before-break is NOT a reconnect: the status never regressed to
    // "reconnecting" across the handoff.
    expect(statuses).not.toContain("reconnecting");

    await runtime.aclose();
    await servePromise;
  }, 15_000);

  it("posts an in-flight webhook reply on the NEW connection after GOAWAY", async () => {
    rotatingHello();
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const handler: InkboxHandler = async () => {
      await gate;
      return new Response("migrated", { status: 200 });
    };
    const runtime = makeRuntime({ handler });
    const servePromise = runtime.serveForever();

    await fakeServer.awaitNextIntakePost(3000);
    // Dispatch a webhook on the first connection; the handler blocks.
    fakeServer.setIntakeResponse({
      status: 200,
      headers: [
        ["inkbox-request-id", "req-migrate"],
        ["inkbox-method", "GET"],
        ["inkbox-path", "/"],
        ["inkbox-route-kind", "webhook"],
      ],
      body: Buffer.alloc(0),
    });
    // Drain mid-flight, then release the handler once the new pool is up.
    fakeServer.injectGoaway(http2.constants.NGHTTP2_NO_ERROR);
    await waitFor(() => fakeServer.helloCount() >= 2, 5000, "second hello");
    release();

    // The reply must ride the SECOND connection (sessionIdx 1) — the old
    // one refuses new streams after GOAWAY.
    const post = await fakeServer.awaitResponsePost("req-migrate", 6000);
    expect(post.headers["inkbox-status"]).toBe("200");
    expect(post.sessionIdx).toBe(1);

    await runtime.aclose();
    await servePromise;
  }, 20_000);
});

describe("WsServerDraining typed close", () => {
  it("is a WsClosed subclass carrying the drain code + reconnect hint", () => {
    const e = new WsServerDraining();
    expect(e).toBeInstanceOf(WsClosed);
    expect(e.code).toBe(SERVER_DRAINING_WS_CLOSE_CODE);
    expect(e.code).toBe(4500);
    expect(e.code).not.toBe(4504); // must not collide with AGENT_TIMEOUT
    expect(e.reconnectAdvised).toBe(true);
  });
});

/**
 * tests/tunnels/runtime_superseded.test.ts
 *
 * Terminal "another client took over this tunnel" (superseded) behavior:
 * the runtime must stop and NOT reconnect, keying on the dedicated GOAWAY
 * code / distinct intake + hello reasons, while never mistaking its own
 * make-before-break reconnect for an external takeover.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as http2 from "node:http2";
import * as tls from "node:tls";
import {
  SUPERSEDED_GOAWAY_ERROR_CODE,
  TunnelRuntime,
  TunnelSupersededError,
} from "../../src/tunnels/client/_runtime.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server();
});

afterEach(async () => {
  await fakeServer.close();
});

function makeRuntime(onStatus?: (s: string) => void): TunnelRuntime {
  return new TunnelRuntime({
    tunnelId: "11111111-1111-1111-1111-111111111111",
    apiKey: "ApiKey_test",
    zone: fakeServer.authority,
    publicHost: "my-agent.example.com",
    poolSize: null,
    dispatch: { forwardTo: "http://127.0.0.1:1" },
    onStatus,
    http2Connect: (authority, options) =>
      http2.connect(authority, {
        ...(options as object),
        rejectUnauthorized: false,
        ca: undefined,
      } as tls.ConnectionOptions & http2.SecureClientSessionOptions),
  });
}

function helloOk(): void {
  fakeServer.setHelloResponse(200, {
    owner_token: "tok-1",
    default_pool_size: 1,
    response_deadline_seconds: 30,
    intake_idle_seconds: 600,
  });
}

const SUPERSEDED_DEBUG = Buffer.from('{"reason":"superseded"}');

describe("TunnelRuntime — superseded (takeover) is terminal", () => {
  it("stops and does not reconnect on a superseded GOAWAY (code + reason)", async () => {
    helloOk();
    const statuses: string[] = [];
    const runtime = makeRuntime((s) => statuses.push(s));
    const servePromise = runtime.serveForever();

    await fakeServer.awaitNextIntakePost(3000);
    expect(fakeServer.helloCount()).toBe(1);

    fakeServer.injectGoaway(SUPERSEDED_GOAWAY_ERROR_CODE, SUPERSEDED_DEBUG);

    await expect(servePromise).rejects.toBeInstanceOf(TunnelSupersededError);
    expect(statuses).toContain("superseded");
    // No cold redial after a takeover.
    expect(fakeServer.helloCount()).toBe(1);
  }, 15_000);

  it("is terminal on the dedicated code alone (debug blob lost)", async () => {
    helloOk();
    const runtime = makeRuntime();
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(3000);

    fakeServer.injectGoaway(SUPERSEDED_GOAWAY_ERROR_CODE); // no opaque data
    await expect(servePromise).rejects.toBeInstanceOf(TunnelSupersededError);
  }, 15_000);

  it("reconnects (not terminal) on a non-superseded non-zero GOAWAY", async () => {
    helloOk();
    const statuses: string[] = [];
    const runtime = makeRuntime((s) => statuses.push(s));
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(3000);

    // An infra GOAWAY (not the dedicated code, no superseded reason).
    fakeServer.injectGoaway(2, Buffer.from('{"reason":"internal"}'));

    // The runtime redials rather than stopping (not terminal).
    const start = Date.now();
    while (fakeServer.helloCount() < 2 && Date.now() - start < 5000) {
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(fakeServer.helloCount()).toBeGreaterThanOrEqual(2);
    expect(statuses).not.toContain("superseded");

    await runtime.aclose();
    await servePromise.catch(() => undefined);
  }, 15_000);

  it("is terminal when displaced during hello (409 hello-superseded)", async () => {
    fakeServer.setHelloResponse(409, { reason: "hello-superseded" });
    const runtime = makeRuntime();
    const servePromise = runtime.serveForever();
    await expect(servePromise).rejects.toBeInstanceOf(TunnelSupersededError);
    // The original error's channel detail survives stopSuperseded's rethrow.
    await expect(servePromise).rejects.toThrow(/during hello/);
    // Displaced hello does not redial and boot the winner.
    expect(fakeServer.helloCount()).toBe(1);
  }, 15_000);

  it("is terminal on a 409 intake-superseded response", async () => {
    helloOk();
    fakeServer.setIntakeResponse({
      status: 409,
      headers: [["inkbox-reason", "intake-superseded"]],
      body: Buffer.from(""),
    });
    const runtime = makeRuntime();
    const servePromise = runtime.serveForever();
    await expect(servePromise).rejects.toBeInstanceOf(TunnelSupersededError);
  }, 15_000);

  it("goes terminal when the flag is set but the error is plain (mid-hello GOAWAY)", async () => {
    // A takeover GOAWAY landing mid-hello sets `superseded` but the hello
    // fails with a plain error; serveForever must stop, not reconnect.
    const statuses: string[] = [];
    const runtime = makeRuntime((s) => statuses.push(s)) as unknown as {
      superseded: boolean;
      runOnce: () => Promise<void>;
      serveForever: () => Promise<void>;
    };
    runtime.runOnce = async () => {
      runtime.superseded = true;
      throw new Error("connection closed during hello");
    };
    await expect(runtime.serveForever()).rejects.toBeInstanceOf(TunnelSupersededError);
    expect(statuses).toContain("superseded");
    expect(statuses).not.toContain("reconnecting");
  });

  it("makeReplacementConnection re-raises a takeover without retrying", async () => {
    // A takeover during the handoff hello propagates terminally instead of
    // being retried within the redial budget (which would boot the winner).
    let attempts = 0;
    const runtime = makeRuntime() as unknown as {
      openConnection: (c: unknown) => Promise<void>;
      sendHello: (c: unknown) => Promise<void>;
      startServing: (c: unknown) => void;
      closeConnection: (c: unknown) => Promise<void>;
      makeReplacementConnection: () => Promise<unknown>;
    };
    runtime.openConnection = async () => undefined;
    runtime.closeConnection = async () => undefined;
    runtime.startServing = () => undefined;
    runtime.sendHello = async () => {
      attempts += 1;
      throw new TunnelSupersededError("taken over during handoff");
    };
    await expect(
      runtime.makeReplacementConnection(),
    ).rejects.toBeInstanceOf(TunnelSupersededError);
    expect(attempts).toBe(1);
  });

  it("makeReplacementConnection stops on the superseded flag despite a plain error", async () => {
    // A takeover GOAWAY landing mid-hello sets `superseded` but the hello fails
    // with a plain reset error (not the typed one). The handoff helper must
    // stop on the first attempt, not keep re-helloing within the redial budget
    // and repeatedly boot the client that replaced us.
    let attempts = 0;
    const runtime = makeRuntime() as unknown as {
      openConnection: (c: unknown) => Promise<void>;
      sendHello: (c: unknown) => Promise<void>;
      startServing: (c: unknown) => void;
      closeConnection: (c: unknown) => Promise<void>;
      makeReplacementConnection: () => Promise<unknown>;
      superseded: boolean;
    };
    runtime.openConnection = async () => undefined;
    runtime.closeConnection = async () => undefined;
    runtime.startServing = () => undefined;
    runtime.sendHello = async () => {
      attempts += 1;
      runtime.superseded = true; // set by the read loop's GOAWAY handler
      throw new Error("connection reset during hello"); // plain, not typed
    };
    await expect(
      runtime.makeReplacementConnection(),
    ).rejects.toBeInstanceOf(TunnelSupersededError);
    expect(attempts).toBe(1);
  });
});

describe("TunnelRuntime — takeover guard (deploy make-before-break)", () => {
  it("is terminal for any conn except our own draining predecessor", () => {
    // Reach the private guard directly. Only a conn we put into make-before-
    // break drain (tracked in `draining`) is ignored; a not-yet-active
    // replacement mid-handoff is a real external takeover and stays terminal.
    const runtime = makeRuntime() as unknown as {
      active: unknown;
      handoffInFlight: boolean;
      draining: Set<unknown>;
      supersededIsTerminal: (c: unknown) => boolean;
      maybeMarkSupersededGoaway: (
        c: unknown,
        code: number,
        d: Buffer | undefined,
      ) => void;
      superseded: boolean;
    };
    const active = { draining: false } as { draining: boolean };
    runtime.active = active;
    runtime.handoffInFlight = false;
    // active conn, not a drain predecessor -> terminal
    expect(runtime.supersededIsTerminal(active)).toBe(true);

    // a not-yet-active replacement (not in `draining`) is terminal, even
    // while a handoff is in flight (regression: previously swallowed)
    const replacement = { draining: false };
    runtime.handoffInFlight = true;
    expect(runtime.supersededIsTerminal(replacement)).toBe(true);

    // only our own draining predecessor is ignored
    runtime.draining.add(active);
    expect(runtime.supersededIsTerminal(active)).toBe(false);

    // A superseded GOAWAY on the draining predecessor leaves us NOT terminal...
    runtime.maybeMarkSupersededGoaway(
      active,
      SUPERSEDED_GOAWAY_ERROR_CODE,
      SUPERSEDED_DEBUG,
    );
    expect(runtime.superseded).toBe(false);

    // ...but the same GOAWAY on the in-flight replacement IS terminal. The
    // intake-superseded path shares this same predicate, so it is covered too.
    runtime.maybeMarkSupersededGoaway(
      replacement,
      SUPERSEDED_GOAWAY_ERROR_CODE,
      SUPERSEDED_DEBUG,
    );
    expect(runtime.superseded).toBe(true);
  });
});

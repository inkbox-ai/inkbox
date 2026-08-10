import { EventEmitter } from "node:events";
import * as http2 from "node:http2";
import * as net from "node:net";
import * as tls from "node:tls";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  TunnelRuntime,
  type TunnelRuntimeOpts,
} from "../../src/tunnels/client/_runtime.js";
import * as supportedConnectApi from "../../src/tunnels/client/index.js";
import { startFakeH2Server, type FakeH2Server } from "./fake_h2_server.js";

let fakeServer: FakeH2Server;

beforeEach(async () => {
  fakeServer = await startFakeH2Server();
});

afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  await fakeServer.close();
});

function realConnect(
  authority: string,
  options: http2.ClientSessionOptions | http2.SecureClientSessionOptions,
): http2.ClientHttp2Session {
  return http2.connect(authority, {
    ...(options as object),
    rejectUnauthorized: false,
    ca: undefined,
  } as tls.ConnectionOptions & http2.SecureClientSessionOptions);
}

function makeRuntime(overrides: Partial<TunnelRuntimeOpts> = {}): TunnelRuntime {
  return new TunnelRuntime({
    tunnelId: "11111111-1111-1111-1111-111111111111",
    apiKey: "ApiKey_test",
    zone: fakeServer.authority,
    publicHost: "my-agent.example.com",
    poolSize: null,
    dispatch: { forwardTo: "http://127.0.0.1:1" },
    http2Connect: realConnect,
    connectTimeoutMs: 80,
    helloTimeoutMs: 80,
    sleep: async () => Promise.resolve(),
    ...overrides,
  });
}

function destroyActiveClientSession(runtime: TunnelRuntime): void {
  const active = (runtime as unknown as {
    active: { session: http2.ClientHttp2Session | null } | null;
  }).active;
  active?.session?.destroy();
}

class StalledSession extends EventEmitter {
  closed = false;
  destroyed = false;
  destroyCount = 0;
  socket = new EventEmitter();

  destroy(): void {
    this.destroyCount += 1;
    if (this.destroyed) return;
    this.destroyed = true;
    this.closed = true;
  }

  close(): void {
    this.destroy();
  }

  goaway(): void {}
}

class FailedSession extends StalledSession {
  failSoon(): void {
    queueMicrotask(() => {
      if (this.destroyed) return;
      this.closed = true;
      this.destroyed = true;
      this.emit("error", new Error("scripted dial failure"));
      this.emit("close");
    });
  }
}

class DirectionalProxy {
  private readonly server = net.createServer();
  private readonly sockets = new Set<net.Socket>();
  private forwardServerToClient = true;
  authority = "";

  constructor(private readonly upstreamPort: number) {}

  async start(): Promise<void> {
    this.server.on("connection", (client) => {
      const upstream = net.connect(this.upstreamPort, "127.0.0.1");
      this.sockets.add(client);
      this.sockets.add(upstream);
      client.on("data", (chunk) => {
        if (!upstream.destroyed) upstream.write(chunk);
      });
      upstream.on("data", (chunk) => {
        if (this.forwardServerToClient && !client.destroyed) client.write(chunk);
      });
      const closeBoth = (): void => {
        client.destroy();
        upstream.destroy();
        this.sockets.delete(client);
        this.sockets.delete(upstream);
      };
      client.on("error", closeBoth);
      upstream.on("error", closeBoth);
      client.on("close", closeBoth);
      upstream.on("close", closeBoth);
    });
    await new Promise<void>((resolve, reject) => {
      this.server.listen(0, "127.0.0.1", resolve);
      this.server.once("error", reject);
    });
    const address = this.server.address() as net.AddressInfo;
    this.authority = `127.0.0.1:${address.port}`;
  }

  setServerToClientForwarding(enabled: boolean): void {
    this.forwardServerToClient = enabled;
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("TunnelRuntime reconnect establishment", () => {
  it("keeps runtime test controls out of the supported connect export", () => {
    expect(supportedConnectApi).not.toHaveProperty("TunnelRuntime");
    expect(supportedConnectApi).not.toHaveProperty("CONNECT_TIMEOUT_MS");
    expect(supportedConnectApi).not.toHaveProperty("HELLO_TIMEOUT_MS");
  });

  it("wakes stream waiters before detaching transport listeners", () => {
    const order: string[] = [];
    const bus = {
      events: [] as Array<{ kind: "reset"; code: number }>,
      waiter: () => order.push("wake"),
      ended: false,
      rstCode: null,
    };
    const conn = {
      streams: new Map([[1, bus]]),
      closePublished: false,
      resolveClosed: () => order.push("closed"),
      detachTransportListeners: () => order.push("detach"),
      cancelConnectWait: null,
    };
    const runtime = makeRuntime() as unknown as {
      publishConnectionClosed: (value: typeof conn) => void;
    };

    runtime.publishConnectionClosed(conn);

    expect(order).toEqual(["wake", "closed", "detach"]);
    expect(bus.ended).toBe(true);
    expect(bus.events).toEqual([{ kind: "reset", code: 0 }]);
  });

  it("times out a stalled dial, destroys it once, and recovers", async () => {
    const stalled = new StalledSession();
    const statuses: string[] = [];
    const sleeps: number[] = [];
    let calls = 0;
    const runtime = makeRuntime({
      connectTimeoutMs: 25,
      onStatus: (status) => statuses.push(status),
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        await Promise.resolve();
      },
      http2Connect: (authority, options) => {
        calls += 1;
        return calls === 1
          ? stalled as unknown as http2.ClientHttp2Session
          : realConnect(authority, options);
      },
    });

    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(2_000);

    expect(stalled.destroyCount).toBe(1);
    expect(stalled.listenerCount("close")).toBe(0);
    expect(stalled.listenerCount("error")).toBe(0);
    expect(stalled.listenerCount("goaway")).toBe(0);
    expect(stalled.socket.listenerCount("close")).toBe(0);
    expect(stalled.socket.listenerCount("error")).toBe(0);
    expect(statuses).toEqual(expect.arrayContaining(["connecting", "reconnecting", "connected"]));
    expect(sleeps).toHaveLength(1);
    expect(runtime.status).toBe("connected");
    expect(runtime.isConnected).toBe(true);
    expect(runtime.lastConnectedAt).toBeInstanceOf(Date);

    const helloCount = fakeServer.helloCount();
    stalled.on("error", () => undefined);
    stalled.emit("goaway", 0x1201, 0, Buffer.from('{"reason":"superseded"}'));
    stalled.socket.emit("close", false);
    stalled.emit("error", new Error("late error"));
    await Promise.resolve();
    expect(stalled.destroyCount).toBe(1);
    expect(fakeServer.helloCount()).toBe(helloCount);
    expect(runtime.status).toBe("connected");

    await runtime.aclose();
    await servePromise;
  });

  it.each(["timeout", "early close"] as const)(
    "recovers after HELLO %s without retaining the failed session",
    async (failure) => {
      if (failure === "timeout") fakeServer.deferNextHello();
      else fakeServer.closeNextHello();
      const runtime = makeRuntime({ helloTimeoutMs: 30 });
      const servePromise = runtime.serveForever();

      await fakeServer.awaitNextIntakePost(2_000);
      expect(fakeServer.helloCount()).toBeGreaterThanOrEqual(2);
      expect(fakeServer.acceptedSessionCount()).toBeGreaterThanOrEqual(2);
      expect(fakeServer.sessionCount()).toBe(1);
      expect(fakeServer.pendingHelloCount()).toBe(0);
      expect(fakeServer.incompleteHelloCloseCount()).toBe(1);
      expect(fakeServer.helloResponseCount()).toBe(1);
      expect(fakeServer.sessionCloseCount()).toBe(1);
      expect(runtime.status).toBe("connected");

      await runtime.aclose();
      await servePromise;
    },
  );

  it("logs the failed phase and attempt without credentials", async () => {
    fakeServer.deferNextHello();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sleeps: number[] = [];
    const runtime = makeRuntime({
      helloTimeoutMs: 25,
      rng: () => 0.5,
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        await Promise.resolve();
      },
    });
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(2_000);

    const output = [...info.mock.calls, ...warn.mock.calls]
      .flat()
      .map(String)
      .join("\n");
    expect(output).toMatch(/connection attempt #1/);
    expect(output).toMatch(/hello timeout on attempt #1/);
    expect(output).toMatch(/attempt #2 in 1000ms/);
    expect(output).not.toContain("ApiKey_test");
    expect(sleeps[0]).toBe(1_000);

    await runtime.aclose();
    await servePromise;
  });

  it("keeps the last connection timestamp while cold and advances it on recovery", async () => {
    const statuses: string[] = [];
    const runtime = makeRuntime({ onStatus: (status) => statuses.push(status) });
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(2_000);
    const first = runtime.lastConnectedAt!;

    await new Promise((resolve) => setTimeout(resolve, 5));
    destroyActiveClientSession(runtime);
    await fakeServer.awaitNextIntakePost(2_000);

    expect(statuses).toContain("reconnecting");
    expect(runtime.status).toBe("connected");
    expect(runtime.lastConnectedAt!.getTime()).toBeGreaterThan(first.getTime());

    await runtime.aclose();
    await servePromise;
  });

  it("isolates status callback failures and still reconnects", async () => {
    let connected = 0;
    const runtime = makeRuntime({
      onStatus: (status) => {
        if (status === "connected") connected += 1;
        if (status === "reconnecting") throw new Error("observer failed");
      },
    });
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(2_000);
    destroyActiveClientSession(runtime);
    await fakeServer.awaitNextIntakePost(2_000);
    expect(connected).toBe(2);

    await runtime.aclose();
    await servePromise;
  });
});

describe("TunnelRuntime integrated recovery", () => {
  it("recovers from a missed PING through three failed redials", async () => {
    const proxy = new DirectionalProxy(fakeServer.port);
    await proxy.start();
    const statuses: string[] = [];
    const sleeps: number[] = [];
    const realSessions: http2.ClientHttp2Session[] = [];
    let connectCalls = 0;
    const runtime = makeRuntime({
      zone: proxy.authority,
      pingIntervalMs: 50,
      pingAckTimeoutMs: 25,
      rng: () => 0.5,
      onStatus: (status) => statuses.push(status),
      sleep: async (delayMs) => {
        sleeps.push(delayMs);
        await Promise.resolve();
      },
      http2Connect: (authority, options) => {
        connectCalls += 1;
        if (connectCalls >= 2 && connectCalls <= 4) {
          const failed = new FailedSession();
          failed.failSoon();
          return failed as unknown as http2.ClientHttp2Session;
        }
        if (connectCalls === 5) proxy.setServerToClientForwarding(true);
        const session = realConnect(authority, options);
        realSessions.push(session);
        return session;
      },
    });
    const servePromise = runtime.serveForever();
    try {
      await fakeServer.awaitNextIntakePost(2_000);
      proxy.setServerToClientForwarding(false);
      await fakeServer.awaitNextPing(2_000);
      await fakeServer.awaitNextIntakePost(2_000);
      await fakeServer.awaitNextPing(2_000);

      expect(connectCalls).toBe(5);
      expect(sleeps.slice(0, 4)).toEqual([1_000, 2_000, 4_000, 8_000]);
      expect(statuses).toEqual([
        "connecting",
        "connected",
        "reconnecting",
        "connected",
      ]);
      expect(fakeServer.acceptedSessionCount()).toBe(2);
      expect(fakeServer.helloResponseCount()).toBe(2);
      expect(fakeServer.pendingHelloCount()).toBe(0);
      expect(realSessions[0].destroyed).toBe(true);
      expect(runtime.status).toBe("connected");
      expect(runtime.isConnected).toBe(true);
    } finally {
      await runtime.aclose();
      await servePromise;
      await proxy.close();
    }
  }, 10_000);

  it("falls back to cold recovery after a GOAWAY handoff exhausts its budget", async () => {
    const statuses: string[] = [];
    let releaseColdSleep: () => void = () => undefined;
    const coldSleep = new Promise<void>((resolve) => {
      releaseColdSleep = resolve;
    });
    const runtime = makeRuntime({
      helloTimeoutMs: 25,
      handoffRedialBudgetMs: 80,
      rng: () => 0.5,
      onStatus: (status) => statuses.push(status),
      sleep: async (delayMs) => {
        if (delayMs >= 500) await coldSleep;
        else await Promise.resolve();
      },
    });
    const servePromise = runtime.serveForever();
    await fakeServer.awaitNextIntakePost(2_000);
    fakeServer.setDeferHellos(true);
    fakeServer.injectGoaway(http2.constants.NGHTTP2_NO_ERROR);

    await waitFor(() => runtime.status === "reconnecting");
    expect(statuses).toEqual(["connecting", "connected", "reconnecting"]);
    expect(fakeServer.incompleteHelloCloseCount()).toBeGreaterThan(0);
    expect(fakeServer.sessionCloseCount()).toBeGreaterThan(0);

    fakeServer.setDeferHellos(false);
    releaseColdSleep();
    await fakeServer.awaitNextIntakePost(2_000);
    await waitFor(() => fakeServer.pendingHelloCount() === 0);

    expect(statuses).toEqual([
      "connecting",
      "connected",
      "reconnecting",
      "connected",
    ]);
    expect(fakeServer.helloResponseCount()).toBe(2);
    expect(fakeServer.pendingHelloCount()).toBe(0);
    expect(fakeServer.sessionCount()).toBe(1);

    await runtime.aclose();
    await servePromise;
  }, 10_000);
});

describe("TunnelRuntime bounded handoff", () => {
  it("bounds a stalled replacement HELLO by the handoff budget", async () => {
    const sessions: StalledSession[] = [];
    const runtime = makeRuntime({
      helloTimeoutMs: 20,
      handoffRedialBudgetMs: 70,
      sleep: async () => Promise.resolve(),
    }) as unknown as {
      openConnection: (conn: { session: http2.ClientHttp2Session | null }) => Promise<void>;
      sendHello: () => Promise<void>;
      makeReplacementConnection: () => Promise<unknown>;
    };
    runtime.openConnection = async (conn) => {
      const session = new StalledSession();
      sessions.push(session);
      conn.session = session as unknown as http2.ClientHttp2Session;
    };
    runtime.sendHello = () => new Promise<void>(() => undefined);

    const started = performance.now();
    await expect(runtime.makeReplacementConnection()).rejects.toThrow(
      "handoff redial budget exhausted",
    );
    expect(performance.now() - started).toBeLessThan(300);
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions.every((session) => session.destroyCount === 1)).toBe(true);
  });
});

describe("TunnelRuntime PING acknowledgement deadline", () => {
  it("destroys at the acknowledgement deadline and clears acknowledged timers", async () => {
    vi.useFakeTimers();
    const callbacks: Array<(err?: Error | null) => void> = [];
    const session = {
      closed: false,
      destroyed: false,
      destroy: vi.fn(),
      ping: (callback: (err?: Error | null) => void) => callbacks.push(callback),
    };
    const conn = {
      session,
      pingHandle: null,
      pingAckHandles: new Set<NodeJS.Timeout>(),
      streams: new Map(),
      closePublished: false,
      resolveClosed: () => undefined,
      detachTransportListeners: null,
      cancelConnectWait: null,
    };
    const runtime = makeRuntime({
      pingIntervalMs: 50,
      pingAckTimeoutMs: 20,
    }) as unknown as {
      startPingLoop: (value: typeof conn) => void;
      stopPingLoop: (value: typeof conn) => void;
    };

    runtime.startPingLoop(conn);
    await vi.advanceTimersByTimeAsync(50);
    expect(callbacks).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(19);
    expect(session.destroy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);

    session.destroy.mockClear();
    await vi.advanceTimersByTimeAsync(30);
    expect(callbacks).toHaveLength(2);
    callbacks[1](null);
    await vi.advanceTimersByTimeAsync(20);
    expect(session.destroy).not.toHaveBeenCalled();
    runtime.stopPingLoop(conn);
  });
});

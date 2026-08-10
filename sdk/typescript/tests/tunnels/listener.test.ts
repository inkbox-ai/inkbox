/**
 * tests/tunnels/listener.test.ts
 *
 * Listener-level behavior tests: signal-handler installation matrix
 * (`true` / `false` / `undefined`) and runtime-error capture.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TunnelListenerImpl,
  type TunnelListener,
} from "../../src/tunnels/client/_listener.js";
import {
  TunnelAuthError,
  TunnelRuntime,
  TunnelSupersededError,
  type TunnelRuntimeStatus,
} from "../../src/tunnels/client/_runtime.js";
import type { Tunnel } from "../../src/tunnels/types.js";
import { TLSMode, TunnelStatus } from "../../src/tunnels/types.js";

function fakeTunnel(): Tunnel {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    organizationId: "org_test",
    tunnelName: "my-agent",
    tlsMode: TLSMode.EDGE,
    certPem: null,
    certFingerprintSha256: null,
    certExpiresAt: null,
    status: TunnelStatus.ACTIVE,
    lastConnectedAt: null,
    lastConnectedIpAddr: null,
    lastDisconnectedAt: null,
    currentlyConnected: false,
    publicHost: "my-agent.inkboxwire.com",
    zone: "inkboxwire.com",
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

class FakeRuntime {
  private resolveServe: (() => void) | null = null;
  private rejectServe: ((err: unknown) => void) | null = null;
  private servePromise: Promise<void>;
  closed = false;
  status: TunnelRuntimeStatus = "idle";
  isConnected = false;
  private connectedAt: Date | null = null;

  constructor() {
    this.servePromise = new Promise<void>((resolve, reject) => {
      this.resolveServe = resolve;
      this.rejectServe = reject;
    });
  }

  async serveForever(): Promise<void> {
    return this.servePromise;
  }

  async aclose(): Promise<void> {
    this.closed = true;
    this.status = "closed";
    this.isConnected = false;
    this.resolveServe?.();
  }

  get lastConnectedAt(): Date | null {
    return this.connectedAt === null ? null : new Date(this.connectedAt);
  }

  setConnected(at: Date): void {
    this.status = "connected";
    this.isConnected = true;
    this.connectedAt = new Date(at);
  }

  failWith(err: unknown): void {
    this.rejectServe?.(err);
  }
}

function makeListener(opts: {
  installSignalHandlers?: boolean;
  fakeRuntime?: FakeRuntime;
}): { listener: TunnelListener; runtime: FakeRuntime } {
  const runtime = opts.fakeRuntime ?? new FakeRuntime();
  const listener = new TunnelListenerImpl({
    publicHost: "my-agent.inkboxwire.com",
    tunnel: fakeTunnel(),
    runtime: runtime as unknown as TunnelRuntime,
    listenerOpts: { installSignalHandlers: opts.installSignalHandlers },
  });
  return { listener, runtime };
}

// Snapshot + restore process listeners so each test starts clean.
let preTestSigterm: NodeJS.SignalsListener[];
let preTestSigint: NodeJS.SignalsListener[];

beforeEach(() => {
  preTestSigterm = process.listeners("SIGTERM").slice();
  preTestSigint = process.listeners("SIGINT").slice();
  // Strip everything for predictable tests.
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
});

afterEach(() => {
  process.removeAllListeners("SIGTERM");
  process.removeAllListeners("SIGINT");
  for (const l of preTestSigterm) process.on("SIGTERM", l);
  for (const l of preTestSigint) process.on("SIGINT", l);
});

describe("TunnelListener — terminal runtime results", () => {
  it("rejects serveForever() and every wait() with the same runtime error", async () => {
    const runtime = new FakeRuntime();
    const { listener } = makeListener({
      installSignalHandlers: false,
      fakeRuntime: runtime,
    });
    const error = new TunnelAuthError("invalid key");
    const servePromise = listener.serveForever();
    runtime.failWith(error);
    await expect(servePromise).rejects.toBe(error);
    await expect(listener.wait()).rejects.toBe(error);
    await expect(listener.wait()).rejects.toBe(error);
  });

  it("preserves a takeover error across serveForever() and wait()", async () => {
    const runtime = new FakeRuntime();
    const { listener } = makeListener({
      installSignalHandlers: false,
      fakeRuntime: runtime,
    });
    const error = new TunnelSupersededError("taken over");
    const servePromise = listener.serveForever();
    runtime.failWith(error);
    await expect(servePromise).rejects.toBe(error);
    await expect(listener.wait()).rejects.toBe(error);
  });

  it("clean shutdown returns without error", async () => {
    const { listener } = makeListener({ installSignalHandlers: false });
    setTimeout(() => listener.aclose(), 10);
    await listener.wait();
  });

  it("handles a serve rejection before awaiting runtime cleanup", async () => {
    const error = new TunnelAuthError("rejected during cleanup");
    class RejectDuringCloseRuntime extends FakeRuntime {
      override async aclose(): Promise<void> {
        this.failWith(error);
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    const runtime = new RejectDuringCloseRuntime();
    const { listener } = makeListener({
      installSignalHandlers: false,
      fakeRuntime: runtime,
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      void listener.serveForever();
      await listener.aclose();
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      await expect(listener.wait()).rejects.toBe(error);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("TunnelListener — local liveness", () => {
  it("samples status and returns defensive Date values", async () => {
    const runtime = new FakeRuntime();
    const { listener } = makeListener({
      installSignalHandlers: false,
      fakeRuntime: runtime,
    });
    expect(listener.status).toBe("idle");
    expect(listener.isConnected).toBe(false);
    expect(listener.lastConnectedAt).toBeNull();

    const connectedAt = new Date("2026-08-10T12:00:00.000Z");
    runtime.setConnected(connectedAt);
    const sampled = listener.lastConnectedAt!;
    sampled.setTime(0);
    expect(listener.status).toBe("connected");
    expect(listener.isConnected).toBe(true);
    expect(listener.lastConnectedAt?.getTime()).toBe(connectedAt.getTime());

    await listener.aclose();
    expect(listener.status).toBe("closed");
    expect(listener.isConnected).toBe(false);
  });
});

describe("TunnelListener — signal handler installation matrix", () => {
  it("installSignalHandlers: false is a no-op on signals", async () => {
    const { listener } = makeListener({ installSignalHandlers: false });
    expect(process.listenerCount("SIGTERM")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(0);
    await listener.aclose();
  });

  it("installSignalHandlers: true installs even with pre-existing host handlers", async () => {
    const hostHandler = (): void => undefined;
    process.on("SIGTERM", hostHandler);
    process.on("SIGINT", hostHandler);
    const { listener } = makeListener({ installSignalHandlers: true });
    // Both handlers attached: host's + SDK's.
    expect(process.listenerCount("SIGTERM")).toBe(2);
    expect(process.listenerCount("SIGINT")).toBe(2);
    await listener.aclose();
    // SDK handler removed on aclose; host's remains.
    expect(process.listenerCount("SIGTERM")).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(1);
  });

  it("default (undefined) installs iff no pre-existing handler at construction time", async () => {
    // No pre-existing host handler => SDK installs.
    const { listener: l1 } = makeListener({});
    expect(process.listenerCount("SIGTERM")).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(1);
    await l1.aclose();
    expect(process.listenerCount("SIGTERM")).toBe(0);
    expect(process.listenerCount("SIGINT")).toBe(0);

    // Pre-existing host handler => SDK does NOT install.
    const hostHandler = (): void => undefined;
    process.on("SIGTERM", hostHandler);
    process.on("SIGINT", hostHandler);
    const { listener: l2 } = makeListener({});
    expect(process.listenerCount("SIGTERM")).toBe(1); // just host
    expect(process.listenerCount("SIGINT")).toBe(1);
    await l2.aclose();
    // Listener didn't install, so the host handler is untouched.
    expect(process.listenerCount("SIGTERM")).toBe(1);
    expect(process.listenerCount("SIGINT")).toBe(1);
  });

  it("default mode does NOT re-install if host removes its handlers later (documented non-feature)", async () => {
    const hostHandler = (): void => undefined;
    process.on("SIGTERM", hostHandler);
    process.on("SIGINT", hostHandler);
    const { listener } = makeListener({});
    // SDK didn't install at construction.
    expect(process.listenerCount("SIGTERM")).toBe(1);
    // Host removes its handlers later.
    process.off("SIGTERM", hostHandler);
    process.off("SIGINT", hostHandler);
    expect(process.listenerCount("SIGTERM")).toBe(0);
    // SDK does NOT re-install on construction-time absence.
    expect(process.listenerCount("SIGINT")).toBe(0);
    await listener.aclose();
  });
});

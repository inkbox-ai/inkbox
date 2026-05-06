/**
 * inkbox-tunnels/client/_listener.ts
 *
 * Public TunnelListener interface and implementation. Drives the
 * {@link TunnelRuntime} to completion; surfaces fatal runtime errors
 * via `wait()`.
 */

import type { Tunnel } from "../types.js";
import type { TunnelRuntime } from "./_runtime.js";

export type TunnelStatusCallback = (
  status: "connecting" | "connected" | "reconnecting" | "closed",
) => void;

/**
 * Options that affect how the listener behaves around process signals.
 *
 * The default mode is `undefined`: the listener installs SIGINT/SIGTERM
 * handlers iff the parent process has none at construction time. Hosts
 * that own their shutdown code should set `installSignalHandlers: false`
 * and call `await listener.aclose()` from their own handler.
 */
export interface TunnelListenerOpts {
  installSignalHandlers?: boolean;
}

/**
 * A live tunnel.
 *
 * Returned by `connect(...)`. Use `await listener.wait()` to block
 * until shutdown, or call `await listener.close()` to drive a clean
 * teardown.
 */
export interface TunnelListener {
  /** `https://{public_host}`. */
  readonly publicUrl: string;
  /** Snapshot of the resource record taken at bootstrap. Not refreshed. */
  readonly tunnel: Tunnel;
  /** Block until shutdown. Resolves on clean close; throws on fatal. */
  wait(): Promise<void>;
  /** Drive a graceful shutdown. Idempotent. */
  close(): Promise<void>;
  /** Async-friendly alias for `close()`. */
  aclose(): Promise<void>;
  /** Run the runtime to completion. */
  serveForever(): Promise<void>;
}

export class TunnelListenerImpl implements TunnelListener {
  readonly publicUrl: string;
  readonly tunnel: Tunnel;
  private readonly runtime: TunnelRuntime;
  private servePromise: Promise<void> | null = null;
  private closed = false;
  private capturedError: unknown = null;
  private installedSigintHandler: (() => void) | null = null;
  private installedSigtermHandler: (() => void) | null = null;
  private willExitOnSignal = false;

  constructor(opts: {
    publicHost: string;
    tunnel: Tunnel;
    runtime: TunnelRuntime;
    listenerOpts?: TunnelListenerOpts;
  }) {
    this.publicUrl = `https://${opts.publicHost}`;
    this.tunnel = opts.tunnel;
    this.runtime = opts.runtime;

    const listenerOpts = opts.listenerOpts ?? {};
    const explicit = listenerOpts.installSignalHandlers;
    let shouldInstall: boolean;
    if (explicit === true) {
      const hadHandlers =
        process.listenerCount("SIGTERM") > 0 ||
        process.listenerCount("SIGINT") > 0;
      if (hadHandlers) {
        // eslint-disable-next-line no-console
        console.warn(
          "TunnelListener: installSignalHandlers=true requested but " +
            "pre-existing SIGTERM/SIGINT handlers are present. The SDK " +
            "handler attaches alongside; both run on signal.",
        );
      }
      shouldInstall = true;
      this.willExitOnSignal = true;
    } else if (explicit === false) {
      shouldInstall = false;
    } else {
      // Default: install iff none exist at construction time.
      shouldInstall =
        process.listenerCount("SIGTERM") === 0 &&
        process.listenerCount("SIGINT") === 0;
      this.willExitOnSignal = shouldInstall;
    }
    if (shouldInstall) {
      const handler = (): void => {
        void (async () => {
          try {
            await this.aclose();
          } finally {
            if (this.willExitOnSignal) {
              process.exit(0);
            }
          }
        })();
      };
      this.installedSigtermHandler = handler;
      this.installedSigintHandler = handler;
      process.on("SIGTERM", handler);
      process.on("SIGINT", handler);
    }
  }

  async serveForever(): Promise<void> {
    if (this.servePromise !== null) return this.servePromise;
    this.servePromise = (async () => {
      try {
        await this.runtime.serveForever();
      } catch (err) {
        this.capturedError = err;
      }
    })();
    return this.servePromise;
  }

  async wait(): Promise<void> {
    await this.serveForever();
    if (this.capturedError !== null) {
      const err = this.capturedError;
      this.capturedError = null;
      throw err;
    }
  }

  async close(): Promise<void> {
    return this.aclose();
  }

  async aclose(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    await this.runtime.aclose();
    if (this.installedSigtermHandler !== null) {
      process.off("SIGTERM", this.installedSigtermHandler);
      this.installedSigtermHandler = null;
    }
    if (this.installedSigintHandler !== null) {
      process.off("SIGINT", this.installedSigintHandler);
      this.installedSigintHandler = null;
    }
    if (this.servePromise !== null) {
      try {
        await this.servePromise;
      } catch {
        /* swallow — captured in capturedError if relevant */
      }
    }
  }
}

/**
 * inkbox-tunnels/client/_listener.ts
 *
 * Public TunnelListener interface. This module exposes the stable
 * surface; the data-plane runtime is gated on Node http2 / TLSSocket
 * support landing and ships in a follow-up release.
 */

import type { Tunnel } from "../types.js";

export type TunnelStatusCallback = (
  status: "connecting" | "connected" | "reconnecting" | "closed",
) => void;

/**
 * A live tunnel.
 *
 * Returned by `connect(...)`. Shape mirrors the Python `TunnelListener`.
 * Use `await listener.wait()` to block until shutdown, or call
 * `await listener.close()` to drive a clean teardown.
 */
export interface TunnelListener {
  /** `https://{public_host}`. */
  readonly publicUrl: string;
  /** Snapshot of the resource record taken at bootstrap. Not refreshed. */
  readonly tunnel: Tunnel;
  /** Block until shutdown. Resolves on clean close. */
  wait(): Promise<void>;
  /** Drive a graceful shutdown. Idempotent. */
  close(): Promise<void>;
}

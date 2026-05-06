/**
 * @inkbox/sdk/tunnels/connect — Node-only data-plane runtime.
 *
 * Imported as:
 *
 * ```ts
 * import { connect } from "@inkbox/sdk/tunnels/connect";
 * ```
 *
 * This subpath pulls in `node:http2`, `node:tls`, `node:fs`, and
 * `node:os`, so it is NOT browser-safe. The main package entry
 * (`@inkbox/sdk`) stays browser-safe; only this subpath gates on Node.
 *
 * The data-plane runtime is not yet implemented in the TypeScript SDK
 * (Node's high-level `http2` API does not currently expose the level
 * of control we need for RFC 8441 extended CONNECT, explicit
 * flow-control credits, and WS framing). Until it ships, `connect()`
 * validates its inputs and then refuses with
 * `TunnelRuntimeNotImplemented`. **No control-plane writes are
 * performed** — calling `connect()` cannot create a tunnel, restore
 * one, or persist a secret on disk. The typed surface (TunnelListener,
 * options) is stable.
 */

import type { Inkbox } from "../../inkbox.js";
import { POOL_SIZE_MAX, POOL_SIZE_MIN } from "../resources/tunnels.js";
import {
  TunnelRemoved,
  TunnelSecretUnavailable,
  TunnelStateConflict,
} from "../exceptions.js";
import { validateTunnelName } from "../_validation.js";
import { TLSMode, Tunnel, TunnelStatus } from "../types.js";
import {
  ForwardTargetRefused,
  validateEnvelopePath,
  validateForwardTarget,
} from "./_validation.js";
import {
  defaultStateDir,
  ensurePrivateStateDir,
  loadState,
  printSecretOnce,
  saveState,
} from "./_state.js";
import type { TunnelListener, TunnelStatusCallback } from "./_listener.js";

export type { TunnelListener, TunnelStatusCallback } from "./_listener.js";
export {
  ForwardTargetRefused,
  validateEnvelopePath,
  validateForwardTarget,
} from "./_validation.js";

/** Default tunnel zone — used when neither the server response nor the state file specifies one. */
export const PROD_ZONE = "inkboxwire.com";

export interface ConnectOptions {
  /** Tunnel name (server-side `tunnel_name`). 3-63 chars, lowercase a-z / 0-9 / hyphens. */
  name: string;
  /**
   * URL to forward inbound traffic to. The TS SDK only supports URL
   * forwarding in v1 (no in-process ASGI equivalent on Node).
   */
  forwardTo: string;
  /** Expert-only override for the data-plane h2 endpoint. */
  dataPlaneZone?: string;
  /** `"edge"` (default) or `"passthrough"`. */
  tlsMode?: TLSMode | "edge" | "passthrough";
  /** Where state.json (and passthrough key/cert) live. Defaults to `~/.inkbox/tunnels/{name}`. */
  stateDir?: string;
  /** Free-form description, recorded server-side at create time. */
  description?: string;
  /** 1-32; omit to let the server decide. */
  poolSize?: number;
  /** Explicit override; wins over the state file (recovery from rotateSecret). */
  secret?: string;
  /** Status transitions. */
  onStatus?: TunnelStatusCallback;
  /** `"auto_restore"` (default) or `"error"`. */
  onPendingRemoval?: "auto_restore" | "error";
  /** Cap on materialized inbound bodies. */
  maxInboundBodyBytes?: number;
  /** Cap on materialized outbound bodies. */
  maxOutboundBodyBytes?: number;
  /** Bypass the loopback-only allowlist for `forwardTo`. */
  allowRemoteForwarding?: boolean;
  /** TTY-gated by default. */
  printSecretToStderr?: boolean | null;
}

function validatePoolSize(poolSize: number | undefined): void {
  if (poolSize === undefined) return;
  if (!Number.isInteger(poolSize) || poolSize < POOL_SIZE_MIN || poolSize > POOL_SIZE_MAX) {
    throw new RangeError(
      `poolSize must be an integer in [${POOL_SIZE_MIN}, ${POOL_SIZE_MAX}] (got ${poolSize})`,
    );
  }
}

function resolveZoneAndHost(opts: {
  name: string;
  serverZone: string | null;
  serverPublicHost: string | null;
  state: { zone?: string | null; publicHost?: string | null } | null;
  dataPlaneZoneOverride: string | null;
}): { zone: string; publicHost: string } {
  const publicHost = opts.serverPublicHost
    ?? opts.state?.publicHost
    ?? `${opts.name}.${PROD_ZONE}`;
  const zone = opts.dataPlaneZoneOverride
    ?? opts.serverZone
    ?? opts.state?.zone
    ?? PROD_ZONE;
  return { zone, publicHost };
}

const _RUNTIME_GAP_MESSAGE =
  "The TypeScript tunnels data-plane runtime is not yet implemented. " +
  "connect() refuses upfront without creating or restoring a tunnel, " +
  "persisting a secret, or making any other control-plane write. Use " +
  "the Python SDK's inkbox.tunnels.connect() in the meantime; the " +
  "TypeScript control-plane CRUD surface (inkbox.tunnels.list/get/" +
  "create/...) remains available.";

/**
 * Raised by `connect()` until the data-plane runtime ships, to make sure
 * we never create / restore tunnels or persist secrets for a runtime
 * that will never start.
 */
export class TunnelRuntimeNotImplemented extends Error {
  constructor() {
    super(_RUNTIME_GAP_MESSAGE);
    this.name = "TunnelRuntimeNotImplemented";
  }
}

/**
 * Bring a tunnel online from this Node process.
 *
 * v1 supports URL forwarding only (no in-process Express/Fastify
 * dispatch). The data-plane runtime is not yet implemented in the
 * TypeScript SDK; see the module docstring for context.
 */
export async function connect(
  inkbox: Inkbox,
  options: ConnectOptions,
): Promise<TunnelListener> {
  // --- Parameter validation (cheap, runs even if runtime gap fires) ---
  validateTunnelName(options.name);
  validatePoolSize(options.poolSize);
  validateForwardTarget(options.forwardTo, {
    allowRemoteForwarding: options.allowRemoteForwarding,
  });

  // The data-plane runtime is not yet implemented. Refuse before
  // doing anything that mutates server state or disk: a tunnel created
  // (or restored) for a runtime that will never start is silent
  // corruption of the control plane.
  // Touch a few options so unused-locals lint stays quiet while the
  // body remains a stub.
  void inkbox;
  void options.tlsMode;
  void options.onPendingRemoval;
  void options.stateDir;
  void options.dataPlaneZone;
  void options.secret;
  void options.maxInboundBodyBytes;
  void options.maxOutboundBodyBytes;
  void options.printSecretToStderr;
  void options.onStatus;
  void options.description;
  void validateEnvelopePath;
  throw new TunnelRuntimeNotImplemented();
}

// The control-plane bootstrap is preserved here as `_unimplementedBootstrap`
// so the TS port lands quickly when the data-plane runtime ships — but
// it MUST NOT run today. Re-enabling it is gated on the runtime existing.
async function _unimplementedBootstrap(
  inkbox: Inkbox,
  options: ConnectOptions,
): Promise<TunnelListener> {
  const tlsMode: TLSMode =
    (typeof options.tlsMode === "string" ? options.tlsMode : options.tlsMode) as TLSMode
    ?? TLSMode.EDGE;
  const onPendingRemoval = options.onPendingRemoval ?? "auto_restore";
  const stateDirPath = options.stateDir ?? defaultStateDir(options.name);

  // --- Bootstrap (control plane) ---
  ensurePrivateStateDir(stateDirPath);
  const state = loadState(stateDirPath);

  let secret: string | null = options.secret ?? state?.secret ?? null;

  let tunnel: Tunnel | null = null;
  if (state?.tunnelId) {
    try {
      tunnel = await inkbox.tunnels.get(state.tunnelId);
    } catch (err: unknown) {
      const apiErr = err as { statusCode?: number };
      if (apiErr?.statusCode === 404) {
        throw new TunnelRemoved(
          `tunnel ${options.name} (id=${state.tunnelId}) has been removed; ` +
            `clear ${stateDirPath} and call inkbox.tunnels.create() to start fresh`,
        );
      }
      throw err;
    }
  }
  if (!tunnel) {
    const list = await inkbox.tunnels.list();
    tunnel = list.find((t) => t.tunnelName === options.name) ?? null;
  }
  if (!tunnel) {
    const created = await inkbox.tunnels.create({
      tunnelName: options.name,
      tlsMode,
      description: options.description,
    });
    tunnel = created.tunnel;
    secret = created.connectSecret;
    saveState(stateDirPath, {
      tunnelId: tunnel.id,
      name: options.name,
      secret,
      mode: tlsMode,
      zone: tunnel.zone,
      publicHost: tunnel.publicHost,
    });
    printSecretOnce({
      secret,
      statePath: `${stateDirPath}/state.json`,
      printToStderr: options.printSecretToStderr ?? null,
    });
  } else {
    if (tunnel.tlsMode !== tlsMode) {
      throw new TunnelStateConflict(
        409,
        `tls_mode mismatch: requested ${tlsMode} but tunnel reports ` +
          `${tunnel.tlsMode}. tls_mode is fixed at creation; delete the ` +
          "tunnel and recreate to change it.",
      );
    }
    if (tunnel.status === TunnelStatus.PENDING_REMOVAL) {
      if (onPendingRemoval === "error") {
        throw new TunnelStateConflict(
          409,
          `tunnel ${options.name} is in pending_removal; pass ` +
            "onPendingRemoval: 'auto_restore' to bring it back",
        );
      }
      if (!secret) {
        throw new TunnelSecretUnavailable(
          `connect_secret not available locally for tunnel ${options.name}; ` +
            "pass secret explicitly, or rotate via inkbox.tunnels.rotateSecret(id) " +
            "first. Refusing to call restore until the secret is proven.",
        );
      }
      tunnel = await inkbox.tunnels.restore(tunnel.id);
    }
    if (!secret) {
      throw new TunnelSecretUnavailable(
        `connect_secret not available locally for tunnel ${options.name}; ` +
          "pass secret explicitly, or rotate via inkbox.tunnels.rotateSecret(id) first.",
      );
    }
  }

  if (tunnel.tlsMode === TLSMode.PASSTHROUGH) {
    // Passthrough requires CSR + sign + the data-plane runtime, which
    // is not yet implemented in the TypeScript SDK. Surface that
    // explicitly so users don't get a confusing partial-success.
    throw new Error(
      "passthrough mode is not yet supported in the TypeScript SDK; " +
        _RUNTIME_GAP_MESSAGE,
    );
  }

  const { zone, publicHost } = resolveZoneAndHost({
    name: options.name,
    serverZone: tunnel.zone,
    serverPublicHost: tunnel.publicHost,
    state,
    dataPlaneZoneOverride: options.dataPlaneZone ?? null,
  });

  saveState(stateDirPath, {
    tunnelId: tunnel.id,
    name: options.name,
    secret,
    mode: tunnel.tlsMode,
    zone,
    publicHost,
  });

  // Path-validation helper exposed for users that want to mirror the
  // SDK's algorithm in their own dispatch path; not used here yet.
  void validateEnvelopePath;

  // Runtime is not yet implemented. The public connect() throws before
  // reaching this point; this dead return keeps the bootstrap code
  // type-checked so the port can light it up when the runtime ships.
  void publicHost;
  void zone;
  throw new TunnelRuntimeNotImplemented();
}

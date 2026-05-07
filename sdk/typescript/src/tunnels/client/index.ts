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
import {
  TunnelListenerImpl,
  type TunnelListener,
  type TunnelListenerOpts,
  type TunnelStatusCallback,
} from "./_listener.js";
import {
  DEFAULT_INBOUND_BODY_BYTES,
  DEFAULT_OUTBOUND_BODY_BYTES,
  TunnelRuntime,
} from "./_runtime.js";
import type { InkboxHandler } from "./_handler.js";
import type { InkboxWsHandler } from "./_ws.js";

export type { TunnelListener, TunnelStatusCallback } from "./_listener.js";
export {
  ForwardTargetRefused,
  validateEnvelopePath,
  validateForwardTarget,
} from "./_validation.js";
export type { InkboxHandler, InkboxRequestContext } from "./_handler.js";
export type {
  InkboxWebSocket,
  InkboxWebSocketAcceptOpts,
  InkboxWsHandler,
} from "./_ws.js";
export {
  WsAcceptDeadlineExceeded,
  WsClosed,
  WsProtocolMismatch,
} from "./_ws.js";
export { TunnelAuthError } from "./_runtime.js";

/** Default tunnel zone — used when neither the server nor the state file specifies one. */
export const PROD_ZONE = "inkboxwire.com";

/**
 * Raised by `connect()` when the supplied dispatch options are
 * invalid — for example, both `forwardTo` and `handler` set, or
 * `wsHandler` set without an HTTP path.
 *
 * Validation runs synchronously before any control-plane writes: a
 * tunnel is never created or restored for an invalid configuration.
 */
export class InvalidConnectOptions extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConnectOptions";
  }
}

export interface ConnectOptions {
  /** Tunnel name (server-side `tunnel_name`). */
  name: string;
  /** URL forward path: forward inbound HTTP traffic to a local URL. */
  forwardTo?: string;
  /** In-process Fetch-API HTTP handler. Mutually exclusive with `forwardTo`. */
  handler?: InkboxHandler;
  /** In-process WS handler. Optional alongside an HTTP path. */
  wsHandler?: InkboxWsHandler;
  /** Expert-only override for the data-plane h2 endpoint. */
  dataPlaneZone?: string;
  /** `"edge"` (default) or `"passthrough"`. */
  tlsMode?: TLSMode | "edge" | "passthrough";
  /** Where state.json (and passthrough key/cert) live. */
  stateDir?: string;
  /** Free-form description, recorded server-side at create time. */
  description?: string;
  /** 1-32; omit to let the server decide. */
  poolSize?: number;
  /** Explicit override; wins over the state file. */
  secret?: string;
  /** Status transitions. */
  onStatus?: TunnelStatusCallback;
  /** `"auto_restore"` (default) or `"error"`. */
  onPendingRemoval?: "auto_restore" | "error";
  /** Cap on materialized inbound bodies. */
  maxInboundBodyBytes?: number;
  /**
   * Cap on materialized outbound (response) bodies. Threaded into both
   * the URL-forward and in-process-handler paths as the same value;
   * different names imply different policies and confuse users.
   */
  maxResponseBytes?: number;
  /** Bypass the loopback-only allowlist for `forwardTo`. */
  allowRemoteForwarding?: boolean;
  /** TTY-gated by default. */
  printSecretToStderr?: boolean | null;
  /** Signal-handler installation policy. */
  installSignalHandlers?: boolean;
  /**
   * Default `true`. When `false`, passthrough advertises only
   * `http/1.1` in ALPN — the h1 parser still handles inbound traffic
   * uniformly (caps, validation, header injection). This is an
   * ALPN-only escape hatch; the raw byte-pipe is gone.
   */
  enableH2Transcode?: boolean;
  /**
   * Verify the upstream's TLS certificate when `forwardTo` is `https://`.
   * Default `true`. Set `false` for self-signed dev certs on loopback;
   * pair with `forwardToCaBundle` for private CAs.
   */
  forwardToVerifyTls?: boolean;
  /**
   * Extra CA certificate(s) (PEM) to trust when verifying the upstream
   * TLS certificate. Mutually exclusive with `forwardToVerifyTls=false`
   * for sanity.
   */
  forwardToCaBundle?: Buffer | string;
}

function validatePoolSize(poolSize: number | undefined): void {
  if (poolSize === undefined) return;
  if (
    !Number.isInteger(poolSize) ||
    poolSize < POOL_SIZE_MIN ||
    poolSize > POOL_SIZE_MAX
  ) {
    throw new RangeError(
      `poolSize must be an integer in [${POOL_SIZE_MIN}, ${POOL_SIZE_MAX}] (got ${poolSize})`,
    );
  }
}

/**
 * Validate the `connect()` dispatch matrix synchronously, before any
 * control-plane writes. The runtime never has to handle the ambiguous
 * combinations because they can't reach it.
 */
function validateDispatchOptions(opts: ConnectOptions): void {
  const hasForward = opts.forwardTo !== undefined;
  const hasHandler = opts.handler !== undefined;
  const hasWs = opts.wsHandler !== undefined;
  if (hasForward && hasHandler) {
    throw new InvalidConnectOptions(
      "ambiguous HTTP path: both forwardTo and handler are set; pick one.",
    );
  }
  if (!hasForward && !hasHandler && !hasWs) {
    throw new InvalidConnectOptions(
      "no dispatch path configured: pass forwardTo, handler, or wsHandler.",
    );
  }
  if (!hasForward && !hasHandler && hasWs) {
    throw new InvalidConnectOptions(
      "wsHandler set without an HTTP path: pass forwardTo or handler too.",
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
  const publicHost =
    opts.serverPublicHost ?? opts.state?.publicHost ?? `${opts.name}.${PROD_ZONE}`;
  const zone =
    opts.dataPlaneZoneOverride ??
    opts.serverZone ??
    opts.state?.zone ??
    PROD_ZONE;
  return { zone, publicHost };
}

/**
 * Bring a tunnel online from this Node process.
 */
export async function connect(
  inkbox: Inkbox,
  options: ConnectOptions,
): Promise<TunnelListener> {
  // --- Synchronous validation (cheap; runs before any disk or server I/O) ---
  validateTunnelName(options.name);
  validatePoolSize(options.poolSize);
  validateDispatchOptions(options);
  if (options.forwardTo !== undefined) {
    validateForwardTarget(options.forwardTo, {
      allowRemoteForwarding: options.allowRemoteForwarding,
    });
  }

  const tlsMode: TLSMode =
    (typeof options.tlsMode === "string"
      ? (options.tlsMode as TLSMode)
      : options.tlsMode) ?? TLSMode.EDGE;

  // Passthrough accepts both http:// and https:// forwardTo URLs.
  // UpstreamUrlDispatch builds undici's tls.connect options from
  // forwardToVerifyTls / forwardToCaBundle for https:// upstreams.
  const onPendingRemoval = options.onPendingRemoval ?? "auto_restore";
  const stateDirPath = options.stateDir ?? defaultStateDir(options.name);

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
        `tls_mode mismatch: requested ${tlsMode} but tunnel reports ${tunnel.tlsMode}. ` +
          "tls_mode is fixed at creation; delete the tunnel and recreate to change it.",
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
            "pass secret explicitly, or rotate via inkbox.tunnels.rotateSecret(id) first.",
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

  // For passthrough, lazy-load _cert.ts so the edge-mode bundle stays
  // clean of @peculiar/x509. The dynamic import keeps the dep out of
  // the static module graph for edge users; M5 bundle verification is
  // the forcing function.
  let tlsTerminator: import("./_tls.js").TlsTerminator | null = null;
  if (tunnel.tlsMode === TLSMode.PASSTHROUGH) {
    // Passthrough accepts either ``forwardTo`` (URL) or ``handler``
    // (Fetch-style callable). The runtime constructs UpstreamUrlDispatch
    // or CallableDispatch accordingly.
    const cert = await import("./_cert.js");
    const tls = await import("./_tls.js");
    const keypair = await cert.loadOrCreateKeypair(stateDirPath);
    const tunnelPublicHost =
      tunnel.publicHost ?? `${options.name}.${PROD_ZONE}`;
    if (await cert.certNeedsSign(stateDirPath, keypair)) {
      const csrPem = await cert.buildCsr(keypair, tunnelPublicHost);
      const signed = await inkbox.tunnels.signCsr(tunnel.id, { csrPem });
      cert.writeCertChain(stateDirPath, signed.certPem, signed.chainPem);
    }
    const certPath = `${stateDirPath}/cert_chain.pem`;
    const certChainPem = await import("node:fs").then((fs) =>
      fs.promises.readFile(certPath),
    );
    const keyPem = await cert.keyPemBytes(keypair);
    // ALPN advertised in passthrough. enableH2Transcode=true (default)
    // advertises h2 + http/1.1; the runtime selects the h1 parser or
    // h2 transcoder per-connection by negotiated ALPN. Setting it
    // false is the ALPN-only escape hatch — h1 parser still services
    // inbound traffic, but h2 is never offered.
    const enableH2 = options.enableH2Transcode !== false;
    const alpnProtocols = enableH2
      ? ["h2", "http/1.1"]
      : ["http/1.1"];
    tlsTerminator = new tls.TlsTerminator({
      certChainPem,
      keyPem,
      alpnProtocols,
    });
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

  const runtime = new TunnelRuntime({
    tunnelId: tunnel.id,
    secret,
    zone,
    publicHost,
    poolSize: options.poolSize ?? null,
    dispatch: {
      forwardTo: options.forwardTo,
      httpHandler: options.handler,
      wsHandler: options.wsHandler,
    },
    tlsTerminator: tlsTerminator ?? undefined,
    maxInboundBodyBytes: options.maxInboundBodyBytes ?? DEFAULT_INBOUND_BODY_BYTES,
    maxResponseBytes: options.maxResponseBytes ?? DEFAULT_OUTBOUND_BODY_BYTES,
    allowRemoteForwarding: options.allowRemoteForwarding,
    forwardToVerifyTls: options.forwardToVerifyTls,
    forwardToCaBundle: options.forwardToCaBundle,
    onStatus: options.onStatus,
  });

  const listenerOpts: TunnelListenerOpts = {
    installSignalHandlers: options.installSignalHandlers,
  };
  return new TunnelListenerImpl({
    publicHost,
    tunnel,
    runtime,
    listenerOpts,
  });
}

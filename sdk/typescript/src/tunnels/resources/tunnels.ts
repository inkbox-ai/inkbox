/**
 * inkbox-tunnels/resources/tunnels.ts
 *
 * Control-plane CRUD for tunnels. Wraps `/api/v1/tunnels/*`.
 */

import { HttpTransport, InkboxAPIError } from "../../_http.js";
import { validateTunnelName } from "../_validation.js";
import {
  TunnelCSRStateConflict,
  TunnelNameUnavailable,
  TunnelStateConflict,
  TunnelTLSModeMismatch,
} from "../exceptions.js";
import {
  CreatedTunnel,
  RawCreatedTunnel,
  RawRotatedSecret,
  RawSignedCert,
  RawTunnel,
  RotatedSecret,
  SignedCert,
  TLSMode,
  Tunnel,
  parseCreatedTunnel,
  parseRotatedSecret,
  parseSignedCert,
  parseTunnel,
} from "../types.js";

const BASE = "/tunnels";

const SIGN_CSR_TIMEOUT_MS = 180_000;

export const POOL_SIZE_MIN = 1;
export const POOL_SIZE_MAX = 32;

function detailText(detail: unknown): string {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const inner = (detail as Record<string, unknown>).detail;
    if (typeof inner === "string") return inner;
  }
  return String(detail);
}

function mapCreateError(err: InkboxAPIError): Error {
  if (err.statusCode === 409) {
    return new TunnelNameUnavailable(err.statusCode, err.detail);
  }
  return err;
}

function mapStateError(err: InkboxAPIError): Error {
  if (err.statusCode === 409) {
    return new TunnelStateConflict(err.statusCode, err.detail);
  }
  return err;
}

function mapSignCsrError(err: InkboxAPIError): Error {
  if (err.statusCode !== 409) return err;
  const text = detailText(err.detail).toLowerCase();
  if (text.includes("edge") || text.includes("tls_mode") || text.includes("passthrough")) {
    return new TunnelTLSModeMismatch(err.statusCode, err.detail);
  }
  return new TunnelCSRStateConflict(err.statusCode, err.detail);
}

export interface CreateTunnelOptions {
  tunnelName: string;
  tlsMode?: TLSMode | "edge" | "passthrough";
  description?: string | null;
}

export interface UpdateTunnelOptions {
  /** Pass `null` to clear; omit to leave unchanged. */
  description?: string | null;
  /**
   * Pass `{}` or `null` to clear (the server's column is non-nullable
   * and collapses both forms to `{}`); omit to leave unchanged.
   */
  metadata?: Record<string, unknown> | null;
}

export class TunnelsResource {
  constructor(private readonly http: HttpTransport) {}

  // --- Reads -----------------------------------------------------------

  async list(): Promise<Tunnel[]> {
    const data = await this.http.get<{ tunnels: RawTunnel[] } | RawTunnel[]>(
      `${BASE}/`,
    );
    const items = Array.isArray(data) ? data : data.tunnels;
    return items.map(parseTunnel);
  }

  async get(tunnelId: string): Promise<Tunnel> {
    const data = await this.http.get<RawTunnel>(`${BASE}/${tunnelId}`);
    return parseTunnel(data);
  }

  // --- Writes ----------------------------------------------------------

  /**
   * Create a new tunnel. Persist the returned `connectSecret` immediately —
   * it is shown ONCE.
   */
  async create(options: CreateTunnelOptions): Promise<CreatedTunnel> {
    validateTunnelName(options.tunnelName);
    const body: Record<string, unknown> = {
      tunnel_name: options.tunnelName,
      tls_mode: options.tlsMode ?? TLSMode.EDGE,
    };
    if (options.description !== undefined && options.description !== null) {
      body.description = options.description;
    }
    try {
      const data = await this.http.post<RawCreatedTunnel>(`${BASE}/`, body);
      return parseCreatedTunnel(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapCreateError(err);
      throw err;
    }
  }

  /**
   * Update a tunnel. Pass only the fields you want to change.
   *
   * - `description: null` clears the description.
   * - `metadata: {}` clears metadata. `metadata` cannot be `null`
   *   (rejected client-side); pass `{}` to clear.
   */
  async update(tunnelId: string, options: UpdateTunnelOptions): Promise<Tunnel> {
    const body: Record<string, unknown> = {};
    if ("description" in options) {
      body.description = options.description;
    }
    if ("metadata" in options) {
      const m = options.metadata;
      if (m !== null && m !== undefined) {
        if (typeof m !== "object" || Array.isArray(m)) {
          throw new Error("metadata must be a plain object or null");
        }
      }
      body.metadata = m ?? null;
    }
    const data = await this.http.patch<RawTunnel>(`${BASE}/${tunnelId}`, body);
    return parseTunnel(data);
  }

  /**
   * Schedule a tunnel for removal. The name is held for 24 hours, during
   * which `restore` brings it back online.
   */
  async delete(tunnelId: string): Promise<Tunnel> {
    const data = await this.http.deleteWithResponse<RawTunnel>(
      `${BASE}/${tunnelId}`,
    );
    return parseTunnel(data);
  }

  /** Bring a scheduled-for-removal tunnel back online. */
  async restore(tunnelId: string): Promise<Tunnel> {
    try {
      const data = await this.http.post<RawTunnel>(`${BASE}/${tunnelId}/restore`);
      return parseTunnel(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapStateError(err);
      throw err;
    }
  }

  /**
   * Remove a scheduled-for-removal tunnel immediately, skipping the 24-hour
   * window. Requires an admin-scoped API key.
   */
  async forceDelete(tunnelId: string): Promise<Tunnel> {
    try {
      const data = await this.http.deleteWithResponse<RawTunnel>(
        `${BASE}/${tunnelId}/force`,
      );
      return parseTunnel(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapStateError(err);
      throw err;
    }
  }

  /**
   * Rotate the per-tunnel connect secret.
   *
   * The new secret takes effect on the next agent reconnect; existing live
   * connections continue serving traffic with the old secret until they
   * reconnect.
   */
  async rotateSecret(tunnelId: string): Promise<RotatedSecret> {
    const data = await this.http.post<RawRotatedSecret>(
      `${BASE}/${tunnelId}/rotate-secret`,
    );
    return parseRotatedSecret(data);
  }

  /**
   * Sign a CSR for a passthrough tunnel.
   *
   * The server performs DNS validation and cert issuance synchronously
   * inside this request, which can take up to a few minutes. This call
   * uses an elevated 180-second timeout to accommodate that.
   */
  async signCsr(tunnelId: string, options: { csrPem: string }): Promise<SignedCert> {
    try {
      const data = await this.http.post<RawSignedCert>(
        `${BASE}/${tunnelId}/sign-csr`,
        { csr_pem: options.csrPem },
        { timeoutMs: SIGN_CSR_TIMEOUT_MS },
      );
      return parseSignedCert(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapSignCsrError(err);
      throw err;
    }
  }
}

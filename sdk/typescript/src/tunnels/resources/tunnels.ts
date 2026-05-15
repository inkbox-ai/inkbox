/**
 * inkbox-tunnels/resources/tunnels.ts
 *
 * Control-plane reads + update + sign-csr for tunnels. Tunnels are
 * created and deleted exclusively via identity-create / identity-delete
 * cascades; there is no standalone create / delete / restore /
 * force-delete / rotate-secret surface.
 */

import { HttpTransport, InkboxAPIError } from "../../_http.js";
import {
  TunnelCSRStateConflict,
  TunnelTLSModeMismatch,
} from "../exceptions.js";
import {
  RawSignedCert,
  RawTunnel,
  SignedCert,
  Tunnel,
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

function mapSignCsrError(err: InkboxAPIError): Error {
  if (err.statusCode !== 409) return err;
  const text = detailText(err.detail).toLowerCase();
  if (text.includes("edge") || text.includes("tls_mode") || text.includes("passthrough")) {
    return new TunnelTLSModeMismatch(err.statusCode, err.detail);
  }
  return new TunnelCSRStateConflict(err.statusCode, err.detail);
}

export interface UpdateTunnelOptions {
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
   * Update a tunnel's metadata. `metadata` is the only mutable field;
   * other tunnel attributes are derived from the owning identity.
   *
   * - `metadata: {}` (or `null`) clears the metadata bag. The server
   *   column is non-nullable and collapses both forms to `{}`.
   */
  async update(tunnelId: string, options: UpdateTunnelOptions): Promise<Tunnel> {
    const body: Record<string, unknown> = {};
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


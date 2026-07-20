/**
 * inkbox-tunnels/types.ts
 *
 * Resource models for the Tunnels SDK surface.
 */

export enum TLSMode {
  EDGE = "edge",
  PASSTHROUGH = "passthrough",
}

/**
 * Lifecycle state of a tunnel.
 *
 * - `awaiting_cert`: passthrough-only intermediate state. Inbound TLS
 *   will fail until you call `tunnels.signCsr(...)`.
 * - `active`: routable end-to-end.
 * - `deleted`: the tunnel is no longer active.
 */
export enum TunnelStatus {
  AWAITING_CERT = "awaiting_cert",
  ACTIVE = "active",
  DELETED = "deleted",
}

export interface Tunnel {
  id: string;
  /** `null` when the response omits it. */
  organizationId: string | null;
  tunnelName: string;
  /** Owning identity id, or `null` when ownership information is unavailable. */
  agentIdentityId: string | null;
  tlsMode: TLSMode;
  certPem: string | null;
  certFingerprintSha256: string | null;
  certExpiresAt: Date | null;
  /**
   * One of the known {@link TunnelStatus} values, or — if the server
   * returns a status the SDK doesn't recognize — the raw string. Future
   * statuses survive parsing without fail-open coercion; callers should
   * handle a `string` default branch alongside the enum cases.
   */
  status: TunnelStatus | string;
  lastConnectedAt: Date | null;
  lastConnectedIpAddr: string | null;
  /** `null` when connection state was not reported. A failed lookup does not establish current state. */
  currentlyConnected: boolean | null;
  /** Customer-facing hostname. */
  publicHost: string;
  /** Tunnel zone hostname. */
  zone: string;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SignedCert {
  certPem: string;
  chainPem: string;
  certFingerprintSha256: string;
  certExpiresAt: Date;
}

// Fields the server may omit on identity-embedded tunnels (which can be
// slimmed to durable config) are optional here.
export interface RawTunnel {
  id: string;
  organization_id?: string | null;
  tunnel_name: string;
  agent_identity_id?: string | null;
  tls_mode: string;
  cert_pem?: string | null;
  cert_fingerprint_sha256?: string | null;
  cert_expires_at?: string | null;
  status: string;
  last_connected_at?: string | null;
  last_connected_ip_addr?: string | null;
  currently_connected?: boolean | null;
  public_host: string;
  zone: string;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RawSignedCert {
  cert_pem: string;
  chain_pem: string;
  cert_fingerprint_sha256: string;
  cert_expires_at: string;
}

function parseDate(v: string | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  return new Date(v);
}

export function parseTunnel(raw: RawTunnel): Tunnel {
  if (typeof raw.public_host !== "string" || raw.public_host === "") {
    throw new Error("tunnel response missing required field 'public_host'");
  }
  if (typeof raw.zone !== "string" || raw.zone === "") {
    throw new Error("tunnel response missing required field 'zone'");
  }
  return {
    id: String(raw.id),
    organizationId: raw.organization_id == null ? null : String(raw.organization_id),
    tunnelName: String(raw.tunnel_name),
    agentIdentityId: raw.agent_identity_id ?? null,
    tlsMode: raw.tls_mode as TLSMode,
    certPem: raw.cert_pem ?? null,
    certFingerprintSha256: raw.cert_fingerprint_sha256 ?? null,
    certExpiresAt: parseDate(raw.cert_expires_at),
    status: raw.status,
    lastConnectedAt: parseDate(raw.last_connected_at),
    lastConnectedIpAddr: raw.last_connected_ip_addr ?? null,
    currentlyConnected: raw.currently_connected == null ? null : Boolean(raw.currently_connected),
    publicHost: raw.public_host,
    zone: raw.zone,
    metadata:
      raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {},
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

/**
 * Summary of a tunnel embedded in identity payloads.
 *
 * Carries the routing and lifecycle facts identity views need, plus the ids
 * to reach the full tunnel. Excludes runtime state (`currentlyConnected`)
 * and cert material. Fetch the full {@link Tunnel} via `tunnels.get(...)`
 * for those fields.
 */
export interface TunnelSummary {
  id: string;
  tunnelName: string;
  /** Owning identity id, or `null` when ownership information is unavailable. */
  agentIdentityId: string | null;
  tlsMode: TLSMode;
  /** Same unknown-value contract as {@link Tunnel.status}. */
  status: TunnelStatus | string;
  publicHost: string;
  zone: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface RawTunnelSummary {
  id: string;
  tunnel_name: string;
  agent_identity_id?: string | null;
  tls_mode: string;
  status: string;
  public_host: string;
  zone: string;
  created_at: string;
  updated_at: string;
}

export function parseTunnelSummary(raw: RawTunnelSummary): TunnelSummary {
  if (typeof raw.public_host !== "string" || raw.public_host === "") {
    throw new Error("tunnel summary missing required field 'public_host'");
  }
  if (typeof raw.zone !== "string" || raw.zone === "") {
    throw new Error("tunnel summary missing required field 'zone'");
  }
  return {
    id: String(raw.id),
    tunnelName: String(raw.tunnel_name),
    agentIdentityId: raw.agent_identity_id ?? null,
    tlsMode: raw.tls_mode as TLSMode,
    status: raw.status,
    publicHost: raw.public_host,
    zone: raw.zone,
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

export function parseSignedCert(raw: RawSignedCert): SignedCert {
  return {
    certPem: raw.cert_pem,
    chainPem: raw.chain_pem,
    certFingerprintSha256: raw.cert_fingerprint_sha256,
    certExpiresAt: new Date(raw.cert_expires_at),
  };
}

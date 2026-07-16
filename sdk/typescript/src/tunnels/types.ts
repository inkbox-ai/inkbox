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
 * - `deleted`: terminal. The tunnel is offline. Tunnels are deleted
 *   exclusively via the identity-delete cascade — there is no direct
 *   tunnel-delete surface.
 */
export enum TunnelStatus {
  AWAITING_CERT = "awaiting_cert",
  ACTIVE = "active",
  DELETED = "deleted",
}

export interface Tunnel {
  id: string;
  /** `null` when the server omits it (identity-embedded tunnel payloads may carry durable config only). */
  organizationId: string | null;
  tunnelName: string;
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
  /** `null` when the server didn't report liveness (never fabricated) — fetch `tunnels.get(id)` for live state. */
  currentlyConnected: boolean | null;
  /** Customer-facing hostname — e.g. `my-agent.inkboxwire.com` in production. Lower environments use a different tunnel zone. Non-null for live tunnels. */
  publicHost: string;
  /** Zone endpoint for the data-plane. Agents connect to `https://{zone}/_system/connect`. In production this is `inkboxwire.com`; lower environments use a different zone. Non-null for live tunnels. */
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

export function parseSignedCert(raw: RawSignedCert): SignedCert {
  return {
    certPem: raw.cert_pem,
    chainPem: raw.chain_pem,
    certFingerprintSha256: raw.cert_fingerprint_sha256,
    certExpiresAt: new Date(raw.cert_expires_at),
  };
}

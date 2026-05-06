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
 * - `pending_removal`: `delete` was called; the name is held for 24h
 *   during which `tunnels.restore(id)` brings it back. After 24h the
 *   tunnel is permanently removed and its name is released. Past that
 *   point a `GET` for the tunnel id returns 404; `TunnelRemoved`
 *   surfaces that condition for clients holding stale state.
 */
export enum TunnelStatus {
  AWAITING_CERT = "awaiting_cert",
  ACTIVE = "active",
  PENDING_REMOVAL = "pending_removal",
}

const STATUS_REMAP_TO_PUBLIC: Record<string, TunnelStatus> = {
  awaiting_cert: TunnelStatus.AWAITING_CERT,
  active: TunnelStatus.ACTIVE,
  delete_pending: TunnelStatus.PENDING_REMOVAL,
};

export interface Tunnel {
  id: string;
  organizationId: string;
  tunnelName: string;
  description: string | null;
  tlsMode: TLSMode;
  certPem: string | null;
  certFingerprintSha256: string | null;
  certExpiresAt: Date | null;
  status: TunnelStatus;
  lastConnectedAt: Date | null;
  lastConnectedIpAddr: string | null;
  restoreDeadlineAt: Date | null;
  currentlyConnected: boolean;
  publicHost: string | null;
  zone: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedTunnel {
  tunnel: Tunnel;
  /** Shown ONCE — persist immediately. */
  connectSecret: string;
}

export interface RotatedSecret {
  /** New secret. Takes effect on the next agent reconnect. */
  connectSecret: string;
}

export interface SignedCert {
  certPem: string;
  chainPem: string;
  certFingerprintSha256: string;
  certExpiresAt: Date;
}

export interface RawTunnel {
  id: string;
  organization_id: string;
  tunnel_name: string;
  description: string | null;
  tls_mode: string;
  cert_pem: string | null;
  cert_fingerprint_sha256: string | null;
  cert_expires_at: string | null;
  status: string;
  last_connected_at: string | null;
  last_connected_ip_addr: string | null;
  restore_deadline_at: string | null;
  currently_connected: boolean;
  public_host?: string | null;
  zone?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface RawCreatedTunnel {
  tunnel: RawTunnel;
  connect_secret: string;
}

export interface RawRotatedSecret {
  connect_secret: string;
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
  const status =
    STATUS_REMAP_TO_PUBLIC[raw.status] ?? (raw.status as TunnelStatus);
  return {
    id: String(raw.id),
    organizationId: String(raw.organization_id),
    tunnelName: String(raw.tunnel_name),
    description: raw.description ?? null,
    tlsMode: raw.tls_mode as TLSMode,
    certPem: raw.cert_pem ?? null,
    certFingerprintSha256: raw.cert_fingerprint_sha256 ?? null,
    certExpiresAt: parseDate(raw.cert_expires_at),
    status,
    lastConnectedAt: parseDate(raw.last_connected_at),
    lastConnectedIpAddr: raw.last_connected_ip_addr ?? null,
    restoreDeadlineAt: parseDate(raw.restore_deadline_at),
    currentlyConnected: Boolean(raw.currently_connected),
    publicHost: raw.public_host ?? null,
    zone: raw.zone ?? null,
    metadata:
      raw.metadata && typeof raw.metadata === "object" ? { ...raw.metadata } : {},
    createdAt: new Date(raw.created_at),
    updatedAt: new Date(raw.updated_at),
  };
}

export function parseCreatedTunnel(raw: RawCreatedTunnel): CreatedTunnel {
  return { tunnel: parseTunnel(raw.tunnel), connectSecret: raw.connect_secret };
}

export function parseRotatedSecret(raw: RawRotatedSecret): RotatedSecret {
  return { connectSecret: raw.connect_secret };
}

export function parseSignedCert(raw: RawSignedCert): SignedCert {
  return {
    certPem: raw.cert_pem,
    chainPem: raw.chain_pem,
    certFingerprintSha256: raw.cert_fingerprint_sha256,
    certExpiresAt: new Date(raw.cert_expires_at),
  };
}

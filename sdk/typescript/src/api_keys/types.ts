/**
 * inkbox-api_keys TypeScript SDK — public types.
 */

/** Lifecycle state of an API key. */
export type ApiKeyStatus = "active" | "revoked";

/** Public representation of an API key (no secret material). */
export interface ApiKey {
  /** API key identifier in `ApiKey_<uuid4>` format. */
  id: string;
  organizationId: string;
  /** Clerk user ID for humans, identity UUID for agents. */
  createdBy: string;
  /** `"human"` or `"agent"`. */
  creatorType: string;
  /**
   * UUID of the agent identity this key is scoped to, or `null` for
   * an admin (unscoped) key with full org-wide authority.
   */
  scopedIdentityId: string | null;
  label: string;
  description: string | null;
  status: ApiKeyStatus;
  /** Last 4 characters of the secret, for display. */
  last4: string;
  /** Truncated key ID prefix for display. */
  displayPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Result of {@link ApiKeysResource.create}.
 *
 * The `apiKey` secret is shown ONCE — persist it immediately; it cannot
 * be retrieved later.
 */
export interface CreatedApiKey {
  /** Full API key string (use as `X-API-Key`). */
  apiKey: string;
  /** Public metadata for the newly created key. */
  record: ApiKey;
}

// ---- raw wire shapes ----

export interface RawApiKey {
  id: string;
  organization_id: string;
  created_by: string;
  creator_type: string;
  scoped_identity_id: string | null;
  label: string;
  description: string | null;
  status: ApiKeyStatus;
  last4: string;
  display_prefix: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawCreatedApiKey {
  api_key: string;
  record: RawApiKey;
}

// ---- parsers ----

function parseDateOrNull(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

export function parseApiKey(r: RawApiKey): ApiKey {
  return {
    id: r.id,
    organizationId: r.organization_id,
    createdBy: r.created_by,
    creatorType: r.creator_type,
    scopedIdentityId: r.scoped_identity_id,
    label: r.label,
    description: r.description,
    status: r.status,
    last4: r.last4,
    displayPrefix: r.display_prefix,
    lastUsedAt: parseDateOrNull(r.last_used_at),
    expiresAt: parseDateOrNull(r.expires_at),
    revokedAt: parseDateOrNull(r.revoked_at),
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseCreatedApiKey(r: RawCreatedApiKey): CreatedApiKey {
  return { apiKey: r.api_key, record: parseApiKey(r.record) };
}

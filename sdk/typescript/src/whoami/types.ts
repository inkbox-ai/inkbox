/**
 * inkbox/whoami/types.ts
 *
 * Types for the ``GET /api/whoami`` endpoint.
 */

// ---- public interfaces (camelCase) ----

export interface WhoamiApiKeyResponse {
  authType: "api_key";
  authSubtype: string | null;
  organizationId: string | null;
  createdBy: string | null;
  creatorType: string | null;
  keyId: string | null;
  label: string | null;
  description: string | null;
  createdAt: number | null;
  lastUsedAt: number | null;
  expiresAt: number | null;
}

export interface WhoamiJwtResponse {
  authType: "jwt";
  authSubtype: string | null;
  userId: string | null;
  email: string | null;
  name: string | null;
  organizationId: string | null;
  orgRole: string | null;
  orgSlug: string | null;
}

export type WhoamiResponse = WhoamiApiKeyResponse | WhoamiJwtResponse;

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawWhoamiApiKeyResponse {
  auth_type: "api_key";
  auth_subtype: string | null;
  organization_id: string | null;
  created_by: string | null;
  creator_type: string | null;
  key_id: string | null;
  label: string | null;
  description: string | null;
  created_at: number | null;
  last_used_at: number | null;
  expires_at: number | null;
}

export interface RawWhoamiJwtResponse {
  auth_type: "jwt";
  auth_subtype: string | null;
  user_id: string | null;
  email: string | null;
  name: string | null;
  organization_id: string | null;
  org_role: string | null;
  org_slug: string | null;
}

export type RawWhoamiResponse = RawWhoamiApiKeyResponse | RawWhoamiJwtResponse;

// ---- parser ----

export function parseWhoamiResponse(r: RawWhoamiResponse): WhoamiResponse {
  if (r.auth_type === "api_key") {
    return {
      authType: r.auth_type,
      authSubtype: r.auth_subtype,
      organizationId: r.organization_id,
      createdBy: r.created_by,
      creatorType: r.creator_type,
      keyId: r.key_id,
      label: r.label,
      description: r.description,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
      expiresAt: r.expires_at,
    };
  }
  return {
    authType: r.auth_type,
    authSubtype: r.auth_subtype,
    userId: r.user_id,
    email: r.email,
    name: r.name,
    organizationId: r.organization_id,
    orgRole: r.org_role,
    orgSlug: r.org_slug,
  };
}

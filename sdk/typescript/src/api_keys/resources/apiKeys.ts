/**
 * inkbox-api_keys/resources/apiKeys.ts
 *
 * API key creation surface.
 *
 * The Inkbox server admits two auth types on `POST /api/v1/api-keys`:
 * JWT (console) and admin-scoped API keys. Admin-scoped callers may only
 * mint identity-scoped keys (`scopedIdentityId` required); attempting to
 * mint another admin-scoped key returns HTTP 403.
 */

import { HttpTransport } from "../../_http.js";
import {
  CreatedApiKey,
  RawCreatedApiKey,
  parseCreatedApiKey,
} from "../types.js";

const BASE = "/api-keys";

export interface CreateApiKeyOptions {
  /** Required human-readable name (1–255 chars). */
  label: string;
  /** Optional free-text description (≤1000 chars). */
  description?: string;
  /**
   * Scope this key to a specific agent identity (UUID string). Omit for
   * an admin (unscoped) key with full org-wide authority — only allowed
   * for JWT (console) callers.
   */
  scopedIdentityId?: string;
}

export class ApiKeysResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new API key for the caller's organization.
   *
   * Admin-scoped API key callers must pass `scopedIdentityId` — the
   * server rejects attempts to mint another admin-scoped key from an
   * admin-scoped caller with HTTP 403.
   *
   * @returns the full API key string (shown once) and its public metadata.
   */
  async create(options: CreateApiKeyOptions): Promise<CreatedApiKey> {
    const body: Record<string, unknown> = { label: options.label };
    if (options.description !== undefined) body.description = options.description;
    if (options.scopedIdentityId !== undefined) {
      body.scoped_identity_id = options.scopedIdentityId;
    }
    const data = await this.http.post<RawCreatedApiKey>(BASE, body);
    return parseCreatedApiKey(data);
  }
}

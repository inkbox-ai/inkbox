/**
 * inkbox-identities/resources/identities.ts
 *
 * Identity create / list / get / update / delete, plus phone-number
 * release. Mailbox and tunnel are provisioned atomically by `create()`
 * and removed by `delete()` (cascade); there is no standalone mailbox
 * or tunnel create / link surface.
 */

import { HttpTransport, InkboxAPIError } from "../../_http.js";
import { mapIdentityConflictError } from "../exceptions.js";
import {
  AgentIdentitySummary,
  IdentityAccess,
  IdentityMailboxCreateOptions,
  IdentityPhoneNumberCreateOptions,
  IdentityTunnelCreateOptions,
  _AgentIdentityData,
  RawAgentIdentitySummary,
  RawAgentIdentityData,
  RawIdentityAccess,
  identityMailboxCreateOptionsToWire,
  identityPhoneNumberCreateOptionsToWire,
  identityTunnelCreateOptionsToWire,
  parseAgentIdentitySummary,
  parseAgentIdentityData,
  parseIdentityAccess,
  vaultSecretIdsToWire,
} from "../types.js";

export class IdentitiesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new agent identity. Atomically provisions the identity's
   * mailbox and tunnel; both are returned nested on the response.
   *
   * @param options.agentHandle - Unique handle for this identity, globally
   *   unique across all orgs (the handle shares its namespace with tunnel
   *   names). May be passed with or without a leading `@`.
   * @param options.displayName - Human-readable identity name. Defaults
   *   server-side to `agentHandle`.
   * @param options.description - Free-form org-internal description.
   *   `null` leaves the column null; omit to defer to server default.
   * @param options.imessageEnabled - Whether the identity can be reached
   *   over the shared iMessage service. Omit to defer to the server
   *   default (`false`).
   * @param options.mailbox - Optional nested mailbox spec. Mailbox is
   *   always provisioned; this just lets the caller customize.
   * @param options.tunnel - Optional nested tunnel spec (tlsMode only).
   *   Tunnel is always provisioned; defaults to edge TLS.
   * @param options.phoneNumber - Optional phone-number provisioning payload.
   * @param options.vaultSecretIds - Optional vault secret selection to attach to the identity.
   */
  async create(options: {
    agentHandle: string;
    displayName?: string;
    description?: string | null;
    imessageEnabled?: boolean;
    mailbox?: IdentityMailboxCreateOptions;
    tunnel?: IdentityTunnelCreateOptions;
    phoneNumber?: IdentityPhoneNumberCreateOptions;
    vaultSecretIds?: string | string[] | "*" | "all";
  }): Promise<_AgentIdentityData> {
    const body: Record<string, unknown> = { agent_handle: options.agentHandle };
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
    if (options.imessageEnabled !== undefined) body["imessage_enabled"] = options.imessageEnabled;
    if (options.mailbox !== undefined) body["mailbox"] = identityMailboxCreateOptionsToWire(options.mailbox);
    if (options.tunnel !== undefined) body["tunnel"] = identityTunnelCreateOptionsToWire(options.tunnel);
    if (options.phoneNumber !== undefined) body["phone_number"] = identityPhoneNumberCreateOptionsToWire(options.phoneNumber);
    if (options.vaultSecretIds !== undefined) body["vault_secret_ids"] = vaultSecretIdsToWire(options.vaultSecretIds);
    try {
      const data = await this.http.post<RawAgentIdentityData>("/", body);
      return parseAgentIdentityData(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapIdentityConflictError(err);
      throw err;
    }
  }

  /** List all identities for your organisation. */
  async list(): Promise<AgentIdentitySummary[]> {
    const data = await this.http.get<RawAgentIdentitySummary[]>("/");
    return data.map(parseAgentIdentitySummary);
  }

  /**
   * Get an identity with its linked channels (mailbox, phone number, tunnel).
   *
   * @param agentHandle - Handle of the identity to fetch.
   */
  async get(agentHandle: string): Promise<_AgentIdentityData> {
    const data = await this.http.get<RawAgentIdentityData>(`/${agentHandle}`);
    return parseAgentIdentityData(data);
  }

  /**
   * Update an identity's handle, display name, description, iMessage
   * reachability, and/or status.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   * For `displayName` and `description`, explicit `null` clears the value
   * (sets the row column to NULL); omitting the key leaves it untouched.
   *
   * @param agentHandle - Current handle of the identity to update.
   * @param options.newHandle - New handle value.
   * @param options.displayName - New display name, or `null` to clear.
   * @param options.description - New description, or `null` to clear.
   * @param options.imessageEnabled - Toggle shared-iMessage reachability.
   * @param options.imessageFilterMode - `"whitelist"` or `"blacklist"`
   *   for iMessage contact rules (admin-only).
   * @param options.mailFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's mail contact rules (admin-only).
   * @param options.phoneFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's phone contact rules (admin-only). The server rejects this
   *   with 422 when the identity has no phone number.
   * @param options.status - `"active"` or `"paused"`. Call `delete()` to
   *   remove an identity; `"deleted"` is rejected here.
   */
  async update(
    agentHandle: string,
    options: {
      newHandle?: string;
      displayName?: string | null;
      description?: string | null;
      imessageEnabled?: boolean;
      imessageFilterMode?: "whitelist" | "blacklist";
      mailFilterMode?: "whitelist" | "blacklist";
      phoneFilterMode?: "whitelist" | "blacklist";
      status?: "active" | "paused";
    },
  ): Promise<AgentIdentitySummary> {
    const body: Record<string, unknown> = {};
    if (options.newHandle !== undefined) body["agent_handle"] = options.newHandle;
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
    if (options.imessageEnabled !== undefined) body["imessage_enabled"] = options.imessageEnabled;
    if (options.imessageFilterMode !== undefined) body["imessage_filter_mode"] = options.imessageFilterMode;
    if (options.mailFilterMode !== undefined) body["mail_filter_mode"] = options.mailFilterMode;
    if (options.phoneFilterMode !== undefined) body["phone_filter_mode"] = options.phoneFilterMode;
    if (options.status !== undefined) body["status"] = options.status;
    try {
      const data = await this.http.patch<RawAgentIdentitySummary>(`/${agentHandle}`, body);
      return parseAgentIdentitySummary(data);
    } catch (err) {
      if (err instanceof InkboxAPIError) throw mapIdentityConflictError(err);
      throw err;
    }
  }

  /**
   * Delete an identity.
   *
   * Cascades: flips the linked mailbox to `deleted`, force-finalizes the
   * linked tunnel to `deleted`, revokes any identity-scoped API keys, and
   * releases any linked phone number (vendor + local).
   *
   * @param agentHandle - Handle of the identity to delete.
   */
  async delete(agentHandle: string): Promise<void> {
    await this.http.delete(`/${agentHandle}`);
  }

  /**
   * Release the identity's phone number (vendor + local).
   *
   * Released at the carrier; the number is not available for
   * reassignment afterwards.
   *
   * @param agentHandle - Handle of the identity.
   */
  async releasePhoneNumber(agentHandle: string): Promise<void> {
    await this.http.delete(`/${agentHandle}/phone_number`);
  }

  /**
   * List who can see this identity (agent visibility).
   *
   * Returns either a single wildcard row (`viewerIdentityId === null` —
   * every active identity in the org sees it) or explicit per-viewer
   * rows. An empty list means no scoped agent can see this identity
   * (humans and admins always see it).
   *
   * Requires an admin-scoped API key; agent-scoped keys get a 403.
   *
   * @param agentHandle - Handle of the target identity.
   */
  async listAccess(agentHandle: string): Promise<IdentityAccess[]> {
    const data = await this.http.get<RawIdentityAccess[]>(`/${agentHandle}/access`);
    return data.map(parseIdentityAccess);
  }

  /**
   * Grant visibility on this identity.
   *
   * Requires an admin-scoped API key; agent-scoped keys get a 403.
   *
   * @param agentHandle - Handle of the target identity.
   * @param viewerIdentityId - UUID of the viewer identity to grant, or
   *   `null` to reset the target to the org-wide wildcard (every active
   *   identity in the org sees it).
   * @throws {RedundantContactAccessGrantError} 409 when granting a
   *   per-viewer UUID against a target that is already a wildcard.
   * @throws {InkboxAPIError} 403 if the API key is not admin-scoped; 409
   *   if the viewer is already granted; 404 if the viewer identity does
   *   not exist; 422 if the viewer is the target itself.
   */
  async grantAccess(
    agentHandle: string,
    viewerIdentityId: string | null,
  ): Promise<IdentityAccess> {
    // Deliberately NOT wrapped in mapIdentityConflictError (unlike
    // create / update): that mapper blind-converts every 409 to
    // HandleUnavailableError, which is only right when the sole
    // possible 409 is a handle collision. This route's 409s are not
    // collisions, and the wrapper would also downgrade the
    // RedundantContactAccessGrantError the transport already raised.
    const data = await this.http.post<RawIdentityAccess>(
      `/${agentHandle}/access`,
      { viewer_identity_id: viewerIdentityId },
    );
    return parseIdentityAccess(data);
  }

  /**
   * Revoke one viewer's visibility on this identity.
   *
   * Requires an admin-scoped API key; agent-scoped keys get a 403.
   *
   * @param agentHandle - Handle of the target identity.
   * @param viewerIdentityId - UUID of the viewer identity to drop. This
   *   is the viewer identity's UUID, not an access-row id.
   * @throws {InkboxAPIError} 403 if the API key is not admin-scoped; 404
   *   when there is nothing to drop.
   */
  async revokeAccess(agentHandle: string, viewerIdentityId: string): Promise<void> {
    await this.http.delete(`/${agentHandle}/access/${viewerIdentityId}`);
  }
}

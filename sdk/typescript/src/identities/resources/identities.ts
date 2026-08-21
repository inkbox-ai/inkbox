/**
 * inkbox-identities/resources/identities.ts
 *
 * Identity create / list / get / update / delete, plus phone-number
 * release. Mailbox and tunnel are provisioned atomically by `create()`
 * and removed by `delete()` (cascade); there is no standalone mailbox
 * or tunnel create / link surface.
 */

import { HttpTransport, InkboxAPIError, validateIdempotencyKey } from "../../_http.js";
import { mapIdentityConflictError } from "../exceptions.js";
import {
  AgentIdentitySummary,
  IdentityMailboxCreateOptions,
  IdentityPhoneNumberCreateOptions,
  IdentityTunnelCreateOptions,
  UpdateIdentityOptions,
  _AgentIdentityData,
  RawAgentIdentitySummary,
  RawAgentIdentityData,
  identityMailboxCreateOptionsToWire,
  identityPhoneNumberCreateOptionsToWire,
  identityTunnelCreateOptionsToWire,
  parseAgentIdentitySummary,
  parseAgentIdentityData,
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
   *   over iMessage. Omit to defer to the server
   *   default (`false`).
   * @param options.contactSharingEnabled - Whether an attached dedicated
   *   iMessage line shares the identity's name and optional avatar.
   * @param options.claimIMessageNumber - Claim a dedicated iMessage line and
   *   attach atomically. Requires `imessageEnabled: true`.
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
    contactSharingEnabled?: boolean;
    claimIMessageNumber?: true;
    mailbox?: IdentityMailboxCreateOptions;
    tunnel?: IdentityTunnelCreateOptions;
    phoneNumber?: IdentityPhoneNumberCreateOptions;
    vaultSecretIds?: string | string[] | "*" | "all";
  }): Promise<_AgentIdentityData> {
    if (options.claimIMessageNumber !== undefined && options.claimIMessageNumber !== true) {
      throw new Error("claimIMessageNumber must be true when supplied");
    }
    if (options.claimIMessageNumber === true && options.imessageEnabled !== true) {
      throw new Error("claimIMessageNumber requires imessageEnabled: true");
    }
    const body: Record<string, unknown> = { agent_handle: options.agentHandle };
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
    if (options.imessageEnabled !== undefined) body["imessage_enabled"] = options.imessageEnabled;
    if (options.contactSharingEnabled !== undefined) body["contact_sharing_enabled"] = options.contactSharingEnabled;
    if (options.claimIMessageNumber === true) {
      body["claim_imessage_number"] = true;
    }
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

  /** List identities, preserving hydrated fields when provided. */
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
   * reachability, and/or contact-rule filter modes.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   * For `displayName` and `description`, explicit `null` clears the value
   * (sets the row column to NULL); omitting the key leaves it untouched.
   *
   * @param agentHandle - Current handle of the identity to update.
   * @param options.newHandle - New handle value.
   * @param options.displayName - New display name, or `null` to clear.
   * @param options.description - New description, or `null` to clear.
   * @param options.imessageEnabled - Toggle identity-level iMessage reachability.
   * @param options.contactSharingEnabled - Toggle automatic name and optional
   *   photo sharing for an attached dedicated iMessage line.
   * @param options.imessageNumberId - Attach an owned dedicated line, or
   *   pass `null` to return to shared service.
   * @param options.claimIMessageNumber - Claim and attach a new dedicated line.
   * @param options.idempotencyKey - Stable caller-generated key required for
   *   `claimIMessageNumber`. Reuse it after an ambiguous failure.
   * @param options.imessageFilterMode - `"whitelist"` or `"blacklist"`
   *   for iMessage contact rules (admin-only).
   * @param options.mailFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's mail contact rules (admin-only).
   * @param options.phoneFilterMode - `"whitelist"` or `"blacklist"` for this
   *   identity's phone contact rules (admin-only). The server rejects this
   *   with 422 when the identity has no phone number.
   */
  async update(
    agentHandle: string,
    options: UpdateIdentityOptions,
  ): Promise<_AgentIdentityData> {
    if (options.claimIMessageNumber !== undefined && options.claimIMessageNumber !== true) {
      throw new Error("claimIMessageNumber must be true when supplied");
    }
    const hasNumberId = "imessageNumberId" in options;
    if (options.claimIMessageNumber === true && hasNumberId) {
      throw new Error("claimIMessageNumber and imessageNumberId cannot be set together");
    }
    if (
      options.imessageEnabled === false
      && (
        options.claimIMessageNumber === true
        || (hasNumberId && options.imessageNumberId !== null)
      )
    ) {
      throw new Error("iMessage number changes cannot be combined with disabling iMessage");
    }
    if (options.claimIMessageNumber === true) {
      if (options.idempotencyKey === undefined) {
        throw new Error("idempotencyKey is required with claimIMessageNumber");
      }
    }
    if (options.idempotencyKey !== undefined) {
      validateIdempotencyKey(options.idempotencyKey);
    }
    const body: Record<string, unknown> = {};
    if (options.newHandle !== undefined) body["agent_handle"] = options.newHandle;
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
    if (options.imessageEnabled !== undefined) body["imessage_enabled"] = options.imessageEnabled;
    if (options.contactSharingEnabled !== undefined) body["contact_sharing_enabled"] = options.contactSharingEnabled;
    if ("imessageNumberId" in options) body["imessage_number_id"] = options.imessageNumberId;
    if (options.claimIMessageNumber === true) {
      body["claim_imessage_number"] = true;
    }
    if (options.imessageFilterMode !== undefined) body["imessage_filter_mode"] = options.imessageFilterMode;
    if (options.mailFilterMode !== undefined) body["mail_filter_mode"] = options.mailFilterMode;
    if (options.phoneFilterMode !== undefined) body["phone_filter_mode"] = options.phoneFilterMode;
    try {
      const data = options.idempotencyKey === undefined
        ? await this.http.patch<RawAgentIdentityData>(`/${agentHandle}`, body)
        : await this.http.patch<RawAgentIdentityData>(`/${agentHandle}`, body, {
          headers: { "Idempotency-Key": options.idempotencyKey },
        });
      return parseAgentIdentityData(data);
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

}

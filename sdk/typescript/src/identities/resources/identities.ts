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
  IdentityMailboxCreateOptions,
  IdentityPhoneNumberCreateOptions,
  IdentityTunnelCreateOptions,
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
    mailbox?: IdentityMailboxCreateOptions;
    tunnel?: IdentityTunnelCreateOptions;
    phoneNumber?: IdentityPhoneNumberCreateOptions;
    vaultSecretIds?: string | string[] | "*" | "all";
  }): Promise<_AgentIdentityData> {
    const body: Record<string, unknown> = { agent_handle: options.agentHandle };
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
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
   * Update an identity's handle, display name, description, and/or status.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   * For `displayName` and `description`, explicit `null` clears the value
   * (sets the row column to NULL); omitting the key leaves it untouched.
   *
   * @param agentHandle - Current handle of the identity to update.
   * @param options.newHandle - New handle value.
   * @param options.displayName - New display name, or `null` to clear.
   * @param options.description - New description, or `null` to clear.
   * @param options.status - `"active"` or `"paused"`. Call `delete()` to
   *   remove an identity; `"deleted"` is rejected here.
   */
  async update(
    agentHandle: string,
    options: {
      newHandle?: string;
      displayName?: string | null;
      description?: string | null;
      status?: "active" | "paused";
    },
  ): Promise<AgentIdentitySummary> {
    const body: Record<string, unknown> = {};
    if (options.newHandle !== undefined) body["agent_handle"] = options.newHandle;
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
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
}

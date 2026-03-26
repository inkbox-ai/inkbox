/**
 * inkbox-identities/resources/identities.ts
 *
 * Identity CRUD and channel assignment.
 */

import { HttpTransport } from "../../_http.js";
import type { ResourceStatus } from "../types.js";
import {
  AgentIdentitySummary,
  _AgentIdentityData,
  RawAgentIdentitySummary,
  RawAgentIdentityData,
  parseAgentIdentitySummary,
  parseAgentIdentityData,
} from "../types.js";

export class IdentitiesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new agent identity with an email address.
   *
   * The server auto-creates a mailbox for the identity using the
   * `agentHandle` as the email local-part.
   *
   * @param options.agentHandle - Unique handle for this identity within your organisation
   *   (e.g. `"sales-agent"` or `"@sales-agent"`).
   * @param options.displayName - Optional human-readable name for the identity.
   *   Defaults to `agentHandle` on the server if omitted.
   */
  async create(options: { agentHandle: string; displayName?: string }): Promise<AgentIdentitySummary> {
    const body: Record<string, unknown> = { agent_handle: options.agentHandle };
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    const data = await this.http.post<RawAgentIdentitySummary>("/", body);
    return parseAgentIdentitySummary(data);
  }

  /** List all identities for your organisation. */
  async list(): Promise<AgentIdentitySummary[]> {
    const data = await this.http.get<RawAgentIdentitySummary[]>("/");
    return data.map(parseAgentIdentitySummary);
  }

  /**
   * Get an identity with its linked channels (mailbox, phone number).
   *
   * @param agentHandle - Handle of the identity to fetch.
   */
  async get(agentHandle: string): Promise<_AgentIdentityData> {
    const data = await this.http.get<RawAgentIdentityData>(`/${agentHandle}`);
    return parseAgentIdentityData(data);
  }

  /**
   * Update an identity's handle or status.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   *
   * @param agentHandle - Current handle of the identity to update.
   * @param options.newHandle - New handle value.
   * @param options.status - New lifecycle status: `"active"` or `"paused"`.
   */
  async update(
    agentHandle: string,
    options: { newHandle?: string; status?: ResourceStatus },
  ): Promise<AgentIdentitySummary> {
    const body: Record<string, unknown> = {};
    if (options.newHandle !== undefined) body["agent_handle"] = options.newHandle;
    if (options.status !== undefined) body["status"] = options.status;
    const data = await this.http.patch<RawAgentIdentitySummary>(`/${agentHandle}`, body);
    return parseAgentIdentitySummary(data);
  }

  /**
   * Delete an identity.
   *
   * Unlinks any assigned channels without deleting them.
   *
   * @param agentHandle - Handle of the identity to delete.
   */
  async delete(agentHandle: string): Promise<void> {
    await this.http.delete(`/${agentHandle}`);
  }

  /**
   * Assign a mailbox to an identity.
   *
   * @param agentHandle - Handle of the identity.
   * @param options.mailboxId - UUID of the mailbox to assign.
   */
  async assignMailbox(
    agentHandle: string,
    options: { mailboxId: string },
  ): Promise<_AgentIdentityData> {
    const data = await this.http.post<RawAgentIdentityData>(
      `/${agentHandle}/mailbox`,
      { mailbox_id: options.mailboxId },
    );
    return parseAgentIdentityData(data);
  }

  /**
   * Unlink the mailbox from an identity (does not delete the mailbox).
   *
   * @param agentHandle - Handle of the identity.
   */
  async unlinkMailbox(agentHandle: string): Promise<void> {
    await this.http.delete(`/${agentHandle}/mailbox`);
  }

  /**
   * Assign a phone number to an identity.
   *
   * @param agentHandle - Handle of the identity.
   * @param options.phoneNumberId - UUID of the phone number to assign.
   */
  async assignPhoneNumber(
    agentHandle: string,
    options: { phoneNumberId: string },
  ): Promise<_AgentIdentityData> {
    const data = await this.http.post<RawAgentIdentityData>(
      `/${agentHandle}/phone_number`,
      { phone_number_id: options.phoneNumberId },
    );
    return parseAgentIdentityData(data);
  }

  /**
   * Unlink the phone number from an identity (does not delete the number).
   *
   * @param agentHandle - Handle of the identity.
   */
  async unlinkPhoneNumber(agentHandle: string): Promise<void> {
    await this.http.delete(`/${agentHandle}/phone_number`);
  }

}

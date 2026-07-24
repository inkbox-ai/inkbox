/**
 * inkbox-phone/resources/identityContactRules.ts
 *
 * Identity-keyed phone contact rules (per-agent-identity allow/block rules
 * + org-wide list).
 *
 * Phone (voice + SMS) rules live on the **agent identity**, addressed by
 * `agentHandle`, mirroring the iMessage rule shape. The legacy per-number
 * resource (`inkbox.phoneContactRules`) is kept as a deprecated wrapper.
 *
 * The identity must have a phone number: `create` returns 422 and the
 * identity helpers guard with a require-phone check before the request.
 * Listing an identity with no number returns an empty list.
 *
 * Transport note: rides the api-root transport (`{base}/api/v1`) so it
 * addresses both `/identities/{handle}/phone-contact-rules` and the
 * org-wide `/phone/contact-rules` with full paths. It must NOT ride the
 * `/phone`-prefixed transport.
 */

import { HttpTransport } from "../../_http.js";
import {
  PhoneIdentityContactRule,
  PhoneRuleAction,
  PhoneRuleMatchType,
  RawPhoneIdentityContactRule,
  parsePhoneIdentityContactRule,
} from "../types.js";

const ORG_BASE = "/phone/contact-rules";

function rulePath(agentHandle: string, ruleId?: string): string {
  const base = `/identities/${agentHandle}/phone-contact-rules`;
  return ruleId ? `${base}/${ruleId}` : base;
}

export interface ListPhoneIdentityContactRulesOptions {
  action?: PhoneRuleAction;
  matchType?: PhoneRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreatePhoneIdentityContactRuleOptions {
  action: PhoneRuleAction;
  matchTarget: string;
  matchType?: PhoneRuleMatchType;
}

export interface UpdatePhoneIdentityContactRuleOptions {
  action: PhoneRuleAction;
}

export interface ListAllPhoneIdentityContactRulesOptions {
  agentIdentityId?: string;
  action?: PhoneRuleAction;
  matchType?: PhoneRuleMatchType;
  limit?: number;
  offset?: number;
}

/** Allow/block phone rules scoped to agent identities (voice + SMS). */
export class PhoneIdentityContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List rules for an identity. Returns an empty list when the identity
   * has no phone number.
   */
  async list(
    agentHandle: string,
    options: ListPhoneIdentityContactRulesOptions = {},
  ): Promise<PhoneIdentityContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawPhoneIdentityContactRule[] } | RawPhoneIdentityContactRule[]
    >(rulePath(agentHandle), params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parsePhoneIdentityContactRule);
  }

  async get(agentHandle: string, ruleId: string): Promise<PhoneIdentityContactRule> {
    const data = await this.http.get<RawPhoneIdentityContactRule>(
      rulePath(agentHandle, ruleId),
    );
    return parsePhoneIdentityContactRule(data);
  }

  /**
   * Create a rule for an agent identity.
   * The identity must have
   * a phone number — otherwise the server returns 422.
   *
   * @throws {DuplicateContactRuleError} 409 when a non-deleted rule with
   *   the same `(matchType, matchTarget)` already exists.
   */
  async create(
    agentHandle: string,
    options: CreatePhoneIdentityContactRuleOptions,
  ): Promise<PhoneIdentityContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType ?? PhoneRuleMatchType.EXACT_NUMBER,
      match_target: options.matchTarget,
    };
    const data = await this.http.post<RawPhoneIdentityContactRule>(
      rulePath(agentHandle),
      body,
    );
    return parsePhoneIdentityContactRule(data);
  }

  /** Update `action` (admin-only). */
  async update(
    agentHandle: string,
    ruleId: string,
    options: UpdatePhoneIdentityContactRuleOptions,
  ): Promise<PhoneIdentityContactRule> {
    const body = { action: options.action };
    const data = await this.http.patch<RawPhoneIdentityContactRule>(
      rulePath(agentHandle, ruleId),
      body,
    );
    return parsePhoneIdentityContactRule(data);
  }

  /** Delete a rule (admin-only). */
  async delete(agentHandle: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(agentHandle, ruleId));
  }

  /** Org-wide list of phone contact rules (admin-only). */
  async listAll(
    options: ListAllPhoneIdentityContactRulesOptions = {},
  ): Promise<PhoneIdentityContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.agentIdentityId !== undefined) params.agent_identity_id = options.agentIdentityId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawPhoneIdentityContactRule[] } | RawPhoneIdentityContactRule[]
    >(ORG_BASE, params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parsePhoneIdentityContactRule);
  }
}

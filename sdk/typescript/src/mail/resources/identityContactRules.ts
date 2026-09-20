/**
 * inkbox-mail/resources/identityContactRules.ts
 *
 * Identity-keyed mail contact rules (per-agent-identity allow/block rules
 * + org-wide list).
 *
 * Mail rules live on the **agent identity**, addressed by `agentHandle`,
 * mirroring the iMessage rule shape. The legacy per-mailbox resource
 * (`inkbox.mailContactRules`) is kept as a deprecated wrapper.
 *
 * Transport note: this resource rides the api-root transport
 * (`{base}/api/v1`) so it can address both the per-identity routes
 * (`/identities/{handle}/mail-contact-rules`) and the org-wide list
 * (`/mail/contact-rules`) with full paths. It must NOT ride the
 * `/mail`-prefixed transport, which would mangle the identity paths.
 */

import { HttpTransport } from "../../_http.js";
import { type RuleDirection, ruleUpdateToWire } from "../../contact_rules.js";
import {
  MailIdentityContactRule,
  MailRuleAction,
  MailRuleMatchType,
  RawMailIdentityContactRule,
  parseMailIdentityContactRule,
} from "../types.js";

const ORG_BASE = "/mail/contact-rules";

function rulePath(agentHandle: string, ruleId?: string): string {
  const base = `/identities/${agentHandle}/mail-contact-rules`;
  return ruleId ? `${base}/${ruleId}` : base;
}

export interface ListMailIdentityContactRulesOptions {
  direction?: RuleDirection;
  action?: MailRuleAction;
  matchType?: MailRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreateMailIdentityContactRuleOptions {
  direction?: RuleDirection;
  action: MailRuleAction;
  matchType: MailRuleMatchType;
  matchTarget: string;
}

export interface UpdateMailIdentityContactRuleOptions {
  action?: MailRuleAction;
  direction?: RuleDirection;
  applyTo?: "inbound" | "outbound";
}

export interface ListAllMailIdentityContactRulesOptions {
  direction?: RuleDirection;
  agentIdentityId?: string;
  action?: MailRuleAction;
  matchType?: MailRuleMatchType;
  limit?: number;
  offset?: number;
}

/** Allow/block mail rules scoped to agent identities. */
export class MailIdentityContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    agentHandle: string,
    options: ListMailIdentityContactRulesOptions = {},
  ): Promise<MailIdentityContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawMailIdentityContactRule[] } | RawMailIdentityContactRule[]
    >(rulePath(agentHandle), params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseMailIdentityContactRule);
  }

  async get(agentHandle: string, ruleId: string): Promise<MailIdentityContactRule> {
    const data = await this.http.get<RawMailIdentityContactRule>(
      rulePath(agentHandle, ruleId),
    );
    return parseMailIdentityContactRule(data);
  }

  /**
   * Create a rule for an agent identity.
   *
   * Compatible coverage may widen an existing rule and retain its ID.
   * @throws {DuplicateContactRuleError} 409 when the coverage already exists.
   */
  async create(
    agentHandle: string,
    options: CreateMailIdentityContactRuleOptions,
  ): Promise<MailIdentityContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType,
      match_target: options.matchTarget,
    };
    if (options.direction !== undefined) body.direction = options.direction;
    const data = await this.http.post<RawMailIdentityContactRule>(
      rulePath(agentHandle),
      body,
    );
    return parseMailIdentityContactRule(data);
  }

  /**
   * Update action or coverage, or atomically edit one covered side (admin-only).
   *
   * `matchType` and `matchTarget` are immutable — delete + re-create to
   * change them.
   */
  async update(
    agentHandle: string,
    ruleId: string,
    options: UpdateMailIdentityContactRuleOptions,
  ): Promise<MailIdentityContactRule> {
    const body = ruleUpdateToWire(options);
    const data = await this.http.patch<RawMailIdentityContactRule>(
      rulePath(agentHandle, ruleId),
      body,
    );
    return parseMailIdentityContactRule(data);
  }

  /** Delete a rule (admin-only). */
  async delete(agentHandle: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(agentHandle, ruleId));
  }

  /** Org-wide list of mail contact rules (admin-only). */
  async listAll(
    options: ListAllMailIdentityContactRulesOptions = {},
  ): Promise<MailIdentityContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.agentIdentityId !== undefined) params.agent_identity_id = options.agentIdentityId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawMailIdentityContactRule[] } | RawMailIdentityContactRule[]
    >(ORG_BASE, params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseMailIdentityContactRule);
  }
}

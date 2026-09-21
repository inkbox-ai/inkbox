/**
 * inkbox-imessage/resources/contactRules.ts
 *
 * Per-identity iMessage contact rules (allow/block) + org-wide list.
 *
 * Shared iMessage pool numbers are global infrastructure, so the policy
 * owner is the agent identity being reached — rules are addressed by
 * `agentHandle`, not by a phone-number id.
 */

import { HttpTransport } from "../../_http.js";
import { type RuleDirection, ruleUpdateToWire } from "../../contact_rules.js";
import {
  IMessageContactRule,
  IMessageRuleAction,
  IMessageRuleMatchType,
  RawIMessageContactRule,
  parseIMessageContactRule,
} from "../types.js";

const ORG_BASE = "/contact-rules";

function rulePath(agentHandle: string, ruleId?: string): string {
  const base = `/identities/${agentHandle}/contact-rules`;
  return ruleId ? `${base}/${ruleId}` : base;
}

export interface ListIMessageContactRulesOptions {
  direction?: RuleDirection;
  action?: IMessageRuleAction;
  matchType?: IMessageRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreateIMessageContactRuleOptions {
  direction?: RuleDirection;
  action: IMessageRuleAction;
  matchTarget: string;
  matchType?: IMessageRuleMatchType;
}

export interface UpdateIMessageContactRuleOptions {
  action?: IMessageRuleAction;
  direction?: RuleDirection;
  applyTo?: "inbound" | "outbound";
}

export interface ListAllIMessageContactRulesOptions {
  direction?: RuleDirection;
  agentIdentityId?: string;
  action?: IMessageRuleAction;
  matchType?: IMessageRuleMatchType;
  limit?: number;
  offset?: number;
}

export class IMessageContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    agentHandle: string,
    options: ListIMessageContactRulesOptions = {},
  ): Promise<IMessageContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<RawIMessageContactRule[]>(
      rulePath(agentHandle),
      params,
    );
    return data.map(parseIMessageContactRule);
  }

  async get(agentHandle: string, ruleId: string): Promise<IMessageContactRule> {
    const data = await this.http.get<RawIMessageContactRule>(
      rulePath(agentHandle, ruleId),
    );
    return parseIMessageContactRule(data);
  }

  /**
   * Create a rule with an allow/block action.
   *
   * Compatible coverage may widen an existing rule and retain its ID.
   * @throws {DuplicateContactRuleError} 409 when the coverage already exists.
   */
  async create(
    agentHandle: string,
    options: CreateIMessageContactRuleOptions,
  ): Promise<IMessageContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType ?? IMessageRuleMatchType.EXACT_NUMBER,
      match_target: options.matchTarget,
    };
    if (options.direction !== undefined) body.direction = options.direction;
    const data = await this.http.post<RawIMessageContactRule>(
      rulePath(agentHandle),
      body,
    );
    return parseIMessageContactRule(data);
  }

  /** Update action or coverage, or atomically edit one covered side (admin-only). */
  async update(
    agentHandle: string,
    ruleId: string,
    options: UpdateIMessageContactRuleOptions,
  ): Promise<IMessageContactRule> {
    const body = ruleUpdateToWire(options);
    const data = await this.http.patch<RawIMessageContactRule>(
      rulePath(agentHandle, ruleId),
      body,
    );
    return parseIMessageContactRule(data);
  }

  /** Delete a rule (admin-only). */
  async delete(agentHandle: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(agentHandle, ruleId));
  }

  /** Org-wide list of iMessage contact rules (admin-only). */
  async listAll(
    options: ListAllIMessageContactRulesOptions = {},
  ): Promise<IMessageContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.agentIdentityId !== undefined) params.agent_identity_id = options.agentIdentityId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<RawIMessageContactRule[]>(ORG_BASE, params);
    return data.map(parseIMessageContactRule);
  }
}

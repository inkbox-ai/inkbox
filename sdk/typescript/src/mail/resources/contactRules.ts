/**
 * inkbox-mail/resources/contactRules.ts
 *
 * Per-mailbox mail contact rules (allow/block) + org-wide list.
 */

import { HttpTransport } from "../../_http.js";
import {
  ContactRuleStatus,
  MailContactRule,
  MailRuleAction,
  MailRuleMatchType,
  RawMailContactRule,
  parseMailContactRule,
} from "../types.js";

const ORG_BASE = "/contact-rules";
const MAILBOXES_BASE = "/mailboxes";

function rulePath(emailAddress: string, ruleId?: string): string {
  const base = `${MAILBOXES_BASE}/${emailAddress}/contact-rules`;
  return ruleId ? `${base}/${ruleId}` : base;
}

export interface ListMailContactRulesOptions {
  action?: MailRuleAction;
  matchType?: MailRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreateMailContactRuleOptions {
  action: MailRuleAction;
  matchType: MailRuleMatchType;
  matchTarget: string;
}

export interface UpdateMailContactRuleOptions {
  action?: MailRuleAction;
  status?: ContactRuleStatus;
}

export interface ListAllMailContactRulesOptions {
  mailboxId?: string;
  action?: MailRuleAction;
  matchType?: MailRuleMatchType;
  limit?: number;
  offset?: number;
}

export class MailContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    emailAddress: string,
    options: ListMailContactRulesOptions = {},
  ): Promise<MailContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawMailContactRule[] } | RawMailContactRule[]
    >(rulePath(emailAddress), params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseMailContactRule);
  }

  async get(emailAddress: string, ruleId: string): Promise<MailContactRule> {
    const data = await this.http.get<RawMailContactRule>(
      rulePath(emailAddress, ruleId),
    );
    return parseMailContactRule(data);
  }

  async create(
    emailAddress: string,
    options: CreateMailContactRuleOptions,
  ): Promise<MailContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType,
      match_target: options.matchTarget,
    };
    const data = await this.http.post<RawMailContactRule>(
      rulePath(emailAddress),
      body,
    );
    return parseMailContactRule(data);
  }

  async update(
    emailAddress: string,
    ruleId: string,
    options: UpdateMailContactRuleOptions,
  ): Promise<MailContactRule> {
    const body: Record<string, unknown> = {};
    if (options.action !== undefined) body.action = options.action;
    if (options.status !== undefined) body.status = options.status;
    const data = await this.http.patch<RawMailContactRule>(
      rulePath(emailAddress, ruleId),
      body,
    );
    return parseMailContactRule(data);
  }

  async delete(emailAddress: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(emailAddress, ruleId));
  }

  async listAll(
    options: ListAllMailContactRulesOptions = {},
  ): Promise<MailContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.mailboxId !== undefined) params.mailbox_id = options.mailboxId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawMailContactRule[] } | RawMailContactRule[]
    >(ORG_BASE, params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseMailContactRule);
  }
}

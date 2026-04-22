/**
 * inkbox-phone/resources/contactRules.ts
 *
 * Per-number phone contact rules (allow/block) + org-wide list.
 */

import { HttpTransport } from "../../_http.js";
import { ContactRuleStatus } from "../../mail/types.js";
import {
  PhoneContactRule,
  PhoneRuleAction,
  PhoneRuleMatchType,
  RawPhoneContactRule,
  parsePhoneContactRule,
} from "../types.js";

const ORG_BASE = "/contact-rules";
const NUMBERS_BASE = "/numbers";

function rulePath(phoneNumberId: string, ruleId?: string): string {
  const base = `${NUMBERS_BASE}/${phoneNumberId}/contact-rules`;
  return ruleId ? `${base}/${ruleId}` : base;
}

export interface ListPhoneContactRulesOptions {
  action?: PhoneRuleAction;
  matchType?: PhoneRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreatePhoneContactRuleOptions {
  action: PhoneRuleAction;
  matchTarget: string;
  matchType?: PhoneRuleMatchType;
}

export interface UpdatePhoneContactRuleOptions {
  action?: PhoneRuleAction;
  status?: ContactRuleStatus;
}

export interface ListAllPhoneContactRulesOptions {
  phoneNumberId?: string;
  action?: PhoneRuleAction;
  matchType?: PhoneRuleMatchType;
  limit?: number;
  offset?: number;
}

export class PhoneContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    phoneNumberId: string,
    options: ListPhoneContactRulesOptions = {},
  ): Promise<PhoneContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawPhoneContactRule[] } | RawPhoneContactRule[]
    >(rulePath(phoneNumberId), params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parsePhoneContactRule);
  }

  async get(phoneNumberId: string, ruleId: string): Promise<PhoneContactRule> {
    const data = await this.http.get<RawPhoneContactRule>(
      rulePath(phoneNumberId, ruleId),
    );
    return parsePhoneContactRule(data);
  }

  async create(
    phoneNumberId: string,
    options: CreatePhoneContactRuleOptions,
  ): Promise<PhoneContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType ?? PhoneRuleMatchType.EXACT_NUMBER,
      match_target: options.matchTarget,
    };
    const data = await this.http.post<RawPhoneContactRule>(
      rulePath(phoneNumberId),
      body,
    );
    return parsePhoneContactRule(data);
  }

  async update(
    phoneNumberId: string,
    ruleId: string,
    options: UpdatePhoneContactRuleOptions,
  ): Promise<PhoneContactRule> {
    const body: Record<string, unknown> = {};
    if (options.action !== undefined) body.action = options.action;
    if (options.status !== undefined) body.status = options.status;
    const data = await this.http.patch<RawPhoneContactRule>(
      rulePath(phoneNumberId, ruleId),
      body,
    );
    return parsePhoneContactRule(data);
  }

  async delete(phoneNumberId: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(phoneNumberId, ruleId));
  }

  async listAll(
    options: ListAllPhoneContactRulesOptions = {},
  ): Promise<PhoneContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.phoneNumberId !== undefined) params.phone_number_id = options.phoneNumberId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<
      { items: RawPhoneContactRule[] } | RawPhoneContactRule[]
    >(ORG_BASE, params);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parsePhoneContactRule);
  }
}

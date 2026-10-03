/** Directional Slack contact and workspace rules. */
import { HttpTransport } from "./_http.js";
import { type RuleDirection, ruleUpdateToWire } from "./contact_rules.js";
import { ContactRuleStatus } from "./mail/types.js";
import { type Contact, type RawContact, parseContact } from "./contacts/types.js";

export enum SlackRuleAction { ALLOW = "allow", BLOCK = "block" }
export enum SlackRuleMatchType { EXACT_USER = "exact_user", WORKSPACE = "workspace" }
export interface SlackContactRule {
  id: string;
  agentIdentityId: string;
  action: SlackRuleAction;
  matchType: SlackRuleMatchType;
  matchTarget: string;
  direction: RuleDirection;
  status: ContactRuleStatus;
  contact: Contact | null;
  createdAt: Date;
  updatedAt: Date;
}
interface RawSlackContactRule {
  id: string; agent_identity_id: string; action: SlackRuleAction;
  match_type: SlackRuleMatchType; match_target: string; direction?: RuleDirection;
  status: ContactRuleStatus; contact?: RawContact | null;
  created_at: string; updated_at: string;
}
function parseSlackContactRule(r: RawSlackContactRule): SlackContactRule {
  return { id: r.id, agentIdentityId: r.agent_identity_id, action: r.action,
    matchType: r.match_type, matchTarget: r.match_target, direction: r.direction ?? "both",
    status: r.status, contact: r.contact == null ? null : parseContact(r.contact),
    createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at) };
}

const ORG_BASE = "/slack/contact-rules";

function rulePath(agentHandle: string, ruleId?: string): string {
  const base = `/identities/${encodeURIComponent(agentHandle)}/slack-contact-rules`;
  return ruleId ? `${base}/${encodeURIComponent(ruleId)}` : base;
}

export interface ListSlackContactRulesOptions {
  direction?: RuleDirection;
  action?: SlackRuleAction;
  matchType?: SlackRuleMatchType;
  limit?: number;
  offset?: number;
}

export interface CreateSlackContactRuleOptions {
  direction?: RuleDirection;
  action: SlackRuleAction;
  matchTarget: string;
  matchType?: SlackRuleMatchType;
}

export interface UpdateSlackContactRuleOptions {
  action?: SlackRuleAction;
  direction?: RuleDirection;
  applyTo?: "inbound" | "outbound";
}

export interface ListAllSlackContactRulesOptions {
  direction?: RuleDirection;
  agentIdentityId?: string;
  action?: SlackRuleAction;
  matchType?: SlackRuleMatchType;
  limit?: number;
  offset?: number;
}

export class SlackContactRulesResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    agentHandle: string,
    options: ListSlackContactRulesOptions = {},
  ): Promise<SlackContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<RawSlackContactRule[]>(
      rulePath(agentHandle),
      params,
    );
    return data.map(parseSlackContactRule);
  }

  async get(agentHandle: string, ruleId: string): Promise<SlackContactRule> {
    const data = await this.http.get<RawSlackContactRule>(
      rulePath(agentHandle, ruleId),
    );
    return parseSlackContactRule(data);
  }

  /**
   * Create a rule with an allow/block action.
   *
   * Compatible coverage may widen an existing rule and retain its ID.
   * @throws {DuplicateContactRuleError} 409 when the coverage already exists.
   */
  async create(
    agentHandle: string,
    options: CreateSlackContactRuleOptions,
  ): Promise<SlackContactRule> {
    const body: Record<string, unknown> = {
      action: options.action,
      match_type: options.matchType ?? SlackRuleMatchType.EXACT_USER,
      match_target: options.matchTarget,
    };
    if (options.direction !== undefined) body.direction = options.direction;
    const data = await this.http.post<RawSlackContactRule>(
      rulePath(agentHandle),
      body,
    );
    return parseSlackContactRule(data);
  }

  /** Update action or coverage, or atomically edit one covered side (admin-only). */
  async update(
    agentHandle: string,
    ruleId: string,
    options: UpdateSlackContactRuleOptions,
  ): Promise<SlackContactRule> {
    const body = ruleUpdateToWire(options);
    const data = await this.http.patch<RawSlackContactRule>(
      rulePath(agentHandle, ruleId),
      body,
    );
    return parseSlackContactRule(data);
  }

  /** Delete a rule (admin-only). */
  async delete(agentHandle: string, ruleId: string): Promise<void> {
    await this.http.delete(rulePath(agentHandle, ruleId));
  }

  /** Org-wide list of Slack contact rules (admin-only). */
  async listAll(
    options: ListAllSlackContactRulesOptions = {},
  ): Promise<SlackContactRule[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.direction !== undefined) params.direction = options.direction;
    if (options.agentIdentityId !== undefined) params.agent_identity_id = options.agentIdentityId;
    if (options.action !== undefined) params.action = options.action;
    if (options.matchType !== undefined) params.match_type = options.matchType;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<RawSlackContactRule[]>(ORG_BASE, params);
    return data.map(parseSlackContactRule);
  }
}

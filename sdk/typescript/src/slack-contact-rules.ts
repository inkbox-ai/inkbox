/** Directional Slack policy. Writes require a human JWT or organization-management key. */
import type { HttpTransport } from "./_http.js";
import { type RuleDirection, ruleUpdateToWire } from "./contact_rules.js";
import type { ContactRuleStatus } from "./mail/types.js";

export type SlackRuleAction = "allow" | "block";
export type SlackRuleMatchType = "exact_user" | "workspace";
export interface SlackContactRule {
  id: string; agentIdentityId: string; action: SlackRuleAction;
  matchType: SlackRuleMatchType; matchTarget: string; direction: RuleDirection;
  status: ContactRuleStatus; createdAt: Date; updatedAt: Date;
}
export interface SlackContactRuleSettings {
  inboundFilterMode: "blacklist" | "whitelist";
  outboundFilterMode: "blacklist" | "whitelist";
}
export interface ListSlackContactRulesOptions {
  action?: SlackRuleAction; matchType?: SlackRuleMatchType; direction?: RuleDirection;
  limit?: number; offset?: number;
}
export interface CreateSlackContactRuleOptions {
  action: SlackRuleAction; matchType: SlackRuleMatchType;
  /** Verified home workspace:user for exact_user, or workspace ID for workspace. */
  matchTarget: string; direction?: RuleDirection;
}
export interface UpdateSlackContactRuleOptions {
  action?: SlackRuleAction; direction?: RuleDirection; applyTo?: "inbound" | "outbound";
}
interface RawRule {
  id: string; agent_identity_id: string; action: SlackRuleAction;
  match_type: SlackRuleMatchType; match_target: string; direction: RuleDirection;
  status: ContactRuleStatus; created_at: string; updated_at: string;
}
interface RawSettings {
  inbound_filter_mode: SlackContactRuleSettings["inboundFilterMode"];
  outbound_filter_mode: SlackContactRuleSettings["outboundFilterMode"];
}
const parseRule = (r: RawRule): SlackContactRule => ({
  id: r.id, agentIdentityId: r.agent_identity_id, action: r.action,
  matchType: r.match_type, matchTarget: r.match_target, direction: r.direction,
  status: r.status, createdAt: new Date(r.created_at), updatedAt: new Date(r.updated_at),
});
const parseSettings = (r: RawSettings): SlackContactRuleSettings => ({
  inboundFilterMode: r.inbound_filter_mode, outboundFilterMode: r.outbound_filter_mode,
});
function path(handle: string, suffix?: string): string {
  const base = `/slack/identities/${encodeURIComponent(handle.replace(/^@/, ""))}/contact-rules`;
  return suffix === undefined ? base : `${base}/${encodeURIComponent(suffix)}`;
}
/** Rules follow the same directional edit contract as email and phone. */
export class SlackContactRulesResource {
  constructor(private readonly http: HttpTransport) {}
  /** List a page; direction filters include both-direction rules. */
  async list(handle: string, options: ListSlackContactRulesOptions = {}): Promise<SlackContactRule[]> {
    const rows = await this.http.get<RawRule[]>(path(handle), {
      action: options.action, match_type: options.matchType, direction: options.direction,
      limit: options.limit, offset: options.offset,
    });
    return rows.map(parseRule);
  }
  async get(handle: string, ruleId: string): Promise<SlackContactRule> {
    return parseRule(await this.http.get<RawRule>(path(handle, ruleId)));
  }
  async create(handle: string, options: CreateSlackContactRuleOptions): Promise<SlackContactRule> {
    return parseRule(await this.http.post<RawRule>(path(handle), {
      action: options.action, match_type: options.matchType, match_target: options.matchTarget,
      ...(options.direction !== undefined ? { direction: options.direction } : {}),
    }));
  }
  async update(handle: string, ruleId: string, options: UpdateSlackContactRuleOptions): Promise<SlackContactRule> {
    return parseRule(await this.http.patch<RawRule>(path(handle, ruleId), ruleUpdateToWire(options)));
  }
  async delete(handle: string, ruleId: string): Promise<void> {
    await this.http.delete(path(handle, ruleId));
  }
  async getSettings(handle: string): Promise<SlackContactRuleSettings> {
    return parseSettings(await this.http.get<RawSettings>(path(handle, "settings")));
  }
  async updateSettings(handle: string, options: Partial<SlackContactRuleSettings>): Promise<SlackContactRuleSettings> {
    const body: Record<string, string> = {};
    for (const [name, value] of [["inbound_filter_mode", options.inboundFilterMode],
      ["outbound_filter_mode", options.outboundFilterMode]] as const) {
      if (value === undefined) continue;
      if (value !== "blacklist" && value !== "whitelist") throw new TypeError("Invalid directional filter mode");
      body[name] = value;
    }
    if (!Object.keys(body).length) throw new TypeError("Provide at least one directional filter mode");
    return parseSettings(await this.http.patch<RawSettings>(path(handle, "settings"), body));
  }
}

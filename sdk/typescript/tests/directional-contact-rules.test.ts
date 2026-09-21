import { afterEach, describe, expect, it, vi } from "vitest";
import { Inkbox, MailRuleAction, MailRuleMatchType, PhoneRuleAction, type MailContactRule, type RuleDirection } from "../src/index.js";
import { parseAgentIdentityData, type RawAgentIdentityData } from "../src/identities/types.js";
import { AgentIdentity } from "../src/agent_identity.js";
import { HttpTransport } from "../src/_http.js";
import { MailContactRulesResource } from "../src/mail/resources/contactRules.js";
import { MailIdentityContactRulesResource } from "../src/mail/resources/identityContactRules.js";
import { PhoneContactRulesResource } from "../src/phone/resources/contactRules.js";
import { PhoneIdentityContactRulesResource } from "../src/phone/resources/identityContactRules.js";
import { IMessageContactRulesResource } from "../src/imessage/resources/contactRules.js";

const rule = {
  id: "rule-1", mailbox_id: "mailbox-1", phone_number_id: "number-1", agent_identity_id: "identity-1",
  action: "allow", match_type: "exact_email", match_target: "x@example.com", status: "active",
  created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
};
const identity = {
  id: "identity-1", organization_id: "org-example", agent_handle: "example-agent", display_name: null,
  description: null, email_address: "x@example.com", mailbox: null, phone_number: null, tunnel: null,
  created_at: rule.created_at, updated_at: rule.updated_at,
  mail_filter_mode: "whitelist", phone_filter_mode: "whitelist",
} satisfies RawAgentIdentityData;

afterEach(() => vi.restoreAllMocks());

describe.each([
  ["mail resource", MailContactRulesResource],
  ["mail identity", MailIdentityContactRulesResource],
  ["phone resource", PhoneContactRulesResource],
  ["phone identity", PhoneIdentityContactRulesResource],
  ["iMessage", IMessageContactRulesResource],
] as const)("directional %s", (_label, Resource) => {
  it("preserves old requests, parses coverage, and keeps authoritative IDs on 201", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(rule, { status: 201 }));
    const resource = new Resource(new HttpTransport("test-key", "https://example.com/api/v1"));
    const create = { action: "allow", matchType: "exact_email", matchTarget: "x@example.com" } as never;
    const saved = await resource.create("example-agent", create);
    expect(saved.direction).toBe("both");
    expect(JSON.parse(String(request.mock.calls[0][1]?.body))).not.toHaveProperty("direction");
    for (const direction of ["inbound", "outbound", "both"] as RuleDirection[]) {
      request.mockResolvedValueOnce(Response.json({ ...rule, direction }, { status: 201 }));
      const widened = await resource.create("example-agent", { ...(create as object), direction } as never);
      expect(widened).toMatchObject({ id: rule.id, direction });
      expect(JSON.parse(String(request.mock.calls.at(-1)?.[1]?.body)).direction).toBe(direction);
    }
    request.mockResolvedValueOnce(Response.json({ detail: { existing_rule_id: rule.id } }, { status: 409 }));
    await expect(resource.create("example-agent", create)).rejects.toMatchObject({ existingRuleId: rule.id, statusCode: 409 });
  });

  it("serializes applicable list filters and atomic updates without changing old patches", async () => {
    const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
      Response.json(init?.method === "GET" ? [{ ...rule, direction: "both" }] : { ...rule, direction: "inbound" }));
    const resource = new Resource(new HttpTransport("test-key", "https://example.com/api/v1"));
    await resource.list("example-agent", { direction: "inbound" });
    await resource.listAll({ direction: "both" });
    expect(String(request.mock.calls[0][0])).toContain("direction=inbound");
    expect(String(request.mock.calls[1][0])).toContain("direction=both");
    await resource.update("example-agent", rule.id, { direction: "outbound" });
    expect(JSON.parse(String(request.mock.calls[2][1]?.body))).toEqual({ direction: "outbound" });
    await resource.update("example-agent", rule.id, { action: "block", applyTo: "inbound" } as never);
    expect(JSON.parse(String(request.mock.calls[3][1]?.body))).toEqual({ action: "block", apply_to: "inbound" });
    await resource.update("example-agent", rule.id, { action: "allow" } as never);
    expect(JSON.parse(String(request.mock.calls[4][1]?.body))).toEqual({ action: "allow" });
    for (const invalid of [{}, { applyTo: "inbound" }, { action: "allow", direction: "both", applyTo: "inbound" }, { action: "allow", applyTo: "both" }, { direction: null }]) {
      await expect(resource.update("example-agent", rule.id, invalid as never)).rejects.toThrow();
    }
    expect(request).toHaveBeenCalledTimes(5);
  });
});

it("keeps legacy typed literals and identity conveniences, with shared-mode fallbacks", async () => {
  const oldRule: MailContactRule = {
    id: "rule-1", mailboxId: "mailbox-1", action: MailRuleAction.ALLOW, matchType: MailRuleMatchType.EXACT_EMAIL,
    matchTarget: "x@example.com", status: "active" as MailContactRule["status"], createdAt: new Date(), updatedAt: new Date(),
  };
  expect(oldRule.direction).toBeUndefined();
  const request = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) =>
    Response.json(init?.method === "PATCH" ? { ...identity, mail_outbound_filter_mode: "blacklist" } : rule));
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  const agent = new AgentIdentity(parseAgentIdentityData(identity), client);
  expect(agent.mailInboundFilterMode).toBe("whitelist");
  expect(agent.phoneOutboundFilterMode).toBe("whitelist");
  await agent.update({ mailOutboundFilterMode: "blacklist", phoneInboundFilterMode: "blacklist" });
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ mail_outbound_filter_mode: "blacklist", phone_inbound_filter_mode: "blacklist" });
  expect(agent.mailOutboundFilterMode).toBe("blacklist");
  await expect(agent.update({ imessageFilterMode: "blacklist", phoneInboundFilterMode: "whitelist" })).rejects.toThrow("cannot be combined");
  await agent.createPhoneContactRule({ action: PhoneRuleAction.ALLOW, matchTarget: "+15555550123", direction: "inbound" });
  expect(JSON.parse(String(request.mock.calls[1][1]?.body)).direction).toBe("inbound");
});

it("keeps receive-only access separate and validates access writes before requests", async () => {
  const access = {
    email: { visible: true, contactable: [], inbound_contactable: ["x@example.com"], outbound_contactable: [] },
    phone: { visible: false, contactable: [] }, profile: true, memories: false,
  };
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json(access));
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  const result = await client.contacts.access.update("example-agent", "contact-1", { email: { inboundContactable: ["x@example.com"] } });
  expect(result.email).toEqual({ visible: true, contactable: [], inboundContactable: ["x@example.com"], outboundContactable: [] });
  expect(JSON.parse(String(request.mock.calls[0][1]?.body))).toEqual({ email: { inbound_contactable: ["x@example.com"] } });
  for (const invalid of [
    { email: { contactable: [], inboundContactable: [] } }, { email: { inboundContactable: null } },
    { email: null }, { profile: false, email: { inboundContactable: ["x@example.com"] } },
  ]) await expect(client.contacts.access.update("example-agent", "contact-1", invalid as never)).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
  request.mockResolvedValue(Response.json({ id: "contact-1", created_at: rule.created_at, updated_at: rule.updated_at }));
  await client.contacts.create({ givenName: "Example", permissions: { identityId: "identity-1", email: { outboundContactable: [] } } });
  expect(JSON.parse(String(request.mock.calls[1][1]?.body)).permissions).toEqual({ identity_id: "identity-1", email: { outbound_contactable: [] } });
});

it("round-trips independent guarded address edits and directional policy projections", async () => {
  const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({
    contact_id: "contact-1", identity_id: "identity-1", revision: 2,
    addresses: [{ kind: "email", value: "x@example.com", label: null, action: "block", allowed: false,
      inbound_action: "allow", outbound_action: "block", allowed_inbound: true, allowed_outbound: false }],
    effective_visibility: { profile: true, memories: false },
    visibility: { defaults: { profile: "inherit", memories: "inherit" }, identities: [] },
  }));
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  const result = await client.contacts.communicationPolicy.replace("contact-1", {
    identityId: "identity-1", expectedRevision: 1,
    addresses: [{ kind: "email", value: "x@example.com", action: "allow", direction: "both", expectedInboundAction: "allow", expectedOutboundAction: "block" }],
  });
  expect(result.addresses[0]).toMatchObject({ action: "block", allowed: false, inboundAction: "allow", outboundAction: "block", allowedInbound: true, allowedOutbound: false });
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).addresses[0]).toEqual({
    kind: "email", value: "x@example.com", action: "allow", direction: "both", expected_inbound_action: "allow", expected_outbound_action: "block",
  });
});

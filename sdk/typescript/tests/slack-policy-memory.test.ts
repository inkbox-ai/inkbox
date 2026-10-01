import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, type SlackContactRuleSettings, type SlackWebhookPayload } from "../src/index.js";
import { parseCorrespondenceItem } from "../src/contacts/correspondence.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/slack_policy_memory.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());
function wire() {
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal("fetch", fetch);
  const client = new Inkbox({ apiKey: "synthetic-test-key", baseUrl: "https://example.com" });
  return { client, fetch, reply: (data: unknown) => fetch.mockResolvedValueOnce(new Response(JSON.stringify(data))) };
}
it("serializes all seven policy operations and preserves defaults", async () => {
  const { client, fetch, reply } = wire();
  const rules = client.slack.contactRules;
  async function check(data: unknown, call: () => Promise<unknown>, method: string, suffix = "", body?: unknown, query: Record<string,string> = {}) {
    reply(data); const result = await call(); const [url, init] = fetch.mock.calls.at(-1)!;
    expect(new URL(String(url)).pathname).toBe("/api/v1/slack/identities/example-agent/contact-rules" + suffix);
    expect(Object.fromEntries(new URL(String(url)).searchParams)).toEqual(query);
    expect(init?.method).toBe(method);
    if (body) expect(JSON.parse(String(init?.body))).toEqual(body);
    return result;
  }
  const create = { action: "allow", matchType: "exact_user", matchTarget: "TEXAMPLE:UEXAMPLE" } as const;
  await check(fixture.rule, () => rules.create("@example-agent", create), "POST", "", { action:"allow",match_type:"exact_user",match_target:"TEXAMPLE:UEXAMPLE" });
  await check([fixture.rule], () => rules.list("example-agent", {direction:"inbound",offset:0,limit:5}), "GET", "", undefined, {direction:"inbound",offset:"0",limit:"5"});
  await check(fixture.rule, () => rules.get("example-agent", fixture.rule.id), "GET", `/${fixture.rule.id}`);
  await check(fixture.rule, () => rules.update("example-agent", fixture.rule.id, {action:"block",applyTo:"outbound"}), "PATCH", `/${fixture.rule.id}`, {action:"block",apply_to:"outbound"});
  await check(fixture.settings, () => rules.getSettings("example-agent"), "GET", "/settings");
  const result = await check(fixture.settings, () => rules.updateSettings("example-agent", {inboundFilterMode:"whitelist"}), "PATCH", "/settings", {inbound_filter_mode:"whitelist"}) as SlackContactRuleSettings;
  expect(result.outboundFilterMode).toBe("blacklist");
  await check(null, () => rules.delete("example-agent", fixture.rule.id), "DELETE", `/${fixture.rule.id}`);
  expect(fetch).toHaveBeenCalledTimes(7);
});
it("rejects empty or conflicting edits before transport", async () => {
  const {client,fetch} = wire();
  await expect(client.slack.contactRules.update("example-agent", fixture.rule.id, {})).rejects.toThrow();
  await expect(client.slack.contactRules.update("example-agent", fixture.rule.id, {action:"allow",direction:"both",applyTo:"outbound"})).rejects.toThrow();
  await expect(client.slack.contactRules.updateSettings("example-agent", {})).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps Slack message coordinates and shared Companion scope distinct", async () => {
  const item = parseCorrespondenceItem(fixture.correspondence);
  expect(item.channel).toBe("slack");
  if (item.channel !== "slack") throw new Error("Wrong subtype");
  expect(item.conversationId).toBe("CEXAMPLE"); expect(item.media?.count).toBe(1);
  const {client,reply} = wire(); reply(fixture.activation);
  const page = await client.companion.activationMessages("example-agent", fixture.activation.activation_id);
  expect(page.replyContext.slackConversationId).toBe("CEXAMPLE");
  expect(page.replyContext.threadTs).toBe("1780000000.000001");
  expect(page.replyContext.conversationId).not.toBe("CEXAMPLE");
  expect(page.items[0].senderAccess).toBe("sponsored");
  for (const key of ["connection_id", "slack_conversation_id"]) {
    const bad = structuredClone(fixture.activation); delete bad.reply_context[key]; reply(bad);
    await expect(client.companion.activationMessages("example-agent", fixture.activation.activation_id)).rejects.toThrow();
  }
});
it("types Slack webhook admission with top-level Companion metadata", () => {
  const hook: SlackWebhookPayload = {id:"event",event_type:"slack.mention_received",timestamp:"2026-01-01T00:00:00Z",
    companion:{scope_id:fixture.activation.scope_id,conversation_id:fixture.activation.conversation_id,channel:"slack",phase:"live",sequence:1,reply_context:fixture.activation.reply_context},
    data:{identity_id:fixture.rule.agent_identity_id,connection_id:fixture.correspondence.connection_id,workspace_id:"TEXAMPLE",sender_access:"sponsored",message_kinds:["mention"],event:{}}};
  expect(hook.companion?.reply_context?.slack_conversation_id).toBe("CEXAMPLE");
});

import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, SlackRuleAction, SlackRuleMatchType } from "../src/index.js";
const id = "11111111-1111-4111-8111-111111111111";
const rule = { id, agent_identity_id: id, action: "allow", match_type: "exact_user", match_target: "TEXAMPLE:UEXAMPLE",
  direction: "both", status: "active", created_at: "2026-10-02T00:00:00Z", updated_at: "2026-10-02T00:00:00Z", contact: null };
afterEach(() => vi.unstubAllGlobals());
function wire() {
  const fetch = vi.fn<typeof globalThis.fetch>(); vi.stubGlobal("fetch", fetch);
  const reply = (data: unknown) => fetch.mockResolvedValueOnce(new Response(JSON.stringify(data), { status: 200 }));
  const client = new Inkbox({ apiKey: "synthetic", baseUrl: "https://example.com" });
  const request = () => { const [url, init] = fetch.mock.calls.at(-1)!; return { url: new URL(String(url)), init: init! }; };
  return { client, reply, request, fetch };
}
it("uses canonical rule paths and atomic directional edits", async () => {
  const { client, reply, request, fetch } = wire();
  reply(rule);
  const result = await client.slack.contactRules.create("project-agent", { action: SlackRuleAction.ALLOW, matchTarget: rule.match_target });
  expect(result.createdAt).toBeInstanceOf(Date);
  expect(result.matchType).toBe(SlackRuleMatchType.EXACT_USER);
  expect(request().url.pathname).toBe("/api/v1/identities/project-agent/slack-contact-rules");
  expect(JSON.parse(request().init.body as string)).toEqual({ action: "allow", match_type: "exact_user", match_target: rule.match_target });
  reply(rule);
  await client.slack.contactRules.update("project-agent", id, { action: SlackRuleAction.BLOCK, applyTo: "outbound" });
  expect(request().init.method).toBe("PATCH");
  expect(JSON.parse(request().init.body as string)).toEqual({ action: "block", apply_to: "outbound" });
  reply([rule]);
  await client.slack.contactRules.listAll({ agentIdentityId: id, direction: "inbound", limit: 2, offset: 3 });
  expect(request().url.pathname).toBe("/api/v1/slack/contact-rules");
  expect(Object.fromEntries(request().url.searchParams)).toEqual({ agent_identity_id: id, direction: "inbound", limit: "2", offset: "3" });
  reply(rule); await client.slack.contactRules.get("project-agent", id);
  reply({}); await client.slack.contactRules.delete("project-agent", id);
  expect(request().init.method).toBe("DELETE");
  const count = fetch.mock.calls.length;
  await expect(client.slack.contactRules.update("project-agent", id, { action: SlackRuleAction.BLOCK, direction: "both", applyTo: "outbound" })).rejects.toThrow();
  expect(fetch.mock.calls).toHaveLength(count);
});
it("preserves discovery availability and empty import continuation", async () => {
  const { client, reply, request } = wire();
  reply({ workspaces: [], next_cursor: null, unavailable_reason: "missing_scope" });
  const discovered = await client.slack.discoverWorkspaces(id, { source: "enterprise", cursor: "previous", limit: 2 });
  expect(discovered.unavailableReason).toBe("missing_scope");
  expect(Object.fromEntries(request().url.searchParams)).toEqual({ source: "enterprise", cursor: "previous", limit: "2" });
  reply({ imported_count: 0, skipped_count: 2, contact_ids: [], next_cursor: "next" });
  const imported = await client.slack.importContacts(id, { conversationId: "CEXAMPLE", cursor: "previous", limit: 20 });
  expect(imported.nextCursor).toBe("next");
  expect(request().url.pathname).toBe(`/api/v1/slack/connections/${id}/contacts/import`);
  expect(JSON.parse(request().init.body as string)).toEqual({ conversation_id: "CEXAMPLE", cursor: "previous", limit: 20 });
});
it("preserves and validates Slack Companion reply routing", async () => {
  const { client, reply } = wire();
  const page = { scope_id: id, activation_id: id, conversation_id: id, channel: "slack", items: [], history_complete: true, next_cursor: null,
    reply_context: { channel: "slack", conversation_id: id, connection_id: id, slack_conversation_id: "CEXAMPLE", thread_ts: "123.000100" } };
  reply(page);
  expect((await client.companion.activationMessages("project-agent", id)).replyContext).toMatchObject({ connectionId: id, slackConversationId: "CEXAMPLE", threadTs: "123.000100" });
  reply({ ...page, reply_context: { ...page.reply_context, thread_ts: 123.0001 } });
  await expect(client.companion.activationMessages("project-agent", id)).rejects.toThrow("reply scope");
});
it("updates identity modes with sibling omission and conflict rules", async () => {
  const { client, reply, request } = wire();
  const identity = { id, organization_id: "example-org", agent_handle: "project-agent", created_at: rule.created_at, updated_at: rule.updated_at,
    mailbox: null, phone_number: null, tunnel: null, slack_filter_mode: "whitelist", slack_outbound_filter_mode: "blacklist" };
  reply(identity);
  const agent = await client.getIdentity("project-agent");
  expect(agent.slackInboundFilterMode).toBe("whitelist");
  expect(agent.slackOutboundFilterMode).toBe("blacklist");
  reply(identity); await agent.update({ slackInboundFilterMode: "blacklist" });
  expect(JSON.parse(request().init.body as string)).toEqual({ slack_inbound_filter_mode: "blacklist" });
  await expect(agent.update({ slackFilterMode: "blacklist", slackInboundFilterMode: "whitelist" })).rejects.toThrow("cannot be combined");
  await expect(agent.update({ slackOutboundFilterMode: null } as never)).rejects.toThrow("null");
});

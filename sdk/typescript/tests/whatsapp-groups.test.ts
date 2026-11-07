import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { WhatsAppResource, parseWhatsAppMessage, parseWhatsAppConversation, parseWhatsAppConversationSummary } from "../src/whatsapp.js";
const group = JSON.parse(readFileSync(new URL("../../../tests/fixtures/whatsapp-groups.json", import.meta.url), "utf8"));
const direct = JSON.parse(readFileSync(new URL("../../../tests/fixtures/whatsapp.json", import.meta.url), "utf8"));
const api = () => new WhatsAppResource(new HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp"));
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
afterEach(() => vi.restoreAllMocks());
it("preserves group names and unknown numbers without changing legacy defaults", () => {
  for (const [parse, key] of [[parseWhatsAppMessage, "message"], [parseWhatsAppConversation, "conversation"], [parseWhatsAppConversationSummary, "summary"]] as const) {
    const result = parse(group[key]);
    expect(result.isGroup).toBe(true); expect(result.groupName).toBe("Project garden");
    expect(result.remoteNumber).toBeNull(); expect(result.unresolvedParticipantCount).toBe(0);
    const old = parse(direct[key === "summary" ? "conversation_summary" : key]);
    expect(old.isGroup).toBe(false); expect(old.groupName).toBeNull(); expect(old.unresolvedParticipantCount).toBe(0);
  }
  const outgoing = parseWhatsAppMessage(group.message);
  expect(outgoing.senderNumber).toBe(outgoing.localNumber); expect(outgoing.recipients).toEqual([]);
  const blocked = parseWhatsAppMessage(group.blocked_inbound_message);
  expect(blocked.direction).toBe("inbound"); expect(blocked.isBlocked).toBe(true);
  expect(blocked.senderNumber).toBeNull(); expect(blocked.unresolvedParticipantCount).toBe(1);
});
it("sends quoted group media and reactions through existing routes with stable ids", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok({ message: group.message }))));
  const b = group.send;
  expect((await api().send({ conversationId: b.conversation_id, replyToMessageId: b.reply_to_message_id, text: b.text, mediaIds: b.media_ids, gifPlayback: true, idempotencyKey: "group-quote" })).isGroup).toBe(true);
  let init = vi.mocked(fetch).mock.calls.at(-1)![1]!;
  expect(JSON.parse(String(init.body))).toEqual(b); expect(new Headers(init.headers).get("Idempotency-Key")).toBe("group-quote");
  vi.mocked(fetch).mockImplementation(() => Promise.resolve(ok({ reaction: group.reaction })));
  await api().sendReaction({ messageId: group.message.id, reaction: "like", idempotencyKey: "group-react" });
  init = vi.mocked(fetch).mock.calls.at(-1)![1]!;
  expect(JSON.parse(String(init.body))).toEqual({ message_id: group.message.id, reaction: "like" });
});
it("requires media for animations and preserves false/default send payloads", async () => {
  vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok({ message: group.message }))));
  await expect(api().send({ conversationId: group.conversation.id, text: "hello", gifPlayback: true })).rejects.toThrow("requires");
  expect(fetch).not.toHaveBeenCalled();
  await api().send({ conversationId: group.conversation.id, text: "hello", gifPlayback: false });
  expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)![1]!.body))).toEqual({ conversation_id: group.conversation.id, text: "hello" });
});

it("preserves verified native mentions and defaults legacy messages to unmentioned", () => {
  expect(parseWhatsAppMessage({ ...group.message, agent_mentioned: true }).agentMentioned).toBe(true);
  expect(parseWhatsAppMessage(group.message).agentMentioned).toBe(false);
});
it("preserves structured mentions without inventing unresolved phone numbers", () => {
  const mentions = [{ text: "@123456789", phone_number: null, is_agent: false },
    { text: "@15550000002", phone_number: "+15550000002", is_agent: true }];
  expect(parseWhatsAppMessage({ ...group.message, mentions }).mentions).toEqual([
    { text: "@123456789", phoneNumber: null, isAgent: false },
    { text: "@15550000002", phoneNumber: "+15550000002", isAgent: true },
  ]);
  expect(parseWhatsAppMessage(group.message).mentions).toEqual([]);
});


it.each(["direct", "sponsored", null] as const)("preserves WhatsApp sender admission %s", (access) => {
  expect(parseWhatsAppMessage({ ...group.message, sender_access: access }).senderAccess).toBe(access);
  expect(parseWhatsAppMessage(direct.message).senderAccess).toBeUndefined();
});

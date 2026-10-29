import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppResource, parseWhatsAppMessage, parseWhatsAppConversation, parseWhatsAppReaction } from "../src/whatsapp.js";
import { parseCorrespondenceItem } from "../src/contacts/correspondence.js";
import { HttpTransport } from "../src/_http.js";
const f = JSON.parse(readFileSync(new URL("../../../tests/fixtures/whatsapp-v2.json", import.meta.url), "utf8"));
const old = JSON.parse(readFileSync(new URL("../../../tests/fixtures/whatsapp.json", import.meta.url), "utf8"));
const api = () => new WhatsAppResource(new HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp"));
const ok = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const request = () => { const [url, init] = vi.mocked(fetch).mock.calls.at(-1)!; return { url: new URL(String(url)), init: init!, body: init?.body ? JSON.parse(String(init.body)) : null }; };
afterEach(() => vi.restoreAllMocks());
describe("WhatsApp v2 shared wire contract", () => {
  it("runs every send fixture without changing legacy direct payloads", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok({ message: f.message }))));
    for (const item of f.send_cases) {
      const b = item.body, options = { to: b.to, conversationId: b.conversation_id, replyToMessageId: b.reply_to_message_id, groupName: b.group_name, text: b.text, idempotencyKey: item.name };
      const count = vi.mocked(fetch).mock.calls.length;
      if (!item.valid) { await expect(api().send(options)).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(count); }
      else { await api().send(options); expect(request().body).toEqual(b); expect(new Headers(request().init.headers).get("Idempotency-Key")).toBe(item.name); }
    }
  });
  it("retains group uncertainty and actual quote/reaction identities without backfilling legacy history", () => {
    const message = parseWhatsAppMessage(f.message);
    expect(message.replyToMessageId).toBe(f.message.reply_to_message_id);
    expect(message.threadRootMessageId).toBe(f.message.thread_root_message_id);
    expect(message.reactions[0].emoji).toBe(f.named_emoji.love);
    const legacy = parseWhatsAppMessage(old.message);
    expect(legacy.replyToMessageId).toBeNull(); expect(legacy.threadId).toBeNull(); expect(legacy.reactions).toEqual([]);
    const conversation = parseWhatsAppConversation(f.conversation);
    expect(conversation.groupCreationStatus).toBe("uncertain"); expect(conversation.unresolvedParticipantCount).toBe(1);
  });
  it("reads both chronological thread endpoints with the same opaque cursor and exact envelope", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok(f.thread))));
    for (const run of [() => api().getThread(f.message.id, { limit: 1, cursor: "opaque+/cursor=", agentIdentityId: f.message.agent_identity_id }), () => api().getConversationThread(f.thread.conversation_id, f.thread.thread_id, { limit: 200, cursor: "opaque+/cursor=" })]) {
      const page = await run(); expect(page.messages.map(m => m.id)).toEqual(f.thread.messages.map((m: {id: string}) => m.id)); expect(page.nextCursor).toBe(f.thread.next_cursor); expect(request().url.searchParams.get("cursor")).toBe("opaque+/cursor=");
    }
    expect(request().url.pathname).toBe(`/api/v1/whatsapp/conversations/${f.thread.conversation_id}/threads/${f.thread.thread_id}`);
    const calls = vi.mocked(fetch).mock.calls.length;
    await expect(api().getThread(f.message.id, { limit: 0 })).rejects.toThrow(); await expect(api().list({ threadId: f.thread.thread_id })).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(calls);
  });
  it("reactions preserve explicit write keys, unknown actors, and uncertain/removal receipts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(ok({ reaction: { ...f.uncertain_reaction, remote_number: null } }))));
    const options = { messageId: f.message.id, customEmoji: "👨‍👩‍👧‍👦", idempotencyKey: "reaction-original", agentIdentityId: f.message.agent_identity_id };
    const result = await api().sendReaction(options); expect(result.status).toBe("uncertain"); expect(result.remoteNumber).toBeNull();
    expect(request().body).toEqual({ message_id: f.message.id, custom_emoji: options.customEmoji });
    expect(new Headers(request().init.headers).get("Idempotency-Key")).toBe("reaction-original");
    await api().getReaction(f.reaction.id); expect(request().init.method).toBe("GET");
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(ok({ reaction: f.removed_reaction })));
    const removed = await api().removeReaction(f.reaction.id, { idempotencyKey: "remove-original", agentIdentityId: f.message.agent_identity_id });
    expect(removed.status).toBe("removed"); expect(request().init.method).toBe("DELETE"); expect(new Headers(request().init.headers).get("Idempotency-Key")).toBe("remove-original"); expect(request().url.searchParams.get("agent_identity_id")).toBe(f.message.agent_identity_id);
  });
  it("rejects malformed reaction alternatives before any transport call", async () => {
    vi.stubGlobal("fetch", vi.fn());
    for (const option of [{}, { reaction: "custom" }, { reaction: "love", customEmoji: "👍" }, { customEmoji: " " }, { customEmoji: "x".repeat(33) }, { customEmoji: "\ud800" }, { reaction: "like", idempotencyKey: "" }]) {
      await expect(api().sendReaction({ messageId: f.message.id, idempotencyKey: "stable", ...option } as never)).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

it("reaction notifications preserve nullable actors and the original target message", () => {
  const event = f.reaction_webhook;
  expect(event.event_type).toBe("whatsapp.reaction_received");
  expect(event.data.message.id).toBe(f.message.id);
  expect(event.data.message.direction).toBe("outbound");
  expect(event.data.message.is_blocked).toBeUndefined();
  const reaction = parseWhatsAppReaction(event.data.reaction);
  expect(reaction.remoteNumber).toBeNull(); expect(reaction.targetMessageId).toBe(f.message.id);
});


it("normalizes omitted nullable WhatsApp correspondence fields without changing default channels", () => {
  const base = {channel: "whatsapp", source_id: f.message.id, direction: "inbound", occurred_at: f.message.created_at,
    identity_id: f.message.agent_identity_id, conversation_id: f.message.conversation_id,
    local_number: f.message.local_number, participants: f.message.participants, is_group: true};
  for (const wire of [base, {...base, remote_number: null, text: null, media: null}]) {
    const item = parseCorrespondenceItem(wire as never);
    expect(item.channel).toBe("whatsapp");
    if (item.channel !== "whatsapp") throw new Error("Incorrect correspondence channel");
    expect(item.remoteNumber).toBeNull(); expect(item.text).toBeNull(); expect(item.media).toBeNull();
  }
});

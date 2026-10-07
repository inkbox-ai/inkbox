import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { Inkbox, type IMessageWebhookPayload } from "../src/index.js";
import { parseIMessage } from "../src/imessage/types.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/imessage_sender_addresses.json", import.meta.url), "utf8"));
afterEach(() => vi.unstubAllGlobals());

it.each([fixture.sender, "+15551234567"])("preserves %s through message, conversation, assignment and webhook reads", async (sender: string) => {
  const message = { ...fixture.message, remote_number: sender,
    reactions: [{ ...fixture.message.reactions[0], remote_number: sender }] };
  const conversation = { ...fixture.conversation, remote_number: sender, participants: [sender] };
  const routes: Record<string, unknown> = {
    "/messages": [message], [`/messages/${message.id}`]: message,
    "/conversations": [conversation], [`/conversations/${conversation.id}`]: conversation,
    "/assignments": [{ ...fixture.assignment, remote_number: sender }],
  };
  const fetch = vi.fn(async (url: string, _init: RequestInit) => new Response(JSON.stringify(routes[new URL(url).pathname.replace("/api/v1/imessage", "")]), { status: 200 }));
  vi.stubGlobal("fetch", fetch);
  const resource = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" }).imessages;
  const received = await resource.get(message.id);
  expect(received.remoteNumber).toBe(sender);
  expect(received.reactions![0].remoteNumber).toBe(sender);
  expect((await resource.list({ conversationId: conversation.id }))[0].remoteNumber).toBe(sender);
  expect(await resource.getConversation(conversation.id)).toMatchObject({ remoteNumber: sender, participants: [sender] });
  expect((await resource.listConversations())[0]).toMatchObject({ remoteNumber: sender, participants: [sender] });
  expect((await resource.listAssignments())[0].remoteNumber).toBe(sender);
  expect(fetch).toHaveBeenCalledTimes(5);
  for (const [, init] of fetch.mock.calls) expect(init.method).toBe("GET");

  const payload: IMessageWebhookPayload = JSON.parse(JSON.stringify({
    ...fixture.webhook, data: { ...fixture.webhook.data, message },
  }));
  expect(payload.event_type).toBe("imessage.received");
  expect(parseIMessage(payload.data.message!)).toMatchObject({ remoteNumber: sender, senderNumber: null, isGroup: false, reactions: [{ remoteNumber: sender }] });
});

it.each(["send", "sendReaction", "removeReaction", "markConversationRead", "sendTyping"] as const)("preserves receive-only errors from %s without retrying", async (operation) => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ detail: fixture.error }), { status: 422 }));
  vi.stubGlobal("fetch", fetch);
  const resource = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" }).imessages;
  const operations = {
    send: () => resource.send({ conversationId: fixture.conversation.id, text: "Hello" }),
    sendReaction: () => resource.sendReaction({ messageId: fixture.message.id, reaction: "like" }),
    removeReaction: () => resource.removeReaction("50000000-0000-4000-8000-000000000005"),
    markConversationRead: () => resource.markConversationRead(fixture.conversation.id),
    sendTyping: () => resource.sendTyping(fixture.conversation.id),
  };
  await expect(operations[operation]()).rejects.toMatchObject({ statusCode: 422, detail: fixture.error });
  expect(fetch).toHaveBeenCalledTimes(1);
});

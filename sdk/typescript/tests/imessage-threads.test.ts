import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { IMessagesResource } from "../src/imessage/resources/imessages.js";
import { parseIMessage, type IMessage } from "../src/imessage/types.js";
import type { IMessageThread, IMessageWebhookMessage } from "../src/index.js";

const base = "https://inkbox.ai/api/v1/imessage";
const conversation = "cccc1111-0000-0000-0000-000000000001";
const message = "dddd4444-0000-0000-0000-000000000001";
const thread = "eeee5555-0000-0000-0000-000000000001";
const identity = "ffff6666-0000-0000-0000-000000000001";
const row = {
  id: message, conversation_id: conversation, assignment_id: null,
  direction: "inbound", remote_number: null, content: "Agreed", message_type: "message",
  service: "imessage", is_read: false, created_at: "2026-09-29T00:00:00Z", updated_at: "2026-09-29T00:00:00Z",
};
const threaded = { ...row, id: "aaaa7777-0000-0000-0000-000000000001", reply_to_message_id: message, thread_id: thread, thread_root_message_id: message };
const page = { thread_id: thread, conversation_id: conversation, thread_root_message_id: message,
  messages: [threaded], next_cursor: "opaque:next" };
function setup(payload: unknown) {
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetch);
  return { fetch, resource: new IMessagesResource(new HttpTransport("test-key", base)) };
}
afterEach(() => vi.unstubAllGlobals());

describe("iMessage threads", () => {
  it("parses missing/null metadata and preserves old structural constructors", () => {
    const legacy: IMessage = parseIMessage(row);
    expect(legacy.threadId).toBeNull();
    expect(parseIMessage({ ...row, thread_id: null }).threadRootMessageId).toBeNull();
    const { threadId: _thread, replyToMessageId: _parent, threadRootMessageId: _root, ...oldShape } = legacy;
    const compatible: IMessage = oldShape;
    expect(compatible.id).toBe(message);
    const webhook: Pick<IMessageWebhookMessage, "thread_id" | "reply_to_message_id" | "thread_root_message_id"> = {};
    expect(webhook).toEqual({});
  });
  it("sends a reply with exact wire keys and preserves its request key", async () => {
    const { fetch, resource } = setup({ message: threaded });
    const reply = await resource.send({ conversationId: conversation, replyToMessageId: message, text: "Agreed", agentIdentityId: identity, idempotencyKey: "reply-one" });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ conversation_id: conversation, reply_to_message_id: message, plain_reply_fallback: true, text: "Agreed" });
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get("agent_identity_id")).toBe(identity);
    expect(reply.threadId).toBe(thread);
  });
  it.each([undefined, true, false])("omits reply options for ordinary sends (fallback %s)", async (plainReplyFallback) => {
    const { fetch, resource } = setup({ message: row });
    await resource.send({ conversationId: conversation, text: "Hello", plainReplyFallback });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ conversation_id: conversation, text: "Hello" });
  });
  it("rejects reply targets without a conversation or with a recipient", async () => {
    const { fetch, resource } = setup({ message: row });
    await expect(resource.send({ replyToMessageId: message, text: "Hello" })).rejects.toThrow("requires conversationId");
    await expect(resource.send({ conversationId: conversation, replyToMessageId: message, to: "+15550100101", text: "Hello" })).rejects.toThrow("cannot be used with to");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reads a chronological thread page with cursor encoding", async () => {
    const { fetch, resource } = setup(page);
    const result: IMessageThread = await resource.getThread(message, { limit: 2, cursor: "prior+/=", agentIdentityId: identity });
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe(`/api/v1/imessage/messages/${message}/thread`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "2", cursor: "prior+/=", agent_identity_id: identity });
    expect(result.nextCursor).toBe("opaque:next");
    expect(result.messages[0].threadRootMessageId).toBe(message);
  });
  it("reads by conversation/thread ID without inventing an offset", async () => {
    const { fetch, resource } = setup(page);
    await resource.getConversationThread(conversation, thread);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe(`/api/v1/imessage/conversations/${conversation}/threads/${thread}`);
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "50" });
  });
  it("preserves offset list semantics when filtering by thread", async () => {
    const { fetch, resource } = setup([threaded]);
    const rows = await resource.list({ conversationId: conversation, threadId: thread, offset: 10 });
    expect(Object.fromEntries(new URL(fetch.mock.calls[0][0]).searchParams)).toEqual({ conversation_id: conversation, thread_id: thread, limit: "50", offset: "10" });
    expect(rows[0].replyToMessageId).toBe(message);
    await expect(resource.list({ threadId: thread })).rejects.toThrow("requires conversationId");
  });
});

it("identity helpers scope every threaded operation", async () => {
  const { AgentIdentity } = await import("../src/agent_identity.js");
  const { parseAgentIdentityData } = await import("../src/identities/types.js");
  const { RAW_IDENTITY_DETAIL } = await import("./sampleData.js");
  const resource = { get: vi.fn(), getThread: vi.fn(), getConversationThread: vi.fn(), send: vi.fn(), list: vi.fn() };
  const sdk = { _imessages: resource } as unknown as import("../src/inkbox.js").Inkbox;
  const agent = new AgentIdentity(parseAgentIdentityData({ ...RAW_IDENTITY_DETAIL, imessage_enabled: true }), sdk);
  await agent.getIMessage(message);
  expect(resource.get).toHaveBeenCalledWith(message, { agentIdentityId: agent.id });
  await agent.getIMessageThread(message, { cursor: "next" });
  expect(resource.getThread).toHaveBeenCalledWith(message, { cursor: "next", agentIdentityId: agent.id });
  await agent.getIMessageConversationThread(conversation, thread, { limit: 2 });
  expect(resource.getConversationThread).toHaveBeenCalledWith(conversation, thread, { limit: 2, agentIdentityId: agent.id });
  await agent.sendIMessage({ conversationId: conversation, replyToMessageId: message, text: "Agreed" });
  expect(resource.send).toHaveBeenCalledWith({ conversationId: conversation, replyToMessageId: message, text: "Agreed", agentIdentityId: agent.id });
  await agent.sendIMessage({ conversationId: conversation, replyToMessageId: message, text: "Strict", plainReplyFallback: false });
  expect(resource.send).toHaveBeenLastCalledWith({ conversationId: conversation, replyToMessageId: message, text: "Strict", plainReplyFallback: false, agentIdentityId: agent.id });
  await agent.listIMessages({ conversationId: conversation, threadId: thread });
  expect(resource.list).toHaveBeenCalledWith({ conversationId: conversation, threadId: thread, agentIdentityId: agent.id });
});

it("reply retries preserve the exact target, body, and request key", async () => {
  vi.useFakeTimers();
  try {
    const { fetch, resource } = setup({ message: threaded });
    fetch.mockRejectedValueOnce(new TypeError("temporary connection failure"));
    const pending = resource.send({ conversationId: conversation, replyToMessageId: message, text: "Agreed", idempotencyKey: "reply-one" });
    await vi.runAllTimersAsync();
    await pending;
    expect(fetch).toHaveBeenCalledTimes(2);
    const first = fetch.mock.calls[0][1];
    const second = fetch.mock.calls[1][1];
    expect(second.body).toBe(first.body);
    expect(JSON.parse(first.body).reply_to_message_id).toBe(message);
    expect(second.headers).toEqual(first.headers);
    expect(first.headers["Idempotency-Key"]).toBe("reply-one");
  } finally { vi.useRealTimers(); }
});


it.each([true, false])("preserves fallback %s and an ordinary result without invented metadata", async (plainReplyFallback) => {
  const { fetch, resource } = setup({ message: row });
  const result = await resource.send({ conversationId: conversation, replyToMessageId: message, text: "Agreed", plainReplyFallback });
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ conversation_id: conversation, reply_to_message_id: message, plain_reply_fallback: plainReplyFallback, text: "Agreed" });
  expect(result.replyToMessageId).toBeNull();
  expect(result.threadId).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([400, 403, 404, 422])("does not convert HTTP %s into a client-side plain fallback", async (status) => {
  const { fetch, resource } = setup(null);
  fetch.mockResolvedValueOnce(new Response(JSON.stringify({ detail: { error: "imessage_reply_target_unavailable" } }), { status, headers: { "Content-Type": "application/json" } }));
  await expect(resource.send({ conversationId: conversation, replyToMessageId: message, text: "Agreed", plainReplyFallback: true })).rejects.toMatchObject({ statusCode: status });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body).reply_to_message_id).toBe(message);
});

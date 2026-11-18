import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Chat, type Message, type Thread } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createInkboxAdapter, type InkboxRoute } from "../src/index.js";

const identity = { id: "identity-hydration", emailAddress: "assistant@example.com" };
const secret = "synthetic-hydration-secret";
const timestamp = "2026-01-01T00:00:00Z";
const destination: InkboxRoute = {
  identityId: identity.id, channel: "sms", conversationId: "conversation-hydration",
};
function request(transcript: unknown, callId = "call-hydration") {
  const body = JSON.stringify({
    id: `event-${callId}`, event_type: "call.ended", timestamp,
    data: {
      call: {
        id: callId, origin: "dedicated_number", direction: "inbound", status: "completed",
        local_phone_number: "+12025550100", remote_phone_number: "+12025550123",
        created_at: timestamp,
      },
      transcript,
    },
  });
  const time = String(Math.floor(Date.now() / 1000));
  const id = "request-hydration";
  const signature = createHmac("sha256", secret).update(`${id}.${time}.${body}`).digest("hex");
  return new Request("https://example.com/webhook", {
    method: "POST", body,
    headers: {
      "x-inkbox-request-id": id,
      "x-inkbox-timestamp": time,
      "x-inkbox-signature": `sha256=${signature}`,
    },
  });
}
async function setup() {
  const adapter = createInkboxAdapter({ apiKey: "synthetic-key", agentHandle: "assistant", signingSecret: secret });
  vi.spyOn(adapter.transport, "identity").mockResolvedValue(identity as never);
  const history = vi.spyOn(adapter.transport, "history");
  const resolve = vi.spyOn(adapter.transport, "callConversation").mockResolvedValue(destination);
  const bot = new Chat({ userName: "assistant", adapters: { inkbox: adapter }, state: createMemoryState() });
  const handler = vi.fn(async (thread: Thread, _message: Message) => { await thread.subscribe(); });
  bot.onNewMention(handler);
  bot.onSubscribedMessage(handler);
  await bot.initialize();
  return { adapter, bot, handler, history, resolve };
}
function line(text: string) {
  return { id: text, text, authorId: "remote", isMe: false, createdAt: new Date(timestamp), raw: {} };
}

describe("post-call transcript hydration", () => {
  it.each([
    { name: "empty inline", transcript: { entries: [], abridged: false }, hydrates: false },
    { name: "whitespace inline", transcript: { entries: [{ party: "remote", text: "  " }] }, hydrates: false },
    { name: "missing transcript with empty history", transcript: null, hydrates: true },
    { name: "truncated excerpt with empty authoritative text", transcript: { entries: [{ party: "remote", text: "excerpt", truncated: true }] }, hydrates: true },
  ])("$name stays observation-only", async ({ transcript, hydrates }) => {
    const { adapter, bot, handler, history, resolve } = await setup();
    history.mockResolvedValue({ messages: [line(" ")] });
    try {
      expect((await bot.webhooks.inkbox(request(transcript))).status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(adapter.decodeThreadId(handler.mock.calls[0][0].id).channel).toBe("voice");
      expect(resolve).not.toHaveBeenCalled();
      expect(history).toHaveBeenCalledTimes(hydrates ? 1 : 0);
    } finally { await bot.shutdown(); }
  });

  it.each([
    { entries: [{ party: "remote", text: "short excerpt", truncated: true }] },
    { entries: [{ party: "remote", text: "short excerpt" }], abridged: true },
  ])("hydrates all pages before handing the transcript into messaging", async (transcript) => {
    const { adapter, bot, handler, history, resolve } = await setup();
    history.mockResolvedValueOnce({ messages: [line("First full turn")], nextCursor: "next" })
      .mockResolvedValueOnce({ messages: [line("Last full turn")] });
    resolve.mockImplementation(async () => {
      expect(history).toHaveBeenCalledTimes(2);
      return destination;
    });
    try {
      expect((await bot.webhooks.inkbox(request(transcript))).status).toBe(200);
      const [thread, message] = handler.mock.calls[0];
      expect(adapter.decodeThreadId(thread.id)).toEqual(destination);
      expect(message.text).toContain("First full turn\nremote: Last full turn");
      expect(message.text).not.toContain("short excerpt");
      expect(history).toHaveBeenLastCalledWith(
        { identityId: identity.id, channel: "voice", callId: "call-hydration" },
        { limit: 100, cursor: "next", direction: "forward" },
      );
      expect((message.raw as { id: string }).id).toBe("call:call-hydration");
      const other = adapter.parseMessage({ route: destination, id: "call:another-call", text: "Other call", authorId: "remote", isMe: false, createdAt: timestamp });
      expect(other.id).not.toBe(message.id);
    } finally { await bot.shutdown(); }
  });

  it("lets hydration failure retry before handler admission or deduplication", async () => {
    const { bot, handler, history, resolve } = await setup();
    history.mockRejectedValueOnce(new Error("transcript unavailable"))
      .mockResolvedValue({ messages: [line("Complete transcript")] });
    const transcript = { entries: [{ party: "remote", text: "excerpt", truncated: true }] };
    try {
      await expect(bot.webhooks.inkbox(request(transcript))).rejects.toThrow("transcript unavailable");
      expect(handler).not.toHaveBeenCalled();
      expect(resolve).not.toHaveBeenCalled();
      expect((await bot.webhooks.inkbox(request(transcript))).status).toBe(200);
      expect((await bot.webhooks.inkbox(request(transcript))).status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally { await bot.shutdown(); }
  });
});

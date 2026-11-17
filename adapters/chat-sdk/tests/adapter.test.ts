import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Chat, Message, emoji } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import { createInkboxAdapter, type InkboxRoute } from "../src/index.js";
import { normalizeEvent } from "../src/events.js";

const identity = { id: "identity-test", emailAddress: "assistant@example.com" };
const secret = "test-signing-secret";
const event = (event_type: string, data: unknown) => ({
  id: "evt-test",
  event_type,
  timestamp: new Date().toISOString(),
  data,
});
const incoming = () =>
  event("text.received", {
    text_message: {
      id: "message-test",
      direction: "inbound",
      conversation_id: "conversation-test",
      text: "Hello",
      sender_phone_number: "+12025550123",
      created_at: new Date().toISOString(),
    },
  });
function signed(payload: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const requestId = "request-test";
  const signature = createHmac("sha256", secret)
    .update(`${requestId}.${timestamp}.${body}`)
    .digest("hex");
  return new Request("https://example.com/webhook", {
    method: "POST",
    body,
    headers: {
      "x-inkbox-timestamp": timestamp,
      "x-inkbox-request-id": requestId,
      "x-inkbox-signature": `sha256=${signature}`,
      ...extra,
    },
  });
}
async function setup() {
  const adapter = createInkboxAdapter({
    apiKey: "test-key",
    agentHandle: "assistant",
    signingSecret: secret,
  });
  vi.spyOn(adapter.transport, "identity").mockResolvedValue(identity as never);
  const bot = new Chat({
    userName: "assistant",
    adapters: { inkbox: adapter },
    state: createMemoryState(),
  });
  const handler = vi.fn(async (thread) => {
    await thread.subscribe();
  });
  bot.onNewMention(handler);
  bot.onSubscribedMessage(handler);
  await bot.initialize();
  return { adapter, bot, handler };
}

describe("signed webhook delivery", () => {
  it("processes and deduplicates a replay through real Chat state", async () => {
    const { bot, handler } = await setup();
    const payload = incoming();
    expect((await bot.webhooks.inkbox(signed(payload))).status).toBe(200);
    expect((await bot.webhooks.inkbox(signed(payload))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1].text).toBe("Hello");
    await bot.shutdown();
  });
  it.each([
    { "x-inkbox-signature": "sha256=short" },
    { "x-inkbox-signature": `sha256=${"0".repeat(64)}` },
    { "x-inkbox-timestamp": "0" },
    { "x-inkbox-timestamp": "NaN" },
    { "x-inkbox-request-id": "" },
  ])("rejects malformed, mismatched, and stale signatures", async (headers) => {
    const { bot, handler } = await setup();
    expect(
      (await bot.webhooks.inkbox(signed(incoming(), headers))).status,
    ).toBe(401);
    expect(handler).not.toHaveBeenCalled();
    await bot.shutdown();
  });
  it("does not turn receipts or outbound traffic into messages", async () => {
    const { bot, handler } = await setup();
    expect(
      (await bot.webhooks.inkbox(signed(event("text.delivered", {})))).status,
    ).toBe(200);
    const outbound = incoming();
    outbound.data.text_message.direction = "outbound";
    expect((await bot.webhooks.inkbox(signed(outbound))).status).toBe(200);
    expect(handler).not.toHaveBeenCalled();
    await bot.shutdown();
  });
  it("rejects malformed supported events", async () => {
    const { bot } = await setup();
    expect(
      (await bot.webhooks.inkbox(signed(event("text.received", {})))).status,
    ).toBe(400);
    await bot.shutdown();
  });
  it("hydrates full mail before invoking the handler", async () => {
    const { bot, adapter, handler } = await setup();
    vi.spyOn(adapter.transport, "getMessage").mockResolvedValue({
      id: "email-test",
      text: "Complete email",
      authorId: "sender@example.com",
      isMe: false,
      createdAt: new Date(),
      raw: {},
    });
    const payload = event("message.received", {
      message: {
        id: "email-test",
        thread_id: "thread-test",
        direction: "inbound",
        from_address: "sender@example.com",
        body: "Complete",
        body_truncated: true,
      },
    });
    expect((await bot.webhooks.inkbox(signed(payload))).status).toBe(200);
    expect(handler.mock.calls[0][1].text).toBe("Complete email");
    await bot.shutdown();
  });
  it("registers background work with waitUntil", async () => {
    const { bot, handler } = await setup();
    const pending: Promise<unknown>[] = [];
    expect(
      (
        await bot.webhooks.inkbox(signed(incoming()), {
          waitUntil: (p) => pending.push(p),
        })
      ).status,
    ).toBe(200);
    await Promise.all(pending);
    expect(handler).toHaveBeenCalledTimes(1);
    await bot.shutdown();
  });
  it("returns the webhook response before a waitUntil handler finishes", async () => {
    const { bot, handler } = await setup();
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    handler.mockImplementation(async () => {
      await gate;
    });
    const pending: Promise<unknown>[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        bot.webhooks.inkbox(signed(incoming()), {
          waitUntil: (task) => pending.push(task),
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 1000);
        }),
      ]);
      expect(response?.status).toBe(200);
      expect(pending).toHaveLength(1);
    } finally {
      clearTimeout(timer);
      finish();
      await Promise.all(pending);
      await bot.shutdown();
    }
  });
  it("does not deduplicate equal Slack timestamps from different conversations", async () => {
    const { bot, handler } = await setup();
    for (const conversation of ["channel-one", "channel-two"]) {
      const payload = event("slack.mention_received", {
        identity_id: identity.id,
        connection_id: "connection-test",
        conversation_id: conversation,
        message_ts: "123.456",
        actor_id: "user-test",
        event: { text: "Hello" },
      });
      payload.id = `evt-${conversation}`;
      expect((await bot.webhooks.inkbox(signed(payload))).status).toBe(200);
    }
    expect(handler).toHaveBeenCalledTimes(2);
    const first = handler.mock.calls[0][1];
    const second = handler.mock.calls[1][1];
    expect(first.id).not.toBe(second.id);
    expect(first.raw.id).toBe("123.456");
    expect(second.raw.id).toBe("123.456");
    await bot.shutdown();
  });
});

describe("thread routing", () => {
  const routes: InkboxRoute[] = [
    {
      identityId: identity.id,
      channel: "email",
      emailAddress: identity.emailAddress,
      threadId: "thread:with/unicode-☀",
    },
    { identityId: identity.id, channel: "sms", conversationId: "group-text" },
    {
      identityId: identity.id,
      channel: "imessage",
      conversationId: "group-imessage",
      threadId: "nested",
      replyToMessageId: "root",
      isGroup: true,
    },
    {
      identityId: identity.id,
      channel: "slack",
      connectionId: "connection",
      conversationId: "channel",
      threadTs: "123.456",
    },
    { identityId: identity.id, channel: "a2a", taskId: "task" },
    { identityId: identity.id, channel: "voice", callId: "call" },
  ];
  it.each(routes)(
    "round trips $channel and survives a new adapter instance",
    (route) => {
      const first = createInkboxAdapter({
        apiKey: "test",
        agentHandle: "assistant",
        signingSecret: secret,
      });
      const second = createInkboxAdapter({
        apiKey: "test",
        agentHandle: "assistant",
        signingSecret: secret,
      });
      expect(second.decodeThreadId(first.encodeThreadId(route))).toEqual(route);
    },
  );
  it("does not split email threads when the reply anchor changes", () => {
    const adapter = createInkboxAdapter({
      apiKey: "test",
      agentHandle: "assistant",
      signingSecret: secret,
    });
    const route = routes[0] as Extract<InkboxRoute, { channel: "email" }>;
    expect(adapter.encodeThreadId({ ...route, anchorMessageId: "one" })).toBe(
      adapter.encodeThreadId({ ...route, anchorMessageId: "two" }),
    );
  });
  it("rejects another identity's serialized route", async () => {
    const { adapter, bot } = await setup();
    const id = adapter.encodeThreadId({
      ...routes[1],
      identityId: "different",
    });
    expect(() => adapter.decodeThreadId(id)).toThrow(
      "different Inkbox identity",
    );
    await bot.shutdown();
  });
  it("posts in the originating group conversation and passes retry keys", async () => {
    const { adapter, bot } = await setup();
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "sent", raw: {} });
    const threadId = adapter.encodeThreadId(routes[1]);
    await adapter.send(threadId, "reply", {
      idempotencyKey: "stable-operation-key",
    });
    expect(send).toHaveBeenCalledWith(
      routes[1],
      expect.objectContaining({
        text: "reply",
        idempotencyKey: "stable-operation-key",
      }),
    );
    await bot.shutdown();
  });
  it("unwraps scoped message IDs for SDK reads and rejects cross-thread IDs", async () => {
    const { adapter, bot } = await setup();
    const route = routes[1];
    const native = {
      id: "native-message",
      text: "Hello",
      authorId: "sender",
      isMe: false,
      createdAt: new Date(),
    };
    const get = vi
      .spyOn(adapter.transport, "getMessage")
      .mockResolvedValue(native);
    const parsed = adapter.parseMessage({ ...native, route });
    expect((await adapter.fetchMessage(parsed.threadId, parsed.id)).id).toBe(
      parsed.id,
    );
    expect(get).toHaveBeenCalledWith(route, "native-message");
    get.mockClear();
    await expect(
      adapter.fetchMessage(adapter.encodeThreadId(routes[4]), parsed.id),
    ).rejects.toThrow("different thread");
    expect(get).not.toHaveBeenCalled();
    await bot.shutdown();
  });
  it("refuses file loss on unsupported channels", async () => {
    const { adapter, bot } = await setup();
    await expect(
      adapter.postMessage(adapter.encodeThreadId(routes[4]), {
        raw: "file",
        files: [{ filename: "test.txt", data: Buffer.from("content") }],
      }),
    ).rejects.toThrow("File posting");
    await bot.shutdown();
  });
});

describe("channel event normalization", () => {
  it("keeps group iMessage threads and media", () => {
    const message = normalizeEvent(
      event("imessage.received", {
        message: {
          id: "message",
          direction: "inbound",
          conversation_id: "group",
          thread_id: "thread",
          thread_root_message_id: "root",
          sender_number: "+12025550123",
          is_group: true,
          content: "photo",
          media: [
            { url: "https://example.com/photo", content_type: "image/jpeg" },
          ],
        },
      }),
      identity,
    );
    expect(message?.route).toMatchObject({
      channel: "imessage",
      conversationId: "group",
      threadId: "thread",
      replyToMessageId: "root",
      isGroup: true,
    });
    expect(message?.attachments?.[0].type).toBe("image");
  });
  it("separates Slack connection/thread and excludes bots", () => {
    const data = {
      identity_id: identity.id,
      connection_id: "conn",
      conversation_id: "channel",
      message_ts: "2.0",
      thread_ts: "1.0",
      actor_id: "user",
      event: { text: "hello" },
    };
    const message = normalizeEvent(
      event("slack.thread_reply_received", data),
      identity,
    );
    expect(message?.route).toMatchObject({
      channel: "slack",
      threadTs: "1.0",
      connectionId: "conn",
    });
    expect(
      normalizeEvent(
        event("slack.thread_reply_received", {
          ...data,
          actor_profile: { is_bot: true },
        }),
        identity,
      ),
    ).toBeNull();
  });
  it("normalizes A2A user parts without accepting self echoes", () => {
    const data = {
      task_id: "task",
      message_id: "message",
      caller: { identity_id: "caller" },
      parts: [{ kind: "text", text: "work" }],
    };
    expect(
      normalizeEvent(event("a2a.task.created", data), identity)?.text,
    ).toBe("work");
    expect(
      normalizeEvent(
        event("a2a.task.message", {
          ...data,
          sender: { identity_id: identity.id },
        }),
        identity,
      ),
    ).toBeNull();
  });
  it("represents completed calls as transcript observations", () => {
    const message = normalizeEvent(
      event("call.ended", {
        call: {
          id: "call",
          remote_phone_number: "+12025550123",
          direction: "inbound",
          status: "completed",
        },
        transcript: {
          entries: [{ party: "remote", text: "Follow up tomorrow" }],
        },
      }),
      identity,
    );
    expect(message?.route.channel).toBe("voice");
    expect(message?.text).toContain("remote: Follow up tomorrow");
  });
});

describe("media and reaction behavior", () => {
  it("uploads iMessage file bytes and sends the returned mediaUrl", async () => {
    const { adapter, bot } = await setup();
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "imessage",
      conversationId: "imessage-media",
      isGroup: false,
    };
    const content = Buffer.from([0, 127, 255, 42]);
    const upload = vi
      .spyOn(adapter.transport, "uploadMedia")
      .mockResolvedValue({
        mediaUrl: "https://example.com/media/uploaded.png",
        contentType: "image/png",
        size: content.length,
      });
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "sent-media", raw: {} });
    await adapter.postMessage(adapter.encodeThreadId(route), {
      raw: "See attached",
      files: [{ filename: "photo.png", mimeType: "image/png", data: content }],
    });
    expect(upload).toHaveBeenCalledWith({
      filename: "photo.png",
      contentType: "image/png",
      content: new Uint8Array(content),
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining(route), {
      text: "See attached",
      idempotencyKey: expect.any(String),
      mediaUrls: ["https://example.com/media/uploaded.png"],
    });
    await bot.shutdown();
  });

  it("preserves email file bytes and MIME type in base64 attachments", async () => {
    const { adapter, bot } = await setup();
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "email",
      emailAddress: identity.emailAddress,
      threadId: "email-files",
    };
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "sent-email", raw: {} });
    const content = Buffer.from([0, 1, 127, 128, 255]);
    await adapter.postMessage(adapter.encodeThreadId(route), {
      raw: "Documents",
      files: [
        { filename: "bytes.bin", data: content },
        {
          filename: "note.txt",
          data: new Blob(["Hello"], { type: "text/plain" }),
          mimeType: "text/plain",
        },
      ],
    });
    expect(send).toHaveBeenCalledWith(route, {
      text: "Documents",
      idempotencyKey: expect.any(String),
      attachments: [
        {
          filename: "bytes.bin",
          contentBase64: content.toString("base64"),
          contentType: "application/octet-stream",
        },
        {
          filename: "note.txt",
          contentBase64: "SGVsbG8=",
          contentType: "text/plain",
        },
      ],
    });
    await bot.shutdown();
  });

  it("delegates a Slack file to the SDK-backed upload transport", async () => {
    const { adapter, bot } = await setup();
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "slack",
      connectionId: "connection-files",
      conversationId: "CFILES",
      threadTs: "123.456",
    };
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "123.457", raw: {} });
    await adapter.postMessage(adapter.encodeThreadId(route), {
      raw: "Report",
      files: [
        {
          filename: "report.txt",
          data: Buffer.from("report"),
          mimeType: "text/plain",
        },
      ],
    });
    expect(send).toHaveBeenCalledWith(route, {
      text: "Report",
      idempotencyKey: expect.any(String),
      attachments: [
        {
          filename: "report.txt",
          contentBase64: "cmVwb3J0",
          contentType: "text/plain",
        },
      ],
    });
    await bot.shutdown();
  });

  it.each([
    { channel: "imessage" as const, expected: "like" },
    { channel: "slack" as const, expected: "+1" },
  ])(
    "maps Chat thumbs_up to $channel add/remove reaction names",
    async ({ channel, expected }) => {
      const { adapter, bot } = await setup();
      const route: InkboxRoute =
        channel === "imessage"
          ? {
              identityId: identity.id,
              channel,
              conversationId: "reaction-imessage",
              isGroup: false,
            }
          : {
              identityId: identity.id,
              channel,
              connectionId: "connection-reactions",
              conversationId: "CREACTIONS",
              threadTs: "123.456",
            };
      const add = vi
        .spyOn(adapter.transport, "addReaction")
        .mockResolvedValue(undefined);
      const remove = vi
        .spyOn(adapter.transport, "removeReaction")
        .mockResolvedValue(undefined);
      const threadId = adapter.encodeThreadId(route);
      const message = adapter.parseMessage({
        route,
        id: "native-message",
        text: "hello",
        authorId: "sender",
        isMe: false,
        createdAt: new Date(),
      });
      await adapter.addReaction(threadId, message.id, emoji.thumbs_up);
      await adapter.removeReaction(threadId, message.id, emoji.thumbs_up);
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining(route),
        "native-message",
        expected,
      );
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining(route),
        "native-message",
        expected,
      );
      await bot.shutdown();
    },
  );

  it("serializes authenticated attachment references without credentials and rehydrates after restart", async () => {
    const { adapter, bot } = await setup();
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "email",
      emailAddress: identity.emailAddress,
      threadId: "attachment-thread",
    };
    const reference = {
      channel: "email" as const,
      messageId: "email-message",
      filename: "report.pdf",
    };
    vi.spyOn(adapter.transport, "getMessage").mockResolvedValue({
      id: "email-message",
      text: "Attached",
      authorId: "sender@example.com",
      isMe: false,
      createdAt: new Date(),
      raw: {},
      attachments: [
        { name: "report.pdf", mimeType: "application/pdf", size: 4, reference },
      ],
    });
    const message = await adapter.fetchMessage(
      adapter.encodeThreadId(route),
      "email-message",
    );
    expect(message.attachments[0].fetchData).toBeTypeOf("function");
    const serialized = JSON.stringify(message.toJSON());
    expect(serialized).not.toContain("test-key");
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("apiKey");
    expect(serialized).not.toContain("signingSecret");
    expect(serialized).not.toContain("fetchData");
    const restarted = createInkboxAdapter({
      apiKey: () => "replacement-key",
      agentHandle: "assistant",
      signingSecret: secret,
    });
    const download = vi
      .spyOn(restarted.transport, "attachment")
      .mockResolvedValue(Buffer.from("%PDF"));
    const restored = Message.fromJSON(JSON.parse(serialized));
    const attachment = restarted.rehydrateAttachment(restored.attachments[0]);
    expect(await attachment.fetchData!()).toEqual(Buffer.from("%PDF"));
    expect(download).toHaveBeenCalledWith(route, reference);
    expect(attachment.name).toBe("report.pdf");
    expect(attachment.mimeType).toBe("application/pdf");
    await bot.shutdown();
  });

  it("hydrates every transcript page before dispatching an abridged call", async () => {
    const { adapter, bot, handler } = await setup();
    const history = vi
      .spyOn(adapter.transport, "history")
      .mockResolvedValueOnce({
        messages: [
          {
            id: "line-1",
            text: "First full entry",
            authorId: "remote",
            isMe: false,
            createdAt: new Date(),
            raw: {},
          },
        ],
        nextCursor: "next-page",
      })
      .mockResolvedValueOnce({
        messages: [
          {
            id: "line-2",
            text: "Last full entry",
            authorId: "agent",
            isMe: true,
            createdAt: new Date(),
            raw: {},
          },
        ],
      });
    const response = await bot.webhooks.inkbox(
      signed(
        event("call.ended", {
          call: {
            id: "call-full",
            remote_phone_number: "+12025550123",
            direction: "inbound",
            status: "completed",
          },
          transcript: {
            abridged: true,
            entries: [{ party: "remote", text: "Truncated excerpt" }],
          },
        }),
      ),
    );
    expect(response.status).toBe(200);
    expect(history).toHaveBeenNthCalledWith(
      1,
      { identityId: identity.id, channel: "voice", callId: "call-full" },
      { limit: 100, cursor: undefined, direction: "forward" },
    );
    expect(history).toHaveBeenNthCalledWith(
      2,
      { identityId: identity.id, channel: "voice", callId: "call-full" },
      { limit: 100, cursor: "next-page", direction: "forward" },
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1].text).toBe(
      "Completed call transcript\nremote: First full entry\nagent: Last full entry",
    );
    await bot.shutdown();
  });
});

describe("persistent email retry routing", () => {
  it("reuses the first reply anchor after an uncertain send and adapter restart", async () => {
    const { adapter, bot } = await setup();
    const route: Extract<InkboxRoute, { channel: "email" }> = {
      identityId: identity.id,
      channel: "email",
      emailAddress: identity.emailAddress,
      threadId: "email-retry-thread",
    };
    const firstAnchor = { ...route, anchorMessageId: "original-anchor" };
    const laterAnchor = { ...route, anchorMessageId: "later-arrival" };
    const prepare = vi
      .spyOn(adapter.transport, "prepareEmailReply")
      .mockResolvedValue(firstAnchor);
    const failedSend = vi
      .spyOn(adapter.transport, "send")
      .mockRejectedValue(new Error("Connection ended before response"));
    const threadId = adapter.encodeThreadId(route);
    await expect(
      adapter.send(threadId, "Reply", { idempotencyKey: "retry-operation" }),
    ).rejects.toThrow("Connection ended before response");
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(failedSend).toHaveBeenCalledWith(firstAnchor, {
      text: "Reply",
      idempotencyKey: "retry-operation",
    });

    const restarted = createInkboxAdapter({
      apiKey: "replacement-key",
      agentHandle: "assistant",
      signingSecret: secret,
    });
    vi.spyOn(restarted.transport, "identity").mockResolvedValue(
      identity as never,
    );
    await restarted.initialize(bot);
    const prepareAfterRestart = vi
      .spyOn(restarted.transport, "prepareEmailReply")
      .mockResolvedValue(laterAnchor);
    const send = vi
      .spyOn(restarted.transport, "send")
      .mockResolvedValue({ id: "sent-email", raw: {} });
    await restarted.send(threadId, "Reply", {
      idempotencyKey: "retry-operation",
    });
    expect(prepareAfterRestart).not.toHaveBeenCalled();
    expect(send).toHaveBeenNthCalledWith(1, firstAnchor, {
      text: "Reply",
      idempotencyKey: "retry-operation",
    });

    await restarted.send(threadId, "A new reply", {
      idempotencyKey: "new-operation",
    });
    expect(prepareAfterRestart).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(2, laterAnchor, {
      text: "A new reply",
      idempotencyKey: "new-operation",
    });
    await bot.shutdown();
  });
});

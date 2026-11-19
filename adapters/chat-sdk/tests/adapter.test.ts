import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { Chat, Message, emoji } from "chat";
import { createMemoryState } from "@chat-adapter/state-memory";
import {
  createInkboxAdapter,
  createVoiceNoteRecoveryRequest,
  type InkboxRoute,
  type InkboxAdapterOptions,
} from "../src/index.js";
import { normalizeEvent } from "../src/events.js";

const identity = { id: "identity-test", emailAddress: "assistant@example.com" };
const secret = "test-signing-secret";
const sendKey = (key: string) => createHash("sha256").update(key).digest("hex");
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
async function setup(
  options: Partial<InkboxAdapterOptions> = {},
  concurrency?: "concurrent",
  state = createMemoryState(),
) {
  const adapter = createInkboxAdapter({
    apiKey: "test-key",
    agentHandle: "assistant",
    signingSecret: secret,
    ...options,
  });
  vi.spyOn(adapter.transport, "identity").mockResolvedValue(identity as never);
  const bot = new Chat({
    userName: "assistant",
    adapters: { inkbox: adapter },
    state,
    ...(concurrency ? { concurrency } : {}),
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

describe("voice-note completion routing", () => {
  function note(
    channel: "text" | "imessage",
    status: string,
    transcript?: string,
  ) {
    const item = {
      id: "source",
      direction: "inbound",
      conversation_id: "chat-one",
      sender_phone_number: "+12025550123",
      sender_number: "+12025550123",
      content: "typed caption",
      text: "typed caption",
      media: [
        { content_type: "image/png" },
        {
          id: "recording",
          content_type: "audio/mp4",
          transcription: { status, text: transcript ?? null },
        },
      ],
    };
    const data =
      channel === "text" ? { text_message: item } : { message: item };
    return {
      original: event(channel + ".received", data),
      completion: event("message.transcription_finished", {
        channel,
        message_id: item.id,
        ...data,
      }),
    };
  }

  it.each(["text", "imessage"] as const)(
    "enriches the original %s after an early signed completion, without a second turn",
    async (channel) => {
      const admission = vi.fn(() => true);
      const { bot, handler, adapter } = await setup({ onMessage: admission });
      const lookup = vi.spyOn(adapter.transport, "getMessage");
      const { original } = note(channel, "pending");
      const { completion } = note(channel, "completed", "audio words");
      expect((await bot.webhooks.inkbox(signed(completion))).status).toBe(200);
      expect(handler).not.toHaveBeenCalled();
      await bot.webhooks.inkbox(signed(original));
      expect(handler).toHaveBeenCalledTimes(1);
      await bot.webhooks.inkbox(signed(completion));
      await bot.webhooks.inkbox(signed(original));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(admission.mock.calls[0][0].text).toBe("typed caption");
      const message = handler.mock.calls[0][1];
      expect(message.text).toBe(
        "typed caption\n\n[Voice note 2 — automatically transcribed]\naudio words",
      );
      expect(message.raw.id).toBe("source");
      expect(message.raw.text).toBe("typed caption");
      expect(message.attachments).toHaveLength(2);
      expect(lookup).not.toHaveBeenCalled();
      await bot.shutdown();
    },
  );

  it.each([undefined, "", "  "])(
    "labels a completed silent recording as no speech, preserving caption and attachments",
    async (text) => {
      const { bot, handler } = await setup();
      const { original } = note("imessage", "completed", text);
      await bot.webhooks.inkbox(signed(original));
      const message = handler.mock.calls[0][1];
      expect(message.text).toBe("typed caption\n\n[Voice note 2: no speech detected]");
      expect(message.attachments).toHaveLength(2);
      await bot.shutdown();
    },
  );

  it.each(["completion", "deadline"])(
    "accepts before ACK without waitUntil and recovers on %s in a fresh Chat",
    async (wake) => {
      vi.useFakeTimers();
      const state = createMemoryState();
      try {
        const first = await setup({}, "concurrent", state);
        const original = note("imessage", "pending").original;
        const { completion } = note("imessage", "completed", "spoken");
        // No time advances and no request-scoped background callback is supplied.
        const now = Date.now();
        expect((await first.bot.webhooks.inkbox(signed(original))).status).toBe(
          200,
        );
        expect(Date.now()).toBe(now);
        expect(first.handler).not.toHaveBeenCalled();
        await first.bot.shutdown();

        const fresh = await setup({}, "concurrent", state);
        const lookup = vi
          .spyOn(fresh.adapter.transport, "getMessage")
          .mockImplementation(() => new Promise(() => {}));
        const tick = () =>
          fresh.bot.webhooks.inkbox(
            createVoiceNoteRecoveryRequest(
              "https://example.com/webhook",
              "whsec_" + secret,
            ),
          );
        if (wake === "completion") {
          expect((await fresh.bot.webhooks.inkbox(signed(completion))).status).toBe(200);
          expect(fresh.handler).toHaveBeenCalledTimes(1);
          expect(lookup).not.toHaveBeenCalled();
        } else {
          await vi.advanceTimersByTimeAsync(55_000);
          await fresh.bot.webhooks.inkbox(signed(original));
          const recovery = tick();
          await vi.advanceTimersByTimeAsync(4_999);
          expect(lookup).not.toHaveBeenCalled();
          await vi.advanceTimersByTimeAsync(10_001);
          await recovery;
          expect(lookup).toHaveBeenCalledTimes(1);
        }
        await fresh.bot.webhooks.inkbox(signed(original));
        await fresh.bot.webhooks.inkbox(signed(completion));
        await tick();
        expect(fresh.handler).toHaveBeenCalledTimes(1);
        const message = fresh.handler.mock.calls[0][1];
        expect(message.raw.text).toBe("typed caption");
        expect(message.text).toContain(
          wake === "completion" ? "spoken" : "transcript unavailable",
        );
        expect(message.raw.route.conversationId).toBe("chat-one");
        expect(message.attachments).toHaveLength(2);
        await fresh.bot.shutdown();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("does not acknowledge a pending original when persistent admission fails", async () => {
    const state = createMemoryState();
    const { bot, handler } = await setup({}, "concurrent", state);
    vi.spyOn(state, "set").mockRejectedValueOnce(
      new Error("store unavailable"),
    );
    await expect(
      bot.webhooks.inkbox(signed(note("text", "pending").original)),
    ).rejects.toThrow("store unavailable");
    expect(handler).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it("waits for the matching signed event, and never wakes for the completion itself", async () => {
    vi.useFakeTimers();
    const { bot, adapter, handler } = await setup();
    try {
      const lookup = vi.spyOn(adapter.transport, "getMessage");
      const tasks: Promise<unknown>[] = [];
      const pending = note("text", "pending").original;
      const completed = note("text", "completed", "arrived on time").completion;
      await bot.webhooks.inkbox(signed(pending), {
        waitUntil: (task) => tasks.push(task),
      });
      await bot.webhooks.inkbox(
        signed(note("imessage", "completed", "different channel").completion),
      );
      await vi.advanceTimersByTimeAsync(58_000);
      expect(handler).not.toHaveBeenCalled();
      expect(lookup).not.toHaveBeenCalled();
      await bot.webhooks.inkbox(signed(completed));
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.all(tasks);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler.mock.calls[0][1].text).toContain("arrived on time");
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      await bot.shutdown();
      vi.useRealTimers();
    }
  });

  it.each([true, false])(
    "polls once after 60 seconds and delivers the original (poll failed: %s)",
    async (failed) => {
      vi.useFakeTimers();
      const { bot, adapter, handler } = await setup();
      try {
        const lookup = vi.spyOn(adapter.transport, "getMessage");
        if (failed) lookup.mockRejectedValue(new Error("Read failed"));
        else
          lookup.mockResolvedValue({
            id: "source",
            text: "not the original",
            isMe: false,
            authorId: "other",
            raw: {},
            createdAt: new Date(),
            voiceNotes: [
              {
                position: 2,
                attachmentId: "recording",
                status: "completed",
                errorCode: null,
                text: "polled transcript",
              },
            ],
          });
        const { original } = note("imessage", "pending");
        const tasks: Promise<unknown>[] = [];
        await bot.webhooks.inkbox(signed(original), {
          waitUntil: (task) => tasks.push(task),
        });
        await vi.advanceTimersByTimeAsync(59_999);
        expect(lookup).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        await Promise.all(tasks);
        await bot.webhooks.inkbox(signed(original));
        await bot.webhooks.inkbox(
          signed(note("imessage", "completed", "late").completion),
        );
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(handler).toHaveBeenCalledTimes(1);
        const message = handler.mock.calls[0][1];
        expect(message.text).toContain(
          failed ? "transcript unavailable" : "polled transcript",
        );
        expect(message.raw.text).toBe("typed caption");
        expect(message.attachments).toHaveLength(2);
      } finally {
        await bot.shutdown();
        vi.useRealTimers();
      }
    },
  );
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
    { identityId: identity.id, channel: "a2a", contextId: "context" },
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
    await bot.webhooks.inkbox(signed(incoming()));
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
        idempotencyKey: sendKey("stable-operation-key"),
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
      adapter.send(
        adapter.encodeThreadId(routes[4]),
        {
          raw: "file",
          files: [{ filename: "test.txt", data: Buffer.from("content") }],
        },
        { a2aTaskId: "task" },
      ),
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
  it("separates Slack connection/thread and preserves other bot messages", () => {
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
    ).toMatchObject({ isBot: true, authorId: "user" });
  });
  it("normalizes A2A user parts without accepting self echoes", () => {
    const data = {
      task_id: "task",
      context_id: "context",
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
      idempotencyKey: sendKey("retry-operation"),
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
      idempotencyKey: sendKey("retry-operation"),
    });

    await restarted.send(threadId, "A new reply", {
      idempotencyKey: "new-operation",
    });
    expect(prepareAfterRestart).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenNthCalledWith(2, laterAnchor, {
      text: "A new reply",
      idempotencyKey: sendKey("new-operation"),
    });
    await bot.shutdown();
  });
});

describe("request lifecycle and recoverable initialization", () => {
  it("initializes without network and retries a transient identity failure on the next request", async () => {
    const { adapter, bot, handler } = await setup();
    expect(adapter.transport.identity).not.toHaveBeenCalled();
    vi.mocked(adapter.transport.identity).mockRejectedValueOnce(
      new Error("Temporary identity lookup failure"),
    );
    await expect(bot.webhooks.inkbox(signed(incoming()))).rejects.toThrow(
      "Temporary identity lookup failure",
    );
    expect((await bot.webhooks.inkbox(signed(incoming()))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    await bot.shutdown();
  });

  it("does not acknowledge or register background work when email hydration fails", async () => {
    const { adapter, bot, handler } = await setup();
    vi.spyOn(adapter.transport, "getMessage").mockRejectedValue(
      new Error("Email unavailable"),
    );
    const waitUntil = vi.fn();
    const payload = event("message.received", {
      message: {
        id: "email-failure",
        thread_id: "thread-failure",
        direction: "inbound",
        from_address: "sender@example.com",
        snippet: "Preview",
      },
    });
    await expect(
      bot.webhooks.inkbox(signed(payload), { waitUntil }),
    ).rejects.toThrow("Email unavailable");
    expect(waitUntil).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it.each([false, true])(
    "honors propagateHandlerErrors=%s for waitUntil promises",
    async (propagateHandlerErrors) => {
      const { bot, handler } = await setup();
      handler.mockRejectedValue(new Error("Handler failed"));
      const pending: Promise<unknown>[] = [];
      expect(
        (
          await bot.webhooks.inkbox(signed(incoming()), {
            propagateHandlerErrors,
            waitUntil: (task) => {
              pending.push(task);
              void task.catch(() => undefined);
            },
          })
        ).status,
      ).toBe(200);
      expect(pending).toHaveLength(1);
      if (propagateHandlerErrors)
        await expect(pending[0]).rejects.toThrow("Handler failed");
      else await expect(pending[0]).resolves.toBeUndefined();
      await bot.shutdown();
    },
  );
});

describe("buffered streamed responses", () => {
  it("posts the complete stream once through real Chat without placeholder or edits", async () => {
    const { adapter, bot, handler } = await setup();
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "stream-result", raw: {} });
    const edit = vi.spyOn(adapter.transport, "editMessage");
    async function* chunks() {
      yield "Complete ";
      yield "reply";
    }
    handler.mockImplementation(async (thread) => {
      await thread.post(chunks());
    });
    expect((await bot.webhooks.inkbox(signed(incoming()))).status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ channel: "sms" }),
      expect.objectContaining({ text: "Complete reply" }),
    );
    expect(edit).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it("does not send a partial response when the stream fails", async () => {
    const { adapter, bot, handler } = await setup();
    const send = vi.spyOn(adapter.transport, "send");
    async function* chunks() {
      yield "Unfinished";
      throw new Error("Stream interrupted");
    }
    handler.mockImplementation(async (thread) => {
      await thread.post(chunks());
    });
    await expect(bot.webhooks.inkbox(signed(incoming()))).rejects.toThrow(
      "Stream interrupted",
    );
    expect(send).not.toHaveBeenCalled();
    await bot.shutdown();
  });
});

describe("explicit email reply routing", () => {
  it("keeps each concurrent explicit reply anchored to its triggering email", async () => {
    const { adapter, bot, handler } = await setup({}, "concurrent");
    vi.spyOn(adapter.transport, "prepareEmailReply").mockImplementation(
      async (route) => ({
        ...route,
        anchorMessageId: route.anchorMessageId ?? "unexpected-anchor",
      }),
    );
    vi.spyOn(adapter.transport, "getMessage").mockImplementation(
      async (_route, id) => ({
        id,
        text: id,
        authorId: "sender@example.com",
        isMe: false,
        createdAt: new Date(),
        raw: {},
      }),
    );
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "email-reply", raw: {} });
    let started!: () => void;
    let release!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    handler.mockImplementation(async (thread, message) => {
      if (message.raw.id === "private-email") {
        started();
        await gate;
      }
      await adapter.send(thread.id, `Reply to ${message.raw.id}`, {
        replyToMessageId: message.id,
        idempotencyKey: `reply-${message.raw.id}`,
      });
    });
    const payload = (id: string) => ({
      ...event("message.received", {
        message: {
          id,
          thread_id: "shared-thread",
          direction: "inbound",
          from_address: "sender@example.com",
          body: id,
        },
      }),
      id: `evt-${id}`,
    });
    const first = bot.webhooks.inkbox(signed(payload("private-email")));
    try {
      await firstStarted;
      expect(
        (await bot.webhooks.inkbox(signed(payload("group-email")))).status,
      ).toBe(200);
    } finally {
      release();
    }
    expect((await first).status).toBe(200);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ anchorMessageId: "private-email" }),
      expect.objectContaining({ text: "Reply to private-email" }),
    );
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ anchorMessageId: "group-email" }),
      expect.objectContaining({ text: "Reply to group-email" }),
    );
    await bot.shutdown();
  });
});

describe("A2A default reply intent", () => {
  it("keeps tasks in one context on one thread and preserves each message's task", async () => {
    const { adapter, bot, handler } = await setup();
    const deliver = (taskId: string, contextId = "shared-context") =>
      bot.webhooks.inkbox(
        signed(
          event("a2a.task.created", {
            task_id: taskId,
            context_id: contextId,
            message_id: `message-${taskId}`,
            caller: { identity_id: "remote-agent" },
            parts: [{ text: `Work for ${taskId}` }],
          }),
        ),
      );
    await deliver("first-task");
    await deliver("second-task");
    await deliver("third-task", "other-context");
    const messages = handler.mock.calls.map((call) => call[1]);
    expect(messages[0].threadId).toBe(messages[1].threadId);
    expect(messages[2].threadId).not.toBe(messages[0].threadId);
    expect(messages.map((message) => message.raw.route.taskId)).toEqual([
      "first-task",
      "second-task",
      "third-task",
    ]);
    expect(adapter.decodeThreadId(messages[0].threadId)).toEqual({
      identityId: identity.id,
      channel: "a2a",
      contextId: "shared-context",
    });
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "reply", raw: {} });
    // The earlier task remains the destination after a second task arrived.
    await adapter.send(messages[0].threadId, "First task result", {
      a2aTaskId: messages[0].raw.route.taskId,
      a2aIntent: "complete",
    });
    expect(send).toHaveBeenCalledWith(
      {
        identityId: identity.id,
        channel: "a2a",
        contextId: "shared-context",
        taskId: "first-task",
      },
      expect.objectContaining({
        text: "First task result",
        a2aIntent: "complete",
      }),
    );
    await expect(
      adapter.postMessage(messages[0].threadId, "Unbound reply"),
    ).rejects.toThrow("originating a2aTaskId");
    expect(send).toHaveBeenCalledTimes(1);
    await bot.shutdown();
  });

  it("uses the configured intent for task-bound sends while preserving explicit overrides", async () => {
    const { adapter, bot } = await setup({ defaultA2AIntent: "complete" });
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "a2a",
      contextId: "context-intent",
      taskId: "task-intent",
    };
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "reply-id", raw: {} });
    const threadId = adapter.encodeThreadId(route);
    await adapter.send(threadId, "Finished", { a2aTaskId: "task-intent" });
    expect(send).toHaveBeenNthCalledWith(
      1,
      route,
      expect.objectContaining({ text: "Finished", a2aIntent: "complete" }),
    );
    await adapter.send(threadId, "Question", {
      a2aTaskId: "task-intent",
      a2aIntent: "ask_caller",
    });
    expect(send).toHaveBeenNthCalledWith(
      2,
      route,
      expect.objectContaining({ text: "Question", a2aIntent: "ask_caller" }),
    );
    await bot.shutdown();
  });
});

describe("durable phone attachment references", () => {
  it.each(["sms", "imessage"] as const)(
    "serializes %s media without the original URL and downloads after rehydration",
    async (channel) => {
      const { adapter, bot } = await setup();
      const originalUrl =
        "https://example.com/media/original?token=temporary-media-token";
      const record = {
        id: "phone-media-message",
        direction: "inbound",
        conversation_id: "phone-media-conversation",
        sender_phone_number: "+12025550123",
        sender_number: "+12025550123",
        remote_number: "+12025550123",
        text: "Photo",
        content: "Photo",
        is_group: false,
        media: [{ url: originalUrl, content_type: "image/png", size: 4 }],
      };
      const payload = event(
        channel === "sms" ? "text.received" : "imessage.received",
        channel === "sms" ? { text_message: record } : { message: record },
      );
      const normalized = normalizeEvent(payload, identity)!;
      expect(JSON.stringify(normalized.event)).toContain(originalUrl);
      const message = adapter.parseMessage(normalized);
      const serialized = JSON.stringify(message.toJSON());
      expect(serialized).not.toContain(originalUrl);
      expect(serialized).not.toContain("temporary-media-token");
      expect(serialized).not.toContain("test-key");
      expect(serialized).not.toContain(secret);
      const restored = Message.fromJSON(JSON.parse(serialized));
      expect(restored.attachments[0].url).toBeUndefined();
      expect(restored.attachments[0].fetchData).toBeUndefined();
      const reference = { channel, messageId: "phone-media-message", index: 0 };
      expect(
        JSON.parse(restored.attachments[0].fetchMetadata!.reference),
      ).toEqual(reference);
      expect(restored.attachments[0].fetchMetadata!.route).toBe(
        message.threadId,
      );
      const restarted = createInkboxAdapter({
        apiKey: "replacement-key",
        agentHandle: "assistant",
        signingSecret: secret,
      });
      const download = vi
        .spyOn(restarted.transport, "attachment")
        .mockResolvedValue(Buffer.from([0, 1, 2, 3]));
      const attachment = restarted.rehydrateAttachment(restored.attachments[0]);
      expect(await attachment.fetchData!()).toEqual(Buffer.from([0, 1, 2, 3]));
      expect(download).toHaveBeenCalledWith(
        restarted.decodeThreadId(message.threadId),
        reference,
      );
      await bot.shutdown();
    },
  );
});

describe("application admission policy", () => {
  it("applies admission once to the resolved post-call messaging destination", async () => {
    const onMessage = vi.fn(
      (message: { route: { channel: string } }) => message.route.channel !== "sms",
    );
    const { adapter, bot, handler } = await setup({ onMessage });
    const destination: InkboxRoute = {
      identityId: identity.id,
      channel: "sms",
      conversationId: "conversation-test",
    };
    vi.spyOn(adapter.transport, "callConversation").mockResolvedValue(destination);
    const send = vi.spyOn(adapter.transport, "send");
    try {
      const response = await bot.webhooks.inkbox(signed(event("call.ended", {
        call: {
          id: "call-policy",
          origin: "dedicated_number",
          local_phone_number: "+12025550100",
          remote_phone_number: "+12025550123",
          direction: "inbound",
          status: "completed",
        },
        transcript: {
          entries: [{ party: "remote", text: "Please follow up." }],
          abridged: false,
        },
      })));
      expect(response.status).toBe(200);
      expect(onMessage).toHaveBeenCalledTimes(1);
      expect(onMessage).toHaveBeenCalledWith(expect.objectContaining({
        route: destination,
        id: "call:call-policy",
      }));
      expect(handler).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    } finally {
      await bot.shutdown();
    }
  });

  it("acknowledges rejected Slack bot events without dispatching but preserves A2A inputs", async () => {
    const onMessage = vi.fn(
      (message: { route: { channel: string }; isBot?: boolean }) =>
        !(message.route.channel === "slack" && message.isBot === true),
    );
    const { bot, handler } = await setup({ onMessage });
    const slack = event("slack.mention_received", {
      identity_id: identity.id,
      connection_id: "connection-test",
      conversation_id: "CBOTS",
      message_ts: "123.456",
      event: { bot_id: "BOTHER", text: "Update" },
    });
    expect((await bot.webhooks.inkbox(signed(slack))).status).toBe(200);
    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ authorId: "BOTHER", isBot: true }),
    );
    expect(handler).not.toHaveBeenCalled();
    const a2a = event("a2a.task.created", {
      task_id: "task-policy",
      context_id: "context-policy",
      message_id: "message-policy",
      caller: { identity_id: "remote-agent" },
      parts: [{ text: "Please help" }],
    });
    expect((await bot.webhooks.inkbox(signed(a2a))).status).toBe(200);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][1].author.isBot).toBe(true);
    expect(handler.mock.calls[0][1].text).toBe("Please help");
    await bot.shutdown();
  });
});

describe("forwarding refreshable SMS attachments", () => {
  it("resolves the original message reference to a fresh URL before sending", async () => {
    const { adapter, bot } = await setup();
    const normalized = normalizeEvent(
      event("text.received", {
        text_message: {
          id: "original-mms",
          direction: "inbound",
          conversation_id: "original-conversation",
          sender_phone_number: "+12025550123",
          text: "Photo",
          media: [
            {
              url: "https://example.com/expired-photo",
              content_type: "image/png",
            },
          ],
        },
      }),
      identity,
    )!;
    const message = adapter.parseMessage(normalized);
    expect(message.attachments[0].url).toBeUndefined();
    const refresh = vi
      .spyOn(adapter.transport, "attachment")
      .mockResolvedValue("https://example.com/fresh-photo");
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "forwarded-mms", raw: {} });
    const target: InkboxRoute = {
      identityId: identity.id,
      channel: "sms",
      conversationId: "destination-conversation",
    };
    await adapter.postMessage(adapter.encodeThreadId(target), {
      raw: "Forwarded",
      attachments: message.attachments,
    });
    expect(refresh).toHaveBeenCalledWith(normalized.route, {
      channel: "sms",
      messageId: "original-mms",
      index: 0,
    });
    expect(send).toHaveBeenCalledWith(
      target,
      expect.objectContaining({
        text: "Forwarded",
        mediaUrls: ["https://example.com/fresh-photo"],
      }),
    );
    await bot.shutdown();
  });

  it("rejects byte-only references instead of silently dropping SMS attachments", async () => {
    const { adapter, bot } = await setup();
    const route: InkboxRoute = {
      identityId: identity.id,
      channel: "sms",
      conversationId: "byte-conversation",
    };
    const threadId = adapter.encodeThreadId(route);
    vi.spyOn(adapter.transport, "attachment").mockResolvedValue(
      Buffer.from("bytes"),
    );
    const send = vi.spyOn(adapter.transport, "send");
    await expect(
      adapter.postMessage(threadId, {
        raw: "Forwarded",
        attachments: [
          {
            type: "file",
            fetchMetadata: {
              route: threadId,
              reference: JSON.stringify({
                channel: "sms",
                messageId: "byte-message",
                index: 0,
              }),
            },
          },
        ],
      }),
    ).rejects.toThrow("SMS forwarding requires a downloadable media URL");
    expect(send).not.toHaveBeenCalled();
    await bot.shutdown();
  });
});

describe("text-only card rendering", () => {
  it("preserves explicit approval choices on posts and edits", async () => {
    const { adapter, bot } = await setup();
    const threadId = adapter.encodeThreadId({
      identityId: identity.id,
      channel: "slack",
      connectionId: "connection",
      conversationId: "C1",
    });
    const card = {
      type: "card" as const,
      children: [
        {
          type: "actions" as const,
          children: [
            { type: "button" as const, id: "approve", label: "Approve" },
            { type: "button" as const, id: "reject", label: "Reject" },
          ],
        },
      ],
      title: "Allow this action?",
    };
    const message = {
      card,
      fallbackText: "Allow this action?\n1. Approve\n2. Reject",
    };
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "1.1", raw: {} });
    const edit = vi
      .spyOn(adapter.transport, "editMessage")
      .mockResolvedValue({ id: "1.1", raw: {} });
    const posted = await adapter.postMessage(threadId, message);
    expect(send).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: message.fallbackText }),
    );
    await adapter.editMessage(threadId, posted.id, message);
    expect(edit).toHaveBeenCalledWith(
      expect.anything(),
      "1.1",
      message.fallbackText,
    );
    const emptyFallback = { card, fallbackText: "" };
    await adapter.postMessage(threadId, emptyFallback);
    await adapter.editMessage(threadId, posted.id, emptyFallback);
    expect(send).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({ text: "*Allow this action?*" }),
    );
    expect(edit).toHaveBeenLastCalledWith(
      expect.anything(),
      "1.1",
      "*Allow this action?*",
    );
    await bot.shutdown();
  });
});

describe("persistent phone send preparation", () => {
  const route: InkboxRoute = {
    identityId: identity.id,
    channel: "imessage",
    conversationId: "media-conversation",
  };
  const fileMessage = () => ({
    raw: "Photo",
    files: [
      {
        filename: "photo.png",
        mimeType: "image/png",
        data: Buffer.from([1, 2, 3]),
      },
    ],
  });

  it("reuses uploaded media after an uncertain send and adapter restart", async () => {
    const { adapter, bot } = await setup();
    const threadId = adapter.encodeThreadId(route);
    const save = vi.spyOn(bot.getState(), "setIfNotExists");
    const upload = vi
      .spyOn(adapter.transport, "uploadMedia")
      .mockResolvedValue({
        mediaUrl: "https://example.com/first-upload",
      } as never);
    const initialSend = vi
      .spyOn(adapter.transport, "send")
      .mockRejectedValue(new Error("response lost"));
    await expect(
      adapter.send(threadId, fileMessage(), { idempotencyKey: "media-op" }),
    ).rejects.toThrow("response lost");
    const restarted = createInkboxAdapter({
      apiKey: "test-key",
      agentHandle: "assistant",
      signingSecret: secret,
    });
    await restarted.initialize(bot);
    const state = bot.getState();
    const get = state.get.bind(state);
    vi.spyOn(state, "get").mockImplementation(async (key) => {
      const record = await get(key);
      return record === null || record === undefined
        ? record
        : JSON.parse(JSON.stringify(record));
    });
    const retryUpload = vi.spyOn(restarted.transport, "uploadMedia");
    const retrySend = vi
      .spyOn(restarted.transport, "send")
      .mockResolvedValue({ id: "sent", raw: {} });
    await restarted.send(threadId, fileMessage(), {
      idempotencyKey: "media-op",
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(
      expect.stringContaining("inkbox:phone-send:"),
      expect.objectContaining({
        fingerprint: expect.any(String),
        input: expect.objectContaining({ text: "Photo" }),
      }),
      604800000,
    );
    expect(retryUpload).not.toHaveBeenCalled();
    expect(retrySend.mock.calls[0]).toEqual(initialSend.mock.calls[0]);
    await expect(
      restarted.send(
        threadId,
        { ...fileMessage(), raw: "Changed" },
        { idempotencyKey: "media-op" },
      ),
    ).rejects.toThrow("different message content");
    await expect(
      restarted.send(
        threadId,
        {
          raw: "Photo",
          files: [
            {
              filename: "photo.png",
              mimeType: "image/png",
              data: Buffer.from([9]),
            },
          ],
        },
        { idempotencyKey: "media-op" },
      ),
    ).rejects.toThrow("different message content");
    expect(retrySend).toHaveBeenCalledTimes(1);
    // Removing all media uses the ordinary text path; the SDK retains key validation.
    retrySend.mockRejectedValueOnce(new Error("409 idempotency_key_reused"));
    await expect(
      restarted.send(threadId, "Photo", { idempotencyKey: "media-op" }),
    ).rejects.toThrow("409 idempotency_key_reused");
    expect(retrySend).toHaveBeenLastCalledWith(
      {
        ...route,
        isGroup: false,
        threadId: undefined,
        replyToMessageId: undefined,
      },
      expect.objectContaining({
        text: "Photo",
        idempotencyKey: sendKey("media-op"),
      }),
    );
    expect(retryUpload).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it("does not refresh an SMS forwarding URL on application retry", async () => {
    const { adapter, bot } = await setup();
    const sms: InkboxRoute = {
      identityId: identity.id,
      channel: "sms",
      conversationId: "sms-conversation",
    };
    const threadId = adapter.encodeThreadId(sms);
    const message = {
      raw: "Photo",
      attachments: [
        {
          type: "image" as const,
          fetchMetadata: {
            route: threadId,
            reference: JSON.stringify({
              channel: "sms",
              messageId: "original",
              index: 0,
            }),
          },
        },
      ],
    };
    const refresh = vi
      .spyOn(adapter.transport, "attachment")
      .mockResolvedValueOnce("https://example.com/first-url")
      .mockResolvedValue("https://example.com/changed-url");
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "sent", raw: {} });
    await adapter.send(threadId, message, { idempotencyKey: "forward" });
    await adapter.send(threadId, message, { idempotencyKey: "forward" });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    await bot.shutdown();
  });

  it("rejects concurrent preparation and allows the same-key retry after preparation", async () => {
    const { adapter, bot } = await setup();
    const threadId = adapter.encodeThreadId(route);
    let finish!: (value: never) => void;
    let started!: () => void;
    const uploading = new Promise<void>((resolve) => {
      started = resolve;
    });
    const upload = vi
      .spyOn(adapter.transport, "uploadMedia")
      .mockImplementation(async () => {
        started();
        return new Promise((resolve) => {
          finish = resolve;
        });
      });
    const send = vi
      .spyOn(adapter.transport, "send")
      .mockResolvedValue({ id: "sent", raw: {} });
    const first = adapter.send(threadId, fileMessage(), {
      idempotencyKey: "concurrent",
    });
    await uploading;
    await expect(
      adapter.send(threadId, fileMessage(), { idempotencyKey: "concurrent" }),
    ).rejects.toThrow("preparation is in progress");
    finish({ mediaUrl: "https://example.com/upload" } as never);
    await first;
    await adapter.send(threadId, fileMessage(), {
      idempotencyKey: "concurrent",
    });
    expect(upload).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
    await bot.shutdown();
  });

  it.each([true, false])(
    "fences input across an expired preparation lock (changed=%s)",
    async (changed) => {
      const { adapter, bot } = await setup();
      const threadId = adapter.encodeThreadId(route);
      let finish!: (value: never) => void;
      let started!: () => void;
      const uploading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const upload = vi
        .spyOn(adapter.transport, "uploadMedia")
        .mockImplementationOnce(async () => {
          started();
          return new Promise((resolve) => {
            finish = resolve;
          });
        })
        .mockResolvedValue({
          mediaUrl: "https://example.com/second-upload",
        } as never);
      const send = vi
        .spyOn(adapter.transport, "send")
        .mockResolvedValue({ id: "sent", raw: {} });
      const acquire = vi.spyOn(bot.getState(), "acquireLock");
      const first = adapter.send(threadId, fileMessage(), {
        idempotencyKey: "expired-lock",
      });
      await uploading;
      await bot.getState().forceReleaseLock(acquire.mock.calls[0][0]);
      const second = adapter.send(
        threadId,
        changed ? { ...fileMessage(), raw: "Changed" } : fileMessage(),
        { idempotencyKey: "expired-lock" },
      );
      if (changed) {
        await expect(second).rejects.toThrow("different message content");
        expect(upload).toHaveBeenCalledTimes(1);
        expect(send).not.toHaveBeenCalled();
      } else {
        await second;
        expect(upload).toHaveBeenCalledTimes(2);
      }
      finish({ mediaUrl: "https://example.com/first-upload" } as never);
      await first;
      if (changed) {
        expect(send).toHaveBeenCalledTimes(1);
        expect(send).toHaveBeenCalledWith(
          expect.objectContaining(route),
          expect.objectContaining({
            mediaUrls: ["https://example.com/first-upload"],
          }),
        );
      } else {
        expect(send).toHaveBeenCalledTimes(2);
        expect(send.mock.calls[0]).toEqual(send.mock.calls[1]);
        expect(send.mock.calls[0][1].mediaUrls).toEqual([
          "https://example.com/second-upload",
        ]);
      }
      await bot.shutdown();
    },
  );

  it("never sends when saving the prepared payload fails after upload", async () => {
    const { adapter, bot } = await setup();
    const upload = vi
      .spyOn(adapter.transport, "uploadMedia")
      .mockResolvedValue({ mediaUrl: "https://example.com/upload" } as never);
    const state = bot.getState();
    const save = state.setIfNotExists.bind(state);
    vi.spyOn(state, "setIfNotExists").mockImplementation(
      async (key, value, ttl) => {
        if (key.endsWith(":fingerprint")) return save(key, value, ttl);
        throw new Error("payload save unavailable");
      },
    );
    const send = vi.spyOn(adapter.transport, "send");
    await expect(
      adapter.send(adapter.encodeThreadId(route), fileMessage(), {
        idempotencyKey: "payload-state-failure",
      }),
    ).rejects.toThrow("payload save unavailable");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    await bot.shutdown();
  });

  it("never sends when durable preparation cannot be saved", async () => {
    const { adapter, bot } = await setup();
    vi.spyOn(adapter.transport, "uploadMedia").mockResolvedValue({
      mediaUrl: "https://example.com/upload",
    } as never);
    vi.spyOn(bot.getState(), "setIfNotExists").mockRejectedValue(
      new Error("state unavailable"),
    );
    const send = vi.spyOn(adapter.transport, "send");
    await expect(
      adapter.send(adapter.encodeThreadId(route), fileMessage(), {
        idempotencyKey: "state-failure",
      }),
    ).rejects.toThrow("state unavailable");
    expect(send).not.toHaveBeenCalled();
    await bot.shutdown();
  });
});

describe("keyed text-only phone sends", () => {
  it.each(["sms", "imessage"] as const)(
    "sends %s text without initialization or state access",
    async (channel) => {
      const adapter = createInkboxAdapter({
        apiKey: "test-key",
        agentHandle: "assistant",
        signingSecret: secret,
      });
      const route: InkboxRoute = {
        identityId: identity.id,
        channel,
        conversationId: "text-only",
      };
      const send = vi
        .spyOn(adapter.transport, "send")
        .mockResolvedValue({ id: "sent", raw: {} });
      const threadId = adapter.encodeThreadId(route);
      await adapter.send(threadId, "Hello", {
        idempotencyKey: "text-operation",
      });
      expect(send).toHaveBeenCalledWith(
        channel === "imessage"
          ? {
              ...route,
              isGroup: false,
              threadId: undefined,
              replyToMessageId: undefined,
            }
          : route,
        expect.objectContaining({
          text: "Hello",
          idempotencyKey: sendKey("text-operation"),
        }),
      );
      const { bot } = await setup();
      await adapter.initialize(bot);
      const save = vi.spyOn(bot.getState(), "setIfNotExists");
      const lock = vi.spyOn(bot.getState(), "acquireLock");
      await adapter.send(threadId, "Hello", {
        idempotencyKey: "text-operation",
      });
      expect(save).not.toHaveBeenCalled();
      expect(lock).not.toHaveBeenCalled();
      await bot.shutdown();
    },
  );
});

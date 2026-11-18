import { describe, expect, it } from "vitest";
import { normalizeEvent } from "../src/events.js";

const identity = { id: "identity-test", emailAddress: "assistant@example.com" };
const event = (event_type: string, data: unknown) => ({
  id: "evt-test",
  event_type,
  timestamp: "2026-01-01T00:00:00Z",
  data,
});

describe("channel message content", () => {
  it("preserves current A2A text and structured data parts without kind discriminators", () => {
    const message = normalizeEvent(
      event("a2a.task.created", {
        task_id: "task-test",
        context_id: "context-test",
        message_id: "message-test",
        caller: { identity_id: "caller-test" },
        parts: [{ text: "Please prioritize" }, { data: { priority: 1 } }],
      }),
      identity,
    );
    expect(message?.text).toBe('Please prioritize\n{"priority":1}');
    expect(message?.authorId).toBe("caller-test");
  });

  it.each(["a2a.task.created", "a2a.task.message"])(
    "retains context and task routing for %s",
    (type) => {
      const first = normalizeEvent(
        event(type, {
          context_id: "context-test",
          task_id: "task-one",
          message_id: "message-one",
          caller: { identity_id: "caller-test" },
          parts: [{ text: "Hello" }],
        }),
        identity,
      )!;
      const second = normalizeEvent(
        event(type, {
          context_id: "context-test",
          task_id: "task-two",
          message_id: "message-two",
          caller: { identity_id: "caller-test" },
          parts: [{ text: "Next" }],
        }),
        identity,
      )!;
      expect(first.route).toEqual({
        channel: "a2a",
        identityId: identity.id,
        contextId: "context-test",
        taskId: "task-one",
      });
      expect(second.route).toEqual({ ...first.route, taskId: "task-two" });
      expect(first.id).toBe("message-one");
      expect(second.id).toBe("message-two");
    },
  );

  it.each(["context_id", "task_id"])(
    "rejects an A2A event without %s",
    (field) => {
      const data: Record<string, unknown> = {
        context_id: "context-test",
        task_id: "task-test",
        caller: { identity_id: "caller-test" },
        parts: [{ text: "Hello" }],
      };
      delete data[field];
      expect(() =>
        normalizeEvent(event("a2a.task.created", data), identity),
      ).toThrow();
    },
  );

  it("preserves authenticated Slack file references without download credentials", () => {
    const message = normalizeEvent(
      event("slack.dm_received", {
        identity_id: identity.id,
        connection_id: "connection-test",
        conversation_id: "conversation-test",
        message_ts: "123.456",
        actor_id: "user-test",
        event: {
          text: "",
          files: [
            {
              id: "file-test",
              name: "image.png",
              mimetype: "image/png",
              size: 12,
            },
          ],
        },
      }),
      identity,
    );
    expect(message?.attachments).toEqual([
      {
        type: "image",
        name: "image.png",
        mimeType: "image/png",
        size: 12,
        fetchMetadata: {
          reference: JSON.stringify({
            channel: "slack",
            connectionId: "connection-test",
            fileId: "file-test",
          }),
        },
      },
    ]);
  });

  it("marks omitted and truncated transcript content instead of inventing empty turns", () => {
    const message = normalizeEvent(
      event("call.ended", {
        call: {
          id: "call-test",
          direction: "inbound",
          status: "completed",
          remote_phone_number: "+12025550123",
        },
        transcript: {
          abridged: true,
          entries: [
            { party: "remote", text: "Hello" },
            { marker: "abridged", omitted_turns: 4 },
            { party: "local", text: "A partial answer", truncated: true },
          ],
        },
      }),
      identity,
    );
    expect(message?.text).toContain("[Transcript abridged: 4 turns omitted]");
    expect(message?.text).toContain("local: A partial answer [turn truncated]");
    expect(message?.text).not.toContain("speaker:");
  });
});

describe("conversation continuity", () => {
  function imessage(id: string, extra: Record<string, unknown> = {}) {
    return normalizeEvent(
      event("imessage.received", {
        message: {
          id,
          direction: "inbound",
          conversation_id: "conversation-test",
          sender_number: "+12025550123",
          thread_id: `native-${id}`,
          thread_root_message_id: id,
          content: "Hello",
          ...extra,
        },
      }),
      identity,
    )!;
  }
  function slack(id: string, extra: Record<string, unknown> = {}) {
    return normalizeEvent(
      event("slack.thread_reply_received", {
        identity_id: identity.id,
        connection_id: "connection-test",
        conversation_id: "D-test",
        message_ts: id,
        actor_id: "user-test",
        event: { text: "Hello" },
        message_kinds: ["dm"],
        ...extra,
      }),
      identity,
    )!;
  }

  it.each([false, true])(
    "keeps consecutive standalone iMessages on one conversation (group=%s)",
    (isGroup) => {
      const first = imessage("message-one", { is_group: isGroup });
      const second = imessage("message-two", { is_group: isGroup });
      expect(first.route).toEqual(second.route);
      expect(first.route).toMatchObject({
        channel: "imessage",
        conversationId: "conversation-test",
        isGroup,
      });
      expect("threadId" in first.route && first.route.threadId).toBeUndefined();
      expect(
        "replyToMessageId" in first.route && first.route.replyToMessageId,
      ).toBeUndefined();
    },
  );

  it("keeps genuine iMessage replies on their native thread", () => {
    const first = imessage("reply-one", {
      thread_id: "native-root",
      thread_root_message_id: "root",
      reply_to_message_id: "root",
    });
    const second = imessage("reply-two", {
      thread_id: "native-root",
      thread_root_message_id: "root",
      reply_to_message_id: "reply-one",
    });
    expect(first.route).toEqual(second.route);
    expect(first.route).toMatchObject({
      threadId: "native-root",
      replyToMessageId: "root",
    });
  });

  it("recognizes an explicit reply when its root metadata is absent", () => {
    expect(
      imessage("reply", {
        reply_to_message_id: "parent",
        thread_root_message_id: null,
      }).route,
    ).toMatchObject({ threadId: "native-reply" });
  });

  it("keeps Slack DM timeline posts together, including self-root metadata", () => {
    const first = slack("1.0");
    expect(slack("2.0").route).toEqual(first.route);
    expect(slack("3.0", { thread_ts: "3.0" }).route).toEqual(first.route);
    expect(first.route).toMatchObject({ threadTs: undefined });
    expect(slack("4.0", { thread_ts: "1.0" }).route).toMatchObject({
      threadTs: "1.0",
    });
  });

  it("keeps top-level Slack channel posts distinct", () => {
    expect(
      slack("1.0", { conversation_id: "C-test", message_kinds: ["channel"] })
        .route,
    ).toMatchObject({ threadTs: "1.0" });
    expect(
      slack("2.0", { conversation_id: "C-test", message_kinds: ["channel"] })
        .route,
    ).toMatchObject({ threadTs: "2.0" });
  });

  it.each([
    { kinds: ["mention", "thread"] },
    { kinds: ["group_dm", "thread"] },
    { kinds: ["dm"] },
  ])(
    "uses message kinds even when the delivered event is a thread reply ($kinds)",
    ({ kinds }) => {
      expect(slack("2.0", { message_kinds: kinds }).isMention).toBe(true);
    },
  );

  it("does not mark an unmentioned Slack channel message as a mention", () => {
    expect(
      slack("2.0", {
        conversation_id: "C-test",
        message_kinds: ["channel", "thread"],
      }).isMention,
    ).toBe(false);
  });

  it("preserves other Slack apps' incoming messages and bot metadata", () => {
    const message = slack("2.0", {
      actor_profile: { is_bot: true },
      event: { bot_id: "other-app", text: "An update" },
    });
    expect(message.text).toBe("An update");
    expect(message.isBot).toBe(true);
    expect(message.isMe).toBe(false);
  });
});

describe("phone media references", () => {
  it.each(["sms", "imessage"] as const)(
    "keeps %s attachment indices without retaining delivery URLs",
    (channel) => {
      const record = {
        id: "message-test",
        direction: "inbound",
        conversation_id: "conversation-test",
        sender_phone_number: "+12025550123",
        sender_number: "+12025550123",
        text: "Files",
        content: "Files",
        media: [
          {
            url: "https://example.com/expiring?signature=one",
            content_type: "image/png",
          },
          {
            url: "https://example.com/expiring?signature=two",
            content_type: "application/pdf",
            size: 12,
          },
        ],
      };
      const message = normalizeEvent(
        event(
          channel === "sms" ? "text.received" : "imessage.received",
          channel === "sms" ? { text_message: record } : { message: record },
        ),
        identity,
      )!;
      expect(message.attachments).toHaveLength(2);
      expect(JSON.stringify(message.attachments)).not.toContain("https://");
      for (const [index, attachment] of message.attachments!.entries()) {
        expect(JSON.parse(attachment.fetchMetadata!.reference)).toEqual({
          channel,
          messageId: "message-test",
          index,
        });
      }
    },
  );
});

describe("Slack bot-only events", () => {
  it("uses the bot ID as author when the event has no actor ID", () => {
    const message = normalizeEvent(
      event("slack.channel_message_received", {
        identity_id: identity.id,
        connection_id: "connection-test",
        conversation_id: "CUPDATES",
        message_ts: "123.456",
        event: { bot_id: "BUPDATES", text: "Build finished" },
      }),
      identity,
    );
    expect(message).toMatchObject({
      authorId: "BUPDATES",
      isBot: true,
      text: "Build finished",
    });
  });
});

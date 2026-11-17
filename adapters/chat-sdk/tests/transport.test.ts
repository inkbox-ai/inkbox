import { beforeEach, describe, expect, it, vi } from "vitest";
import { InkboxTransport, type InkboxRoute } from "../src/transport.js";

const mock = vi.hoisted(() => {
  const identity = {
    id: "identity-1",
    emailAddress: "assistant@example.com",
    replyAllEmail: vi.fn(),
    getThread: vi.fn(),
    getMessage: vi.fn(),
    sendText: vi.fn(),
    sendIMessage: vi.fn(),
    a2aReply: vi.fn(),
    getTextConversation: vi.fn(),
    listIMessages: vi.fn(),
    getIMessageConversationThread: vi.fn(),
    a2aMessages: vi.fn(),
    listTranscripts: vi.fn(),
    getText: vi.fn(),
    getIMessage: vi.fn(),
    sendIMessageTyping: vi.fn(),
    markEmailsRead: vi.fn(),
    markTextConversationRead: vi.fn(),
    markIMessageConversationRead: vi.fn(),
    sendIMessageReaction: vi.fn(),
    removeIMessageReaction: vi.fn(),
    placeCall: vi.fn(),
    uploadIMessageMedia: vi.fn(),
  };
  const slack = {
    listConnections: vi.fn(),
    sendMessage: vi.fn(),
    listMessages: vi.fn(),
    getMessage: vi.fn(),
    addReaction: vi.fn(),
    removeReaction: vi.fn(),
    updateMessage: vi.fn(),
    deleteMessage: vi.fn(),
    downloadFile: vi.fn(),
    uploadFile: vi.fn(),
  };
  const client = {
    whoami: vi.fn(),
    getIdentity: vi.fn(),
    slack,
    messages: { getAttachment: vi.fn() },
  };
  return { identity, slack, client, constructor: vi.fn() };
});
vi.mock("@inkbox/sdk", () => ({
  Inkbox: class {
    constructor(options: unknown) {
      mock.constructor(options);
      return mock.client;
    }
  },
}));
const transport = () =>
  new InkboxTransport({ apiKey: "synthetic-key", agentHandle: "assistant" });
const email: InkboxRoute = {
  channel: "email",
  identityId: "identity-1",
  emailAddress: "assistant@example.com",
  threadId: "thread-1",
};
const sms: InkboxRoute = {
  channel: "sms",
  identityId: "identity-1",
  conversationId: "conversation-1",
};
const imessage: InkboxRoute = {
  channel: "imessage",
  identityId: "identity-1",
  conversationId: "conversation-1",
  threadId: "root-1",
  replyToMessageId: "root-message",
};
const slack: InkboxRoute = {
  channel: "slack",
  identityId: "identity-1",
  connectionId: "connection-1",
  conversationId: "channel-1",
  threadTs: "1.0",
};
const a2a: InkboxRoute = {
  channel: "a2a",
  identityId: "identity-1",
  taskId: "task-1",
};
const voice: InkboxRoute = {
  channel: "voice",
  identityId: "identity-1",
  callId: "call-1",
};
const createdAt = new Date("2026-01-01T00:00:00Z");
function mail(id = "mail-1") {
  return {
    id,
    threadId: "thread-1",
    bodyText: "full email",
    snippet: "full",
    fromAddress: "sender@example.com",
    direction: "inbound",
    createdAt,
    attachmentMetadata: null,
  };
}
function text(id: string, time: number) {
  return {
    id,
    text: id,
    direction: "inbound",
    senderPhoneNumber: "+15550100001",
    localPhoneNumber: "+15550100002",
    remotePhoneNumber: "+15550100001",
    conversationId: "conversation-1",
    media: [],
    createdAt: new Date(time),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.client.getIdentity.mockResolvedValue(mock.identity);
  mock.client.whoami.mockResolvedValue({
    authType: "api_key",
    scope: "agent_identity:identity-1",
  });
  mock.slack.listConnections.mockResolvedValue({
    connections: [
      { id: "connection-1", identityId: "identity-1", botUserId: "bot-1" },
    ],
  });
  mock.identity.getThread.mockResolvedValue({ messages: [mail()] });
  mock.identity.getMessage.mockResolvedValue(mail());
  mock.identity.replyAllEmail.mockResolvedValue({ id: "reply-1" });
  mock.identity.sendText.mockResolvedValue({ id: "text-1" });
  mock.identity.sendIMessage.mockResolvedValue({ id: "imessage-1" });
});

describe("outbound routing", () => {
  it("rejects organization-scoped keys", async () => {
    mock.client.whoami.mockResolvedValue({
      authType: "api_key",
      scope: "organization",
    });
    await expect(transport().identity()).rejects.toThrow("agent-scoped");
  });
  it("rejects credentials rotated to a different identity", async () => {
    mock.client.whoami.mockResolvedValue({
      authType: "api_key",
      scope: "agent_identity:identity-2",
    });
    await expect(transport().send(sms, { text: "hello" })).rejects.toThrow(
      "configured identity",
    );
    expect(mock.identity.sendText).not.toHaveBeenCalled();
  });
  it("resolves credentials for each operation, without storing them in routes", async () => {
    const apiKey = vi
      .fn()
      .mockResolvedValueOnce("first-key")
      .mockResolvedValueOnce("second-key");
    const adapter = new InkboxTransport({ apiKey, agentHandle: "assistant" });
    await adapter.send(sms, { text: "one" });
    await adapter.send(sms, { text: "two" });
    expect(
      mock.constructor.mock.calls.map(([options]) => options.apiKey),
    ).toEqual(["first-key", "second-key"]);
    expect(apiKey).toHaveBeenCalledTimes(2);
  });
  it("refuses empty resolved credentials rather than using ambient credentials", async () => {
    await expect(
      new InkboxTransport({
        apiKey: async () => "",
        agentHandle: "assistant",
      }).identity(),
    ).rejects.toThrow("API key");
    expect(mock.constructor).not.toHaveBeenCalled();
  });
  it("rejects a thread belonging to another identity before sending", async () => {
    await expect(
      transport().send({ ...sms, identityId: "identity-2" }, { text: "hello" }),
    ).rejects.toThrow("different Inkbox identity");
    expect(mock.identity.sendText).not.toHaveBeenCalled();
  });
  it("uses reply-all on the existing email thread and preserves idempotency", async () => {
    const attachments = [
      {
        filename: "notes.txt",
        contentType: "text/plain",
        contentBase64: "aGk=",
      },
    ];
    await transport().send(email, {
      text: "reply",
      attachments,
      idempotencyKey: "stable-send",
    });
    expect(mock.identity.replyAllEmail).toHaveBeenCalledWith("mail-1", {
      bodyText: "reply",
      attachments,
      idempotencyKey: "stable-send",
    });
  });
  it("rejects an email anchor from another thread", async () => {
    mock.identity.getMessage.mockResolvedValue({
      ...mail(),
      threadId: "another-thread",
    });
    await expect(transport().send(email, { text: "reply" })).rejects.toThrow(
      "anchor",
    );
    expect(mock.identity.replyAllEmail).not.toHaveBeenCalled();
  });
  it("rejects another mailbox", async () => {
    await expect(
      transport().send(
        { ...email, emailAddress: "other@example.com" },
        { text: "reply" },
      ),
    ).rejects.toThrow("different Inkbox mailbox");
  });
  it("sends MMS in the original conversation without converting it to a direct message", async () => {
    await transport().send(sms, {
      text: "caption",
      mediaUrls: ["https://example.com/image.png"],
      idempotencyKey: "mms-1",
    });
    expect(mock.identity.sendText).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      text: "caption",
      mediaUrls: ["https://example.com/image.png"],
      idempotencyKey: "mms-1",
    });
  });
  it("preserves iMessage reply context", async () => {
    await transport().send(imessage, {
      text: "reply",
      idempotencyKey: "imessage-send",
    });
    expect(mock.identity.sendIMessage).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      replyToMessageId: "root-message",
      text: "reply",
      mediaUrls: undefined,
      idempotencyKey: "imessage-send",
    });
  });
  it("preserves Slack connection, channel, thread and stable action key", async () => {
    mock.slack.sendMessage.mockResolvedValue({
      id: "action-1",
      status: "sent",
      messageTs: "2.0",
    });
    expect(
      await transport().send(slack, {
        text: "reply",
        idempotencyKey: "slack-send",
      }),
    ).toMatchObject({ id: "2.0" });
    expect(mock.slack.sendMessage).toHaveBeenCalledWith("connection-1", {
      conversationId: "channel-1",
      threadTs: "1.0",
      text: "reply",
      idempotencyKey: "slack-send",
    });
  });
  it("uploads one Slack file with the caption in a single durable operation", async () => {
    mock.slack.uploadFile.mockResolvedValue({
      id: "upload-1",
      messageTs: "2.0",
      status: "succeeded",
    });
    await transport().send(slack, {
      text: "notes",
      attachments: [
        {
          filename: "notes.txt",
          contentType: "text/plain",
          contentBase64: "aGk=",
        },
      ],
      idempotencyKey: "file-send",
    });
    expect(mock.slack.uploadFile).toHaveBeenCalledWith("connection-1", {
      conversationId: "channel-1",
      threadTs: "1.0",
      filename: "notes.txt",
      contentBase64: "aGk=",
      initialComment: "notes",
      idempotencyKey: "file-send",
    });
    expect(mock.slack.sendMessage).not.toHaveBeenCalled();
  });
  it("rejects multiple Slack files without partial sends", async () => {
    const attachment = {
      filename: "notes.txt",
      contentType: "text/plain",
      contentBase64: "aGk=",
    };
    await expect(
      transport().send(slack, {
        text: "notes",
        attachments: [attachment, attachment],
      }),
    ).rejects.toThrow("one Slack attachment");
    expect(mock.slack.uploadFile).not.toHaveBeenCalled();
    expect(mock.slack.sendMessage).not.toHaveBeenCalled();
  });
  it("does not present an uncertain Slack action as sent or resend it", async () => {
    mock.slack.sendMessage.mockResolvedValue({
      id: "action-1",
      status: "unknown",
    });
    await expect(transport().send(slack, { text: "reply" })).rejects.toThrow(
      "unknown",
    );
    expect(mock.slack.sendMessage).toHaveBeenCalledTimes(1);
  });
  it("rejects Slack connections owned by another identity", async () => {
    mock.slack.listConnections.mockResolvedValue({
      connections: [{ id: "connection-1", identityId: "identity-2" }],
    });
    await expect(transport().send(slack, { text: "reply" })).rejects.toThrow(
      "different Inkbox Slack connection",
    );
    expect(mock.slack.sendMessage).not.toHaveBeenCalled();
  });
  it("does not finish an A2A task on every message", async () => {
    mock.identity.a2aReply.mockResolvedValue({
      id: "task-1",
      messages: [{ id: "reply-1", role: "agent" }],
    });
    await transport().send(a2a, { text: "working" });
    expect(mock.identity.a2aReply).toHaveBeenCalledWith("task-1", {
      text: "working",
      intent: "progress",
    });
    await transport().send(a2a, { text: "done", a2aIntent: "complete" });
    expect(mock.identity.a2aReply).toHaveBeenLastCalledWith("task-1", {
      text: "done",
      intent: "complete",
    });
  });
  it("never turns a post-call text response into an unsolicited call", async () => {
    await expect(transport().send(voice, { text: "hello" })).rejects.toThrow(
      "placeCall",
    );
    expect(mock.identity.placeCall).not.toHaveBeenCalled();
    await transport().placeCall({
      toNumber: "+15550100001",
      reason: "Follow up",
    });
    expect(mock.identity.placeCall).toHaveBeenCalledWith({
      toNumber: "+15550100001",
      reason: "Follow up",
    });
  });
  it("rejects unsupported attachments rather than silently losing them", async () => {
    await expect(
      transport().send(a2a, {
        text: "hello",
        mediaUrls: ["https://example.com/image.png"],
      }),
    ).rejects.toThrow("not supported");
    expect(mock.identity.a2aReply).not.toHaveBeenCalled();
  });
});

describe("history and authenticated attachments", () => {
  it("fetches full email bodies and serializable attachment references", async () => {
    mock.identity.getMessage.mockResolvedValue({
      ...mail(),
      attachmentMetadata: [
        { filename: "notes.txt", content_type: "text/plain", size: 12 },
      ],
    });
    const result = await transport().history(email);
    expect(result.messages[0]).toMatchObject({
      text: "full email",
      attachments: [
        {
          reference: {
            channel: "email",
            messageId: "mail-1",
            filename: "notes.txt",
          },
        },
      ],
    });
  });
  it("pages SMS backward but returns messages in chronological order", async () => {
    mock.identity.getTextConversation.mockResolvedValue([
      text("new", 2),
      text("old", 1),
    ]);
    const result = await transport().history(sms, { limit: 2 });
    expect(result.messages.map((row) => row.id)).toEqual(["old", "new"]);
    expect(result.nextCursor).toBe("2");
  });
  it("returns the oldest page when forward traversal is requested", async () => {
    mock.identity.getTextConversation.mockResolvedValue([
      text("new", 3),
      text("middle", 2),
      text("old", 1),
    ]);
    const result = await transport().history(sms, {
      limit: 2,
      direction: "forward",
    });
    expect(result.messages.map((row) => row.id)).toEqual(["old", "middle"]);
    expect(result.nextCursor).toBe("2");
  });
  it("filters iMessage thread history and preserves numeric pagination", async () => {
    mock.identity.listIMessages.mockResolvedValue([]);
    expect(
      await transport().history(imessage, { limit: 10, cursor: "20" }),
    ).toEqual({ messages: [], nextCursor: undefined });
    expect(mock.identity.listIMessages).toHaveBeenCalledWith({
      conversationId: "conversation-1",
      threadId: "root-1",
      includeGroups: true,
      limit: 10,
      offset: 20,
    });
  });
  it("provides credential-free Slack file references", async () => {
    mock.slack.listMessages.mockResolvedValue({
      messages: [
        {
          ts: "1.0",
          text: "file",
          user: "user-1",
          files: [{ id: "file-1", name: "notes.txt", mimetype: "text/plain" }],
        },
      ],
      nextCursor: null,
    });
    expect((await transport().history(slack)).messages[0].attachments).toEqual([
      {
        name: "notes.txt",
        mimeType: "text/plain",
        size: undefined,
        reference: {
          channel: "slack",
          connectionId: "connection-1",
          fileId: "file-1",
        },
      },
    ]);
  });
  it("rejects downloaded email attachments outside the current thread", async () => {
    mock.identity.getMessage.mockResolvedValue({
      ...mail(),
      threadId: "other-thread",
    });
    await expect(
      transport().attachment(email, {
        channel: "email",
        messageId: "mail-1",
        filename: "notes.txt",
      }),
    ).rejects.toThrow("does not belong");
    expect(mock.client.messages.getAttachment).not.toHaveBeenCalled();
  });
  it("uses the authenticated Slack file endpoint", async () => {
    mock.slack.downloadFile.mockResolvedValue(new Uint8Array([1, 2]));
    expect(
      await transport().attachment(slack, {
        channel: "slack",
        connectionId: "connection-1",
        fileId: "file-1",
      }),
    ).toEqual(new Uint8Array([1, 2]));
    expect(mock.slack.downloadFile).toHaveBeenCalledWith(
      "connection-1",
      "file-1",
    );
  });
  it("rejects invalid numeric cursors", async () => {
    await expect(transport().history(sms, { cursor: "-1" })).rejects.toThrow(
      "cursor",
    );
    await expect(transport().history(sms, { cursor: "NaN" })).rejects.toThrow(
      "cursor",
    );
  });
  it("checks message membership before returning a text", async () => {
    mock.identity.getText.mockResolvedValue({
      ...text("text-1", 1),
      conversationId: "other",
    });
    await expect(transport().getMessage(sms, "text-1")).rejects.toThrow(
      "does not belong",
    );
  });
});

describe("remaining history contracts", () => {
  it("keeps receiver-side A2A task history and both participant roles", async () => {
    mock.identity.a2aMessages.mockResolvedValue({
      items: [
        {
          id: "caller-1",
          role: "caller",
          caller: { identityId: "remote-1" },
          parts: [{ text: "task" }],
          createdAt: createdAt.toISOString(),
        },
        {
          id: "agent-1",
          role: "agent",
          caller: { identityId: "remote-1" },
          parts: [{ text: "working" }],
          createdAt: createdAt.toISOString(),
        },
      ],
      nextCursor: "next",
    });
    const page = await transport().history(a2a, {
      limit: 10,
      cursor: "previous",
    });
    expect(
      page.messages.map((message) => [message.authorId, message.isMe]),
    ).toEqual([
      ["remote-1", false],
      ["identity-1", true],
    ]);
    expect(mock.identity.a2aMessages).toHaveBeenCalledWith({
      taskId: "task-1",
      direction: "inbound",
      limit: 10,
      cursor: "previous",
    });
    expect(page.nextCursor).toBe("next");
  });
  it("returns newest call transcript page in chronological order", async () => {
    mock.identity.listTranscripts.mockResolvedValue([
      { id: "turn-1", text: "hello", party: "remote", createdAt: new Date(1) },
      { id: "turn-2", text: "hi", party: "local", createdAt: new Date(2) },
      { id: "turn-3", text: "bye", party: "remote", createdAt: new Date(3) },
    ]);
    const page = await transport().history(voice, { limit: 2 });
    expect(page.messages.map((message) => message.id)).toEqual([
      "turn-2",
      "turn-3",
    ]);
    expect(page.nextCursor).toBe("2");
  });
  it("rejects malformed attachment references before making requests", async () => {
    await expect(
      transport().attachment(email, {
        channel: "email",
        messageId: "",
        filename: "",
      }),
    ).rejects.toThrow("Invalid email attachment");
    expect(mock.constructor).not.toHaveBeenCalled();
  });
});

describe("channel capabilities", () => {
  it("does not send typing indicators to an iMessage group", async () => {
    await transport().typing({ ...imessage, isGroup: true });
    expect(mock.identity.sendIMessageTyping).not.toHaveBeenCalled();
    await transport().typing(imessage);
    expect(mock.identity.sendIMessageTyping).toHaveBeenCalledWith(
      "conversation-1",
    );
  });
  it("degrades unsupported typing without masking authentication failures", async () => {
    mock.identity.sendIMessageTyping.mockRejectedValue(
      Object.assign(new Error("Unsupported"), { statusCode: 422 }),
    );
    await expect(transport().typing(imessage)).resolves.toBeUndefined();
    mock.identity.sendIMessageTyping.mockRejectedValue(
      Object.assign(new Error("Unauthorized"), { statusCode: 401 }),
    );
    await expect(transport().typing(imessage)).rejects.toThrow("Unauthorized");
  });
  it("removes only matching outbound iMessage reactions", async () => {
    mock.identity.getIMessage.mockResolvedValue({
      conversationId: "conversation-1",
      threadId: "root-1",
      media: [],
      createdAt,
      reactions: [
        { id: "own", direction: "outbound", reaction: "love" },
        { id: "theirs", direction: "inbound", reaction: "love" },
      ],
    });
    await transport().removeReaction(imessage, "message-1", "love");
    expect(
      mock.identity.removeIMessageReaction,
    ).toHaveBeenCalledExactlyOnceWith("own");
  });
  it("uses Slack edit/delete/reaction operations without claiming unsupported transports can edit", async () => {
    mock.slack.updateMessage.mockResolvedValue({
      id: "edit-1",
      messageTs: "2.0",
      status: "succeeded",
    });
    mock.slack.deleteMessage.mockResolvedValue({
      id: "delete-1",
      status: "succeeded",
    });
    mock.slack.addReaction.mockResolvedValue({
      id: "reaction-1",
      status: "succeeded",
    });
    await transport().editMessage(slack, "2.0", "updated");
    await transport().deleteMessage(slack, "2.0");
    await transport().addReaction(slack, "2.0", "thumbsup");
    expect(mock.slack.updateMessage).toHaveBeenCalledWith(
      "connection-1",
      "channel-1",
      "2.0",
      "updated",
      { idempotencyKey: expect.any(String) },
    );
    expect(mock.slack.deleteMessage).toHaveBeenCalledWith(
      "connection-1",
      "channel-1",
      "2.0",
      { idempotencyKey: expect.any(String) },
    );
    await expect(
      transport().editMessage(sms, "text-1", "updated"),
    ).rejects.toThrow("not supported");
  });
});

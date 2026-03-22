// sdk/typescript/tests/mail/types.test.ts
import { describe, it, expect } from "vitest";
import {
  parseMailbox,
  parseMessage,
  parseMessageDetail,
  parseThread,
  parseThreadDetail,
} from "../../src/mail/types.js";
import {
  RAW_MAILBOX,
  RAW_MESSAGE,
  RAW_MESSAGE_DETAIL,
  RAW_THREAD,
  RAW_THREAD_DETAIL,
} from "../sampleData.js";

describe("parseMailbox", () => {
  it("converts snake_case to camelCase with Date instances", () => {
    const m = parseMailbox(RAW_MAILBOX);
    expect(m.id).toBe(RAW_MAILBOX.id);
    expect(m.emailAddress).toBe("agent01@inkbox.ai");
    expect(m.displayName).toBe("Agent 01");
    expect(m.status).toBe("active");
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeInstanceOf(Date);
  });
});

describe("parseMessage", () => {
  it("converts all fields", () => {
    const msg = parseMessage(RAW_MESSAGE);
    expect(msg.id).toBe(RAW_MESSAGE.id);
    expect(msg.mailboxId).toBe(RAW_MESSAGE.mailbox_id);
    expect(msg.threadId).toBe(RAW_MESSAGE.thread_id);
    expect(msg.fromAddress).toBe("user@example.com");
    expect(msg.toAddresses).toEqual(["agent01@inkbox.ai"]);
    expect(msg.ccAddresses).toBeNull();
    expect(msg.subject).toBe("Hello from test");
    expect(msg.isRead).toBe(false);
    expect(msg.isStarred).toBe(false);
    expect(msg.hasAttachments).toBe(false);
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it("handles null threadId", () => {
    const msg = parseMessage({ ...RAW_MESSAGE, thread_id: null });
    expect(msg.threadId).toBeNull();
  });
});

describe("parseMessageDetail", () => {
  it("includes body and header fields", () => {
    const detail = parseMessageDetail(RAW_MESSAGE_DETAIL);
    expect(detail.bodyText).toBe("Hi there, this is a test message body.");
    expect(detail.bodyHtml).toBe("<p>Hi there, this is a test message body.</p>");
    expect(detail.bccAddresses).toBeNull();
    expect(detail.inReplyTo).toBeNull();
    expect(detail.sesMessageId).toBe("ses-abc123");
    expect(detail.updatedAt).toBeInstanceOf(Date);
  });
});

describe("parseThread", () => {
  it("converts all fields", () => {
    const t = parseThread(RAW_THREAD);
    expect(t.id).toBe(RAW_THREAD.id);
    expect(t.mailboxId).toBe(RAW_THREAD.mailbox_id);
    expect(t.subject).toBe("Hello from test");
    expect(t.messageCount).toBe(2);
    expect(t.lastMessageAt).toBeInstanceOf(Date);
    expect(t.createdAt).toBeInstanceOf(Date);
  });
});

describe("parseThreadDetail", () => {
  it("includes nested messages", () => {
    const td = parseThreadDetail(RAW_THREAD_DETAIL);
    expect(td.messages).toHaveLength(1);
    expect(td.messages[0].id).toBe(RAW_MESSAGE.id);
  });

  it("returns empty messages array when missing", () => {
    const td = parseThreadDetail({ ...RAW_THREAD });
    expect(td.messages).toEqual([]);
  });
});


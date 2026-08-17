// sdk/typescript/tests/identities/agent_identity.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentIdentity } from "../../src/agent_identity.js";
import { parseAgentIdentityData } from "../../src/identities/types.js";
import { parseMailbox, parseMessageDetail, parseThreadDetail } from "../../src/mail/types.js";
import type { Inkbox } from "../../src/inkbox.js";
import { InkboxError } from "../../src/_http.js";
import { RAW_IDENTITY_DETAIL, RAW_MAILBOX, RAW_MESSAGE_DETAIL, RAW_THREAD_DETAIL } from "../sampleData.js";

const THREAD_ID = RAW_THREAD_DETAIL.id;
const MESSAGE_ID = RAW_MESSAGE_DETAIL.id;

function mockInkbox() {
  return {
    _messages: { get: vi.fn() },
    _drafts: {
      list: vi.fn(),
      create: vi.fn(),
      get: vi.fn(),
      update: vi.fn(),
      duplicate: vi.fn(),
      delete: vi.fn(),
      send: vi.fn(),
    },
    _threads: { get: vi.fn() },
    _mailboxes: { create: vi.fn() },
  } as unknown as Inkbox;
}

function identityWithMailbox() {
  const data = parseAgentIdentityData(RAW_IDENTITY_DETAIL);
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

function identityWithoutMailbox() {
  const data = parseAgentIdentityData({ ...RAW_IDENTITY_DETAIL, mailbox: null });
  const inkbox = mockInkbox();
  return { identity: new AgentIdentity(data, inkbox), inkbox };
}

describe("AgentIdentity.getMessage", () => {
  it("fetches message detail from identity mailbox", async () => {
    const { identity, inkbox } = identityWithMailbox();
    const messageDetail = parseMessageDetail(RAW_MESSAGE_DETAIL);
    vi.mocked(inkbox._messages.get).mockResolvedValue(messageDetail);

    const result = await identity.getMessage(MESSAGE_ID);

    expect(inkbox._messages.get).toHaveBeenCalledWith("sales-agent@inkbox.ai", MESSAGE_ID);
    expect(result.id).toBe(MESSAGE_ID);
    expect(result.bodyText).toBe("Hi there, this is a test message body.");
  });

  it("throws when no mailbox is assigned", async () => {
    const { identity } = identityWithoutMailbox();

    await expect(identity.getMessage(MESSAGE_ID)).rejects.toThrow(InkboxError);
  });
});

describe("AgentIdentity.getThread", () => {
  it("fetches thread detail from identity mailbox", async () => {
    const { identity, inkbox } = identityWithMailbox();
    const threadDetail = parseThreadDetail(RAW_THREAD_DETAIL);
    vi.mocked(inkbox._threads.get).mockResolvedValue(threadDetail);

    const result = await identity.getThread(THREAD_ID);

    expect(inkbox._threads.get).toHaveBeenCalledWith("sales-agent@inkbox.ai", THREAD_ID);
    expect(result.id).toBe(THREAD_ID);
    expect(result.messages).toHaveLength(1);
  });

  it("throws when no mailbox is assigned", async () => {
    const { identity } = identityWithoutMailbox();

    await expect(identity.getThread(THREAD_ID)).rejects.toThrow(InkboxError);
  });
});

describe("AgentIdentity email draft wrappers", () => {
  it("delegates every wrapper with the identity mailbox address", async () => {
    const { identity, inkbox } = identityWithMailbox();
    const draft = { id: "draft-id" } as never;
    const message = { id: "message-id" } as never;
    async function* listed() { yield draft; }
    vi.mocked(inkbox._drafts.list).mockReturnValue(listed());
    vi.mocked(inkbox._drafts.create).mockResolvedValue(draft);
    vi.mocked(inkbox._drafts.get).mockResolvedValue(draft);
    vi.mocked(inkbox._drafts.update).mockResolvedValue(draft);
    vi.mocked(inkbox._drafts.duplicate).mockResolvedValue(draft);
    vi.mocked(inkbox._drafts.delete).mockResolvedValue(undefined);
    vi.mocked(inkbox._drafts.send).mockResolvedValue(message);

    const listedDrafts = [];
    for await (const item of identity.iterEmailDrafts({ pageSize: 10 })) listedDrafts.push(item);
    await identity.createEmailDraft({ subject: "Subject" });
    await identity.getEmailDraft("draft-id");
    await identity.updateEmailDraft("draft-id", { generation: 2, subject: null });
    await identity.duplicateEmailDraft("draft-id", 2);
    await identity.deleteEmailDraft("draft-id", 2);
    await identity.sendEmailDraft("draft-id", 2);

    const address = "sales-agent@inkbox.ai";
    expect(listedDrafts).toEqual([draft]);
    expect(inkbox._drafts.list).toHaveBeenCalledWith(address, { pageSize: 10 });
    expect(inkbox._drafts.create).toHaveBeenCalledWith(address, { subject: "Subject" });
    expect(inkbox._drafts.get).toHaveBeenCalledWith(address, "draft-id");
    expect(inkbox._drafts.update).toHaveBeenCalledWith(
      address, "draft-id", { generation: 2, subject: null },
    );
    expect(inkbox._drafts.duplicate).toHaveBeenCalledWith(address, "draft-id", 2);
    expect(inkbox._drafts.delete).toHaveBeenCalledWith(address, "draft-id", 2);
    expect(inkbox._drafts.send).toHaveBeenCalledWith(address, "draft-id", 2);
  });

  it("rejects every wrapper when no mailbox is assigned", async () => {
    const { identity } = identityWithoutMailbox();

    expect(() => identity.iterEmailDrafts()).toThrow(InkboxError);
    await expect(identity.createEmailDraft()).rejects.toThrow(InkboxError);
    await expect(identity.getEmailDraft("draft-id")).rejects.toThrow(InkboxError);
    await expect(identity.updateEmailDraft("draft-id", { generation: 1 })).rejects.toThrow(InkboxError);
    await expect(identity.duplicateEmailDraft("draft-id", 1)).rejects.toThrow(InkboxError);
    await expect(identity.deleteEmailDraft("draft-id", 1)).rejects.toThrow(InkboxError);
    await expect(identity.sendEmailDraft("draft-id", 1)).rejects.toThrow(InkboxError);
  });
});

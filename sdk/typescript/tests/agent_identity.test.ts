// sdk/typescript/tests/agent_identity.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentIdentity } from "../src/agent_identity.js";
import { InkboxError } from "../src/_http.js";
import type { Inkbox } from "../src/inkbox.js";
import type { _AgentIdentityData } from "../src/identities/types.js";
import {
  RAW_IDENTITY_DETAIL,
  RAW_IDENTITY_MAILBOX,
  RAW_IDENTITY_PHONE,
  RAW_IDENTITY,
  RAW_MAILBOX,
  RAW_MESSAGE,
  RAW_MESSAGE_DETAIL,
  RAW_THREAD_DETAIL,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
  RAW_PHONE_CALL,
  RAW_PHONE_TRANSCRIPT,
} from "./sampleData.js";

const PARSED_MAILBOX = {
  id: RAW_IDENTITY_MAILBOX.id,
  emailAddress: RAW_IDENTITY_MAILBOX.email_address,
  displayName: RAW_IDENTITY_MAILBOX.display_name,
  status: RAW_IDENTITY_MAILBOX.status,
  createdAt: RAW_IDENTITY_MAILBOX.created_at,
  updatedAt: RAW_IDENTITY_MAILBOX.updated_at,
};

const PARSED_PHONE = {
  id: RAW_IDENTITY_PHONE.id,
  number: RAW_IDENTITY_PHONE.number,
  type: RAW_IDENTITY_PHONE.type,
  status: RAW_IDENTITY_PHONE.status,
  incomingCallAction: RAW_IDENTITY_PHONE.incoming_call_action,
  clientWebsocketUrl: RAW_IDENTITY_PHONE.client_websocket_url,
  createdAt: RAW_IDENTITY_PHONE.created_at,
  updatedAt: RAW_IDENTITY_PHONE.updated_at,
};

function makeData(overrides: Partial<_AgentIdentityData> = {}): _AgentIdentityData {
  return {
    id: RAW_IDENTITY_DETAIL.id,
    agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
    status: RAW_IDENTITY_DETAIL.status,
    createdAt: RAW_IDENTITY_DETAIL.created_at,
    updatedAt: RAW_IDENTITY_DETAIL.updated_at,
    mailbox: PARSED_MAILBOX,
    phoneNumber: PARSED_PHONE,
    ...overrides,
  };
}

function mockInkbox() {
  return {
    _mailboxes: { create: vi.fn() },
    _messages: { send: vi.fn(), list: vi.fn(), markRead: vi.fn(), get: vi.fn() },
    _threads: { get: vi.fn() },
    _numbers: { provision: vi.fn() },
    _calls: { place: vi.fn(), list: vi.fn() },
    _transcripts: { list: vi.fn() },
    _texts: { update: vi.fn(), updateConversation: vi.fn() },
    _idsResource: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      assignMailbox: vi.fn(),
      unlinkMailbox: vi.fn(),
      assignPhoneNumber: vi.fn(),
      unlinkPhoneNumber: vi.fn(),
    },
  } as unknown as Inkbox;
}

describe("AgentIdentity properties", () => {
  it("exposes agentHandle, id, status", () => {
    const identity = new AgentIdentity(makeData(), mockInkbox());
    expect(identity.agentHandle).toBe("sales-agent");
    expect(identity.id).toBe(RAW_IDENTITY_DETAIL.id);
    expect(identity.status).toBe("active");
  });

  it("exposes mailbox and phoneNumber", () => {
    const identity = new AgentIdentity(makeData(), mockInkbox());
    expect(identity.mailbox).toEqual(PARSED_MAILBOX);
    expect(identity.phoneNumber).toEqual(PARSED_PHONE);
  });

  it("returns null for missing channels", () => {
    const identity = new AgentIdentity(makeData({ mailbox: null, phoneNumber: null }), mockInkbox());
    expect(identity.mailbox).toBeNull();
    expect(identity.phoneNumber).toBeNull();
  });
});

describe("AgentIdentity channel management", () => {
  it("createMailbox creates and links", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._mailboxes.create).mockResolvedValue({
      id: RAW_MAILBOX.id,
      emailAddress: RAW_MAILBOX.email_address,
      displayName: RAW_MAILBOX.display_name,
      status: RAW_MAILBOX.status,
      createdAt: RAW_MAILBOX.created_at,
      updatedAt: RAW_MAILBOX.updated_at,
    });
    const identity = new AgentIdentity(makeData({ mailbox: null }), ink);

    const mailbox = await identity.createMailbox({ displayName: "Test" });

    expect(ink._mailboxes.create).toHaveBeenCalledWith({
      agentHandle: "sales-agent",
      displayName: "Test",
    });
    expect(mailbox.emailAddress).toBe(RAW_MAILBOX.email_address);
    expect(identity.mailbox).toEqual(mailbox);
  });

  it("assignMailbox links existing mailbox", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.assignMailbox).mockResolvedValue(makeData());
    const identity = new AgentIdentity(makeData({ mailbox: null }), ink);

    const result = await identity.assignMailbox("mailbox-id");

    expect(ink._idsResource.assignMailbox).toHaveBeenCalledWith("sales-agent", { mailboxId: "mailbox-id" });
    expect(result).toEqual(PARSED_MAILBOX);
  });

  it("unlinkMailbox removes mailbox", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.unlinkMailbox).mockResolvedValue(undefined);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.unlinkMailbox();

    expect(ink._idsResource.unlinkMailbox).toHaveBeenCalledWith("sales-agent");
    expect(identity.mailbox).toBeNull();
  });

  it("unlinkMailbox throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(identity.unlinkMailbox()).rejects.toThrow(InkboxError);
  });

  it("provisionPhoneNumber provisions and links", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._numbers.provision).mockResolvedValue(undefined as never);
    vi.mocked(ink._idsResource.get).mockResolvedValue(makeData());
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    const phone = await identity.provisionPhoneNumber({ type: "toll_free" });

    expect(ink._numbers.provision).toHaveBeenCalledWith({
      agentHandle: "sales-agent",
      type: "toll_free",
    });
    expect(phone).toEqual(PARSED_PHONE);
  });

  it("assignPhoneNumber links existing number", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.assignPhoneNumber).mockResolvedValue(makeData());
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    const result = await identity.assignPhoneNumber("phone-id");

    expect(ink._idsResource.assignPhoneNumber).toHaveBeenCalledWith("sales-agent", { phoneNumberId: "phone-id" });
    expect(result).toEqual(PARSED_PHONE);
  });

  it("unlinkPhoneNumber removes phone", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.unlinkPhoneNumber).mockResolvedValue(undefined);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.unlinkPhoneNumber();

    expect(ink._idsResource.unlinkPhoneNumber).toHaveBeenCalledWith("sales-agent");
    expect(identity.phoneNumber).toBeNull();
  });

  it("unlinkPhoneNumber throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.unlinkPhoneNumber()).rejects.toThrow(InkboxError);
  });
});

describe("AgentIdentity mail helpers", () => {
  it("sendEmail delegates to messages resource", async () => {
    const ink = mockInkbox();
    const msg = { id: RAW_MESSAGE.id } as never;
    vi.mocked(ink._messages.send).mockResolvedValue(msg);
    const identity = new AgentIdentity(makeData(), ink);

    const opts = { to: ["test@example.com"], subject: "Hi", bodyText: "Hello" };
    await identity.sendEmail(opts);

    expect(ink._messages.send).toHaveBeenCalledWith(PARSED_MAILBOX.emailAddress, opts);
  });

  it("sendEmail throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(identity.sendEmail({ to: ["x"], subject: "y" })).rejects.toThrow(InkboxError);
  });

  it("iterEmails returns async generator", () => {
    const ink = mockInkbox();
    async function* gen() { yield { id: "1" } as never; }
    vi.mocked(ink._messages.list).mockReturnValue(gen());
    const identity = new AgentIdentity(makeData(), ink);

    const iter = identity.iterEmails();
    expect(iter[Symbol.asyncIterator]).toBeDefined();
  });

  it("iterEmails throws when no mailbox", () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    expect(() => identity.iterEmails()).toThrow(InkboxError);
  });

  it("iterUnreadEmails filters read messages", async () => {
    const ink = mockInkbox();
    async function* gen() {
      yield { id: "1", isRead: false } as never;
      yield { id: "2", isRead: true } as never;
      yield { id: "3", isRead: false } as never;
    }
    vi.mocked(ink._messages.list).mockReturnValue(gen());
    const identity = new AgentIdentity(makeData(), ink);

    const unread: unknown[] = [];
    for await (const msg of identity.iterUnreadEmails()) {
      unread.push(msg);
    }
    expect(unread).toHaveLength(2);
  });

  it("markEmailsRead marks each message", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._messages.markRead).mockResolvedValue(undefined);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.markEmailsRead(["msg-1", "msg-2"]);

    expect(ink._messages.markRead).toHaveBeenCalledTimes(2);
    expect(ink._messages.markRead).toHaveBeenCalledWith(PARSED_MAILBOX.emailAddress, "msg-1");
    expect(ink._messages.markRead).toHaveBeenCalledWith(PARSED_MAILBOX.emailAddress, "msg-2");
  });

  it("markEmailsRead throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(identity.markEmailsRead(["msg-1"])).rejects.toThrow(InkboxError);
  });

  it("getMessage delegates to messages resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._messages.get).mockResolvedValue({ id: "msg-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.getMessage("msg-1");

    expect(ink._messages.get).toHaveBeenCalledWith(PARSED_MAILBOX.emailAddress, "msg-1");
  });

  it("getMessage throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(identity.getMessage("msg-1")).rejects.toThrow(InkboxError);
  });

  it("getThread delegates to threads resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._threads.get).mockResolvedValue({ id: "thread-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.getThread("thread-1");

    expect(ink._threads.get).toHaveBeenCalledWith(PARSED_MAILBOX.emailAddress, "thread-1");
  });

  it("getThread throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(identity.getThread("thread-1")).rejects.toThrow(InkboxError);
  });
});

describe("AgentIdentity phone helpers", () => {
  it("placeCall delegates to calls resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.place).mockResolvedValue({ id: "call-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.placeCall({ toNumber: "+15551234567" });

    expect(ink._calls.place).toHaveBeenCalledWith({
      fromNumber: PARSED_PHONE.number,
      toNumber: "+15551234567",
      clientWebsocketUrl: undefined,
    });
  });

  it("placeCall throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.placeCall({ toNumber: "+1" })).rejects.toThrow(InkboxError);
  });

  it("listCalls delegates to calls resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.list).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.listCalls({ limit: 10 });

    expect(ink._calls.list).toHaveBeenCalledWith(PARSED_PHONE.id, { limit: 10 });
  });

  it("listCalls throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.listCalls()).rejects.toThrow(InkboxError);
  });

  it("listTranscripts delegates to transcripts resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._transcripts.list).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.listTranscripts("call-1");

    expect(ink._transcripts.list).toHaveBeenCalledWith(PARSED_PHONE.id, "call-1");
  });

  it("listTranscripts throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.listTranscripts("call-1")).rejects.toThrow(InkboxError);
  });

  it("markTextRead delegates to texts resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._texts.update).mockResolvedValue({ id: "txt-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.markTextRead("txt-1");

    expect(ink._texts.update).toHaveBeenCalledWith(PARSED_PHONE.id, "txt-1", {
      isRead: true,
    });
  });

  it("markTextRead throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.markTextRead("txt-1")).rejects.toThrow(InkboxError);
  });

  it("markTextConversationRead delegates to texts resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._texts.updateConversation).mockResolvedValue({
      remotePhoneNumber: "+15551234567",
      isRead: true,
      updatedCount: 3,
    });
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.markTextConversationRead("+15551234567");

    expect(ink._texts.updateConversation).toHaveBeenCalledWith(
      PARSED_PHONE.id,
      "+15551234567",
      { isRead: true },
    );
    expect(result.updatedCount).toBe(3);
  });

  it("markTextConversationRead throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.markTextConversationRead("+15551234567")).rejects.toThrow(InkboxError);
  });
});

describe("AgentIdentity management", () => {
  it("update refreshes internal data", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.update).mockResolvedValue({
      id: RAW_IDENTITY.id,
      agentHandle: "new-handle",
      status: "active",
      createdAt: RAW_IDENTITY.created_at,
      updatedAt: RAW_IDENTITY.updated_at,
    });
    const identity = new AgentIdentity(makeData(), ink);

    await identity.update({ newHandle: "new-handle" });

    expect(ink._idsResource.update).toHaveBeenCalledWith("sales-agent", { newHandle: "new-handle" });
    expect(identity.agentHandle).toBe("new-handle");
  });

  it("refresh re-fetches identity data", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.get).mockResolvedValue(makeData({ mailbox: null, phoneNumber: null }));
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.refresh();

    expect(ink._idsResource.get).toHaveBeenCalledWith("sales-agent");
    expect(result).toBe(identity);
    expect(identity.mailbox).toBeNull();
    expect(identity.phoneNumber).toBeNull();
  });

  it("delete delegates to idsResource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.delete).mockResolvedValue(undefined);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.delete();

    expect(ink._idsResource.delete).toHaveBeenCalledWith("sales-agent");
  });
});


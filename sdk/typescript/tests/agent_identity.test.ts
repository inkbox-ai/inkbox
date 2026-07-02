// sdk/typescript/tests/agent_identity.test.ts
import { describe, it, expect, vi } from "vitest";
import { AgentIdentity } from "../src/agent_identity.js";
import { CallOrigin, IncomingCallAction } from "../src/phone/types.js";
import { InkboxError } from "../src/_http.js";
import type { Inkbox } from "../src/inkbox.js";
import type { _AgentIdentityData } from "../src/identities/types.js";
import { TLSMode, TunnelStatus } from "../src/tunnels/types.js";
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
    organizationId: RAW_IDENTITY_DETAIL.organization_id,
    agentHandle: RAW_IDENTITY_DETAIL.agent_handle,
    emailAddress: RAW_IDENTITY_DETAIL.email_address,
    createdAt: RAW_IDENTITY_DETAIL.created_at,
    updatedAt: RAW_IDENTITY_DETAIL.updated_at,
    mailbox: PARSED_MAILBOX,
    phoneNumber: PARSED_PHONE,
    ...overrides,
  };
}

function mockInkbox() {
  return {
    _mailboxes: {},
    _messages: {
      send: vi.fn(),
      forward: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      get: vi.fn(),
    },
    _threads: { get: vi.fn() },
    _numbers: { provision: vi.fn() },
    _calls: { place: vi.fn(), list: vi.fn(), transcripts: vi.fn() },
    _incomingCallAction: { get: vi.fn(), set: vi.fn() },
    _texts: { send: vi.fn(), update: vi.fn(), updateConversation: vi.fn() },
    _idsResource: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      assignMailbox: vi.fn(),
      unlinkMailbox: vi.fn(),
      releasePhoneNumber: vi.fn(),
    },
  } as unknown as Inkbox;
}

describe("AgentIdentity properties", () => {
  it("exposes agentHandle, id, emailAddress", () => {
    const identity = new AgentIdentity(makeData(), mockInkbox());
    expect(identity.agentHandle).toBe("sales-agent");
    expect(identity.id).toBe(RAW_IDENTITY_DETAIL.id);
    expect(identity.emailAddress).toBe("sales-agent@inkboxmail.com");
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
  it("provisionPhoneNumber provisions and links", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._numbers.provision).mockResolvedValue(undefined as never);
    vi.mocked(ink._idsResource.get).mockResolvedValue(makeData());
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    const phone = await identity.provisionPhoneNumber({ type: "local" });

    expect(ink._numbers.provision).toHaveBeenCalledWith({
      agentHandle: "sales-agent",
      type: "local",
    });
    expect(phone).toEqual(PARSED_PHONE);
  });

  it("releasePhoneNumber releases the linked number", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.releasePhoneNumber).mockResolvedValue(undefined);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.releasePhoneNumber();

    expect(ink._idsResource.releasePhoneNumber).toHaveBeenCalledWith("sales-agent");
    expect(identity.phoneNumber).toBeNull();
  });

  it("releasePhoneNumber throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.releasePhoneNumber()).rejects.toThrow(InkboxError);
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

  it("forwardEmail delegates to messages resource", async () => {
    const ink = mockInkbox();
    const msg = { id: RAW_MESSAGE.id } as never;
    vi.mocked(ink._messages.forward).mockResolvedValue(msg);
    const identity = new AgentIdentity(makeData(), ink);

    const opts = { to: ["fwd@example.com"], subject: "Fwd: x" };
    await identity.forwardEmail("msg-1", opts);

    expect(ink._messages.forward).toHaveBeenCalledWith(
      PARSED_MAILBOX.emailAddress,
      "msg-1",
      opts,
    );
  });

  it("forwardEmail throws when no mailbox", async () => {
    const identity = new AgentIdentity(makeData({ mailbox: null }), mockInkbox());
    await expect(
      identity.forwardEmail("msg-1", { to: ["x@example.com"] }),
    ).rejects.toThrow(InkboxError);
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
  it("placeCall delegates to calls resource (dedicated origination)", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.place).mockResolvedValue({ id: "call-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.placeCall({ toNumber: "+15551234567" });

    expect(ink._calls.place).toHaveBeenCalledWith({
      toNumber: "+15551234567",
      origination: CallOrigin.DEDICATED_NUMBER,
      fromNumber: PARSED_PHONE.number,
      clientWebsocketUrl: undefined,
    });
  });

  it("placeCall with shared origination scopes by identity id, no from_number", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.place).mockResolvedValue({ id: "call-1" } as never);
    // Shared origination works without a dedicated number.
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    await identity.placeCall({
      toNumber: "+15551234567",
      origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
    });

    expect(ink._calls.place).toHaveBeenCalledWith({
      toNumber: "+15551234567",
      origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
      agentIdentityId: identity.id,
      clientWebsocketUrl: undefined,
    });
  });

  it("placeCall throws when no phone for dedicated origination", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(identity.placeCall({ toNumber: "+1" })).rejects.toThrow(InkboxError);
  });

  it("placeCall forwards clientWebsocketUrl", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.place).mockResolvedValue({ id: "call-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.placeCall({
      toNumber: "+15551234567",
      clientWebsocketUrl: "wss://agent.example.com/ws",
    });

    expect(ink._calls.place).toHaveBeenCalledWith({
      toNumber: "+15551234567",
      origination: CallOrigin.DEDICATED_NUMBER,
      fromNumber: PARSED_PHONE.number,
      clientWebsocketUrl: "wss://agent.example.com/ws",
    });
  });

  it("placeCall returns the resource result", async () => {
    const ink = mockInkbox();
    const placed = { id: "call-1", rateLimit: { callsUsed: 5 } } as never;
    vi.mocked(ink._calls.place).mockResolvedValue(placed);
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.placeCall({ toNumber: "+15551234567" });

    expect(result).toBe(placed);
  });

  it("listCalls delegates to calls resource scoped by identity id", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.list).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.listCalls({ limit: 10 });

    expect(ink._calls.list).toHaveBeenCalledWith({
      agentIdentityId: identity.id,
      limit: 10,
    });
  });

  it("listCalls works without a phone number (shared-only identity)", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.list).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    await identity.listCalls();

    expect(ink._calls.list).toHaveBeenCalledWith({ agentIdentityId: identity.id });
  });

  it("listCalls forwards offset and isBlocked alongside identity scope", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.list).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.listCalls({ limit: 5, offset: 10, isBlocked: false });

    expect(ink._calls.list).toHaveBeenCalledWith({
      agentIdentityId: identity.id,
      limit: 5,
      offset: 10,
      isBlocked: false,
    });
  });

  it("listTranscripts delegates to calls.transcripts", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.transcripts).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.listTranscripts("call-1");

    expect(ink._calls.transcripts).toHaveBeenCalledWith("call-1");
  });

  it("listTranscripts works without a phone number (shared-only identity)", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._calls.transcripts).mockResolvedValue([]);
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    await identity.listTranscripts("call-1");

    expect(ink._calls.transcripts).toHaveBeenCalledWith("call-1");
  });

  it("listTranscripts returns the resource result", async () => {
    const ink = mockInkbox();
    const segments = [{ id: "seg-1", callId: "call-1" }] as never;
    vi.mocked(ink._calls.transcripts).mockResolvedValue(segments);
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.listTranscripts("call-1");

    expect(result).toBe(segments);
  });

  it("getIncomingCallAction delegates scoped by identity id", async () => {
    const ink = mockInkbox();
    const config = {
      agentIdentityId: RAW_IDENTITY_DETAIL.id,
      incomingCallAction: IncomingCallAction.AUTO_REJECT,
      clientWebsocketUrl: null,
      incomingCallWebhookUrl: null,
    };
    vi.mocked(ink._incomingCallAction.get).mockResolvedValue(config);
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.getIncomingCallAction();

    expect(ink._incomingCallAction.get).toHaveBeenCalledWith({
      agentIdentityId: identity.id,
    });
    expect(result).toBe(config);
  });

  it("getIncomingCallAction works without a phone number (shared-only identity)", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._incomingCallAction.get).mockResolvedValue({} as never);
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    await identity.getIncomingCallAction();

    expect(ink._incomingCallAction.get).toHaveBeenCalledWith({
      agentIdentityId: identity.id,
    });
  });

  it("setIncomingCallAction delegates with identity id and forwards urls", async () => {
    const ink = mockInkbox();
    const config = {
      agentIdentityId: RAW_IDENTITY_DETAIL.id,
      incomingCallAction: IncomingCallAction.WEBHOOK,
      clientWebsocketUrl: "wss://agent.example.com/ws",
      incomingCallWebhookUrl: "https://agent.example.com/incoming-call",
    };
    vi.mocked(ink._incomingCallAction.set).mockResolvedValue(config);
    const identity = new AgentIdentity(makeData(), ink);

    const result = await identity.setIncomingCallAction({
      incomingCallAction: IncomingCallAction.WEBHOOK,
      clientWebsocketUrl: "wss://agent.example.com/ws",
      incomingCallWebhookUrl: "https://agent.example.com/incoming-call",
    });

    expect(ink._incomingCallAction.set).toHaveBeenCalledWith({
      incomingCallAction: IncomingCallAction.WEBHOOK,
      agentIdentityId: identity.id,
      clientWebsocketUrl: "wss://agent.example.com/ws",
      incomingCallWebhookUrl: "https://agent.example.com/incoming-call",
    });
    expect(result).toBe(config);
  });

  it("setIncomingCallAction passes undefined for omitted urls", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._incomingCallAction.set).mockResolvedValue({} as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.setIncomingCallAction({
      incomingCallAction: IncomingCallAction.AUTO_ACCEPT,
    });

    expect(ink._incomingCallAction.set).toHaveBeenCalledWith({
      incomingCallAction: IncomingCallAction.AUTO_ACCEPT,
      agentIdentityId: identity.id,
      clientWebsocketUrl: undefined,
      incomingCallWebhookUrl: undefined,
    });
  });

  it("setIncomingCallAction works without a phone number (shared-only identity)", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._incomingCallAction.set).mockResolvedValue({} as never);
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), ink);

    await identity.setIncomingCallAction({
      incomingCallAction: IncomingCallAction.AUTO_REJECT,
    });

    expect(ink._incomingCallAction.set).toHaveBeenCalledWith({
      incomingCallAction: IncomingCallAction.AUTO_REJECT,
      agentIdentityId: identity.id,
      clientWebsocketUrl: undefined,
      incomingCallWebhookUrl: undefined,
    });
  });

  it("sendText delegates to texts resource", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._texts.send).mockResolvedValue({ id: "txt-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);

    await identity.sendText({ to: "+15551234567", text: "Hello!" });

    expect(ink._texts.send).toHaveBeenCalledWith(PARSED_PHONE.id, {
      to: "+15551234567",
      text: "Hello!",
    });
  });

  it("sendText can reply to a conversation", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._texts.send).mockResolvedValue({ id: "txt-1" } as never);
    const identity = new AgentIdentity(makeData(), ink);
    const conversationId = "eeee1111-0000-0000-0000-0000000000fa";

    await identity.sendText({ conversationId, text: "Reply all" });

    expect(ink._texts.send).toHaveBeenCalledWith(PARSED_PHONE.id, {
      conversationId,
      text: "Reply all",
    });
  });

  it("sendText throws when no phone", async () => {
    const identity = new AgentIdentity(makeData({ phoneNumber: null }), mockInkbox());
    await expect(
      identity.sendText({ to: "+15551234567", text: "Hello!" }),
    ).rejects.toThrow(InkboxError);
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
      organizationId: RAW_IDENTITY.organization_id,
      agentHandle: "new-handle",
      emailAddress: RAW_IDENTITY.email_address,
      createdAt: RAW_IDENTITY.created_at,
      updatedAt: RAW_IDENTITY.updated_at,
    });
    const identity = new AgentIdentity(makeData(), ink);

    await identity.update({ newHandle: "new-handle" });

    expect(ink._idsResource.update).toHaveBeenCalledWith("sales-agent", { newHandle: "new-handle" });
    expect(identity.agentHandle).toBe("new-handle");
  });

  it("update with newHandle refreshes the cached tunnel", async () => {
    const ink = mockInkbox();
    const oldTunnel = {
      id: "tun-1", organizationId: "org-1", tunnelName: "sales-agent",
      tlsMode: TLSMode.EDGE, certPem: null, certFingerprintSha256: null,
      certExpiresAt: null, status: TunnelStatus.ACTIVE, lastConnectedAt: null,
      lastConnectedIpAddr: null, currentlyConnected: false,
      publicHost: "sales-agent.inkboxwire.com", zone: "inkboxwire.com",
      metadata: {}, createdAt: new Date(), updatedAt: new Date(),
    };
    const renamedTunnel = { ...oldTunnel, tunnelName: "new-handle", publicHost: "new-handle.inkboxwire.com" };
    vi.mocked(ink._idsResource.update).mockResolvedValue({
      id: RAW_IDENTITY.id,
      organizationId: RAW_IDENTITY.organization_id,
      agentHandle: "new-handle",
      emailAddress: RAW_IDENTITY.email_address,
      createdAt: RAW_IDENTITY.created_at,
      updatedAt: RAW_IDENTITY.updated_at,
    });
    vi.mocked(ink._idsResource.get).mockResolvedValue(makeData({ agentHandle: "new-handle", tunnel: renamedTunnel }));
    const identity = new AgentIdentity(makeData({ tunnel: oldTunnel }), ink);

    await identity.update({ newHandle: "new-handle" });

    expect(ink._idsResource.get).toHaveBeenCalledWith("new-handle");
    expect(identity.tunnel?.tunnelName).toBe("new-handle");
    expect(identity.tunnel?.publicHost).toBe("new-handle.inkboxwire.com");
  });

  it("update without newHandle does not refresh", async () => {
    const ink = mockInkbox();
    vi.mocked(ink._idsResource.update).mockResolvedValue({
      id: RAW_IDENTITY.id,
      organizationId: RAW_IDENTITY.organization_id,
      agentHandle: RAW_IDENTITY.agent_handle,
      displayName: "New Display",
      emailAddress: RAW_IDENTITY.email_address,
      createdAt: RAW_IDENTITY.created_at,
      updatedAt: RAW_IDENTITY.updated_at,
    });
    const identity = new AgentIdentity(makeData(), ink);

    await identity.update({ displayName: "New Display" });

    expect(ink._idsResource.get).not.toHaveBeenCalled();
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

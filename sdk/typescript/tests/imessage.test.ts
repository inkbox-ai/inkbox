// sdk/typescript/tests/imessage.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { IMessagesResource } from "../src/imessage/resources/imessages.js";
import { IMessageContactRulesResource } from "../src/imessage/resources/contactRules.js";
import {
  IMessageAssignmentStatus,
  IMessageDeliveryStatus,
  IMessageGroupCreationStatus,
  IMessageNumberStatus,
  IMessageNumberType,
  IMessageReactionType,
  IMessageRuleAction,
  IMessageSendStyle,
  IMessageService,
  parseIMessage,
} from "../src/imessage/types.js";
import { ContactRuleStatus } from "../src/mail/types.js";

const BASE = "https://inkbox.ai/api/v1/imessage";

const CONVO_ID = "cccc1111-0000-0000-0000-000000000001";
const MSG_ID = "dddd4444-0000-0000-0000-000000000001";
const IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001";
const RULE_ID = "ffff6666-0000-0000-0000-000000000001";
const REMOTE = "+15551234567";
const GROUP_REMOTE = "+15557654321";
const HANDLE = "support-bot";
const NUMBER_ID = "99999999-0000-0000-0000-000000000001";

const IMESSAGE_DICT = {
  id: MSG_ID,
  conversation_id: CONVO_ID,
  assignment_id: "bbbb2222-0000-0000-0000-000000000001",
  direction: "outbound",
  remote_number: REMOTE,
  content: "Hello over iMessage",
  message_type: "message",
  service: "imessage",
  send_style: "slam",
  media: [{ url: "https://media.example/a.png", content_type: "image/png", size: 10 }],
  was_downgraded: false,
  status: "queued",
  error_code: null,
  error_message: null,
  error_reason: null,
  error_detail: null,
  is_read: false,
  is_blocked: false,
  recipients: [
    { remote_number: REMOTE, delivery_status: "queued", service: "imessage" },
  ],
  reactions: [
    {
      id: "aaaa8888-0000-0000-0000-000000000001",
      direction: "inbound",
      reaction: "custom",
      custom_emoji: "\u{1F334}",
      remote_number: REMOTE,
      part_index: 0,
      created_at: "2026-06-01T00:01:00Z",
    },
  ],
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const GROUP_IMESSAGE_DICT = {
  ...IMESSAGE_DICT,
  assignment_id: null,
  remote_number: null,
  sender_number: REMOTE,
  participants: [REMOTE, GROUP_REMOTE],
  is_group: true,
  recipients: [
    { remote_number: REMOTE, delivery_status: "queued", service: "imessage" },
    { remote_number: GROUP_REMOTE, delivery_status: "queued", service: "imessage" },
  ],
};

const CONVERSATION_DICT = {
  id: CONVO_ID,
  assignment_id: "bbbb2222-0000-0000-0000-000000000001",
  remote_number: REMOTE,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const CONVERSATION_SUMMARY_DICT = {
  ...CONVERSATION_DICT,
  latest_text: "Hello over iMessage",
  latest_message_at: "2026-06-01T00:00:00Z",
  latest_direction: "outbound",
  latest_has_media: false,
  unread_count: 2,
  total_count: 5,
};

const GROUP_CONVERSATION_DICT = {
  ...CONVERSATION_DICT,
  assignment_id: null,
  assignment_status: null,
  remote_number: null,
  participants: [REMOTE, GROUP_REMOTE],
  is_group: true,
  group_creation_status: "creating",
};

const REACTION_DICT = {
  id: "aaaa7777-0000-0000-0000-000000000001",
  conversation_id: CONVO_ID,
  assignment_id: "bbbb2222-0000-0000-0000-000000000001",
  target_message_id: MSG_ID,
  direction: "outbound",
  reaction: "like",
  remote_number: REMOTE,
  part_index: 0,
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const GROUP_REACTION_DICT = {
  ...REACTION_DICT,
  assignment_id: null,
  reaction: "eyes",
};

const CONTACT_RULE_DICT = {
  id: RULE_ID,
  agent_identity_id: IDENTITY_ID,
  action: "block",
  match_type: "exact_number",
  match_target: REMOTE,
  status: "active",
  created_at: "2026-06-01T00:00:00Z",
  updated_at: "2026-06-01T00:00:00Z",
};

const NUMBER_DICT = {
  id: NUMBER_ID,
  number: "+15555550123",
  type: "dedicated_outbound",
  status: "active",
  agent_identity_id: IDENTITY_ID,
  agent_handle: HANDLE,
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get() { return null; },
      getSetCookie() { return []; },
    } as unknown as Headers,
    json: () => Promise.resolve(body),
  } as Response;
}

function lastCall(): { url: string; init: RequestInit } {
  const calls = vi.mocked(fetch).mock.calls;
  const [url, init] = calls[calls.length - 1];
  return { url: String(url), init: init as RequestInit };
}

describe("IMessagesResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("send posts style and media by conversation id", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ message: IMESSAGE_DICT }));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const msg = await resource.send({
      conversationId: CONVO_ID,
      text: "Hi",
      mediaUrls: ["https://media.example/reply.jpg"],
      sendStyle: IMessageSendStyle.SLAM,
      agentIdentityId: IDENTITY_ID,
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/messages?agent_identity_id=${IDENTITY_ID}`);
    expect(JSON.parse(init.body as string)).toEqual({
      conversation_id: CONVO_ID,
      text: "Hi",
      media_urls: ["https://media.example/reply.jpg"],
      send_style: "slam",
    });
    expect(msg.id).toBe(MSG_ID);
    expect(msg.service).toBe(IMessageService.IMESSAGE);
    expect(msg.status).toBe(IMessageDeliveryStatus.QUEUED);
  });

  it("lists attached and unattached organization-owned numbers", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([
      NUMBER_DICT,
      {
        ...NUMBER_DICT,
        id: "99999999-0000-0000-0000-000000000002",
        type: "dedicated_inbound",
        status: "paused",
        agent_identity_id: null,
        agent_handle: null,
      },
    ]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const numbers = await resource.listNumbers();

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/numbers`);
    expect(init.method).toBe("GET");
    expect(numbers[0]).toEqual({
      id: NUMBER_ID,
      number: "+15555550123",
      type: IMessageNumberType.DEDICATED_OUTBOUND,
      status: IMessageNumberStatus.ACTIVE,
      agentIdentityId: IDENTITY_ID,
      agentHandle: HANDLE,
    });
    expect(numbers[1]).toEqual({
      id: "99999999-0000-0000-0000-000000000002",
      number: "+15555550123",
      type: IMessageNumberType.DEDICATED_INBOUND,
      status: IMessageNumberStatus.PAUSED,
      agentIdentityId: null,
      agentHandle: null,
    });
    expect(numbers.map((number) => (
      number.type === IMessageNumberType.DEDICATED_OUTBOUND
    ))).toEqual([true, false]);
  });

  it("claims a number with the exact type body and idempotency key", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(NUMBER_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const number = await resource.claimNumber({
      type: IMessageNumberType.DEDICATED_OUTBOUND,
      idempotencyKey: "claim-number-123",
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/numbers`);
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("Idempotency-Key")).toBe("claim-number-123");
    expect(JSON.parse(init.body as string)).toEqual({ type: "dedicated_outbound" });
    expect(number.id).toBe(NUMBER_ID);
  });

  it("rejects invalid idempotency keys before claiming", async () => {
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    await expect(resource.claimNumber({
      type: IMessageNumberType.DEDICATED_INBOUND,
      idempotencyKey: "",
    })).rejects.toThrow("between 1 and 255 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("retains a caller's key across an ambiguous retry", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(NUMBER_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));
    const options = {
      type: IMessageNumberType.DEDICATED_OUTBOUND,
      idempotencyKey: "stable-claim-key",
    } as const;

    await resource.claimNumber(options);
    await resource.claimNumber(options);

    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of vi.mocked(fetch).mock.calls) {
      expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("stable-claim-key");
    }
  });

  it("send by recipient omits the query string", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ message: IMESSAGE_DICT }));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    await resource.send({ to: REMOTE, text: "Hi", mediaUrls: ["https://m/x.png"] });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/messages`);
    expect(JSON.parse(init.body as string)).toEqual({
      to: REMOTE,
      text: "Hi",
      media_urls: ["https://m/x.png"],
    });
  });

  it("send serializes group recipients with style and media", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({
      message: { ...GROUP_IMESSAGE_DICT, send_style: "confetti" },
    }));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const message = await resource.send({
      to: [REMOTE, GROUP_REMOTE],
      text: "Hello group",
      mediaUrls: ["https://media.example/group.jpg"],
      sendStyle: IMessageSendStyle.CONFETTI,
      agentIdentityId: IDENTITY_ID,
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/messages?agent_identity_id=${IDENTITY_ID}`);
    expect(JSON.parse(init.body as string)).toEqual({
      to: [REMOTE, GROUP_REMOTE],
      text: "Hello group",
      media_urls: ["https://media.example/group.jpg"],
      send_style: "confetti",
    });
    expect(message.assignmentId).toBeNull();
    expect(message.remoteNumber).toBeNull();
    expect(message.senderNumber).toBe(REMOTE);
    expect(message.participants).toEqual([REMOTE, GROUP_REMOTE]);
    expect(message.isGroup).toBe(true);
    expect(message.sendStyle).toBe(IMessageSendStyle.CONFETTI);
    expect(message.recipients).toHaveLength(2);
  });

  it("list passes filters as snake_case query params", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([IMESSAGE_DICT]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const msgs = await resource.list({
      agentIdentityId: IDENTITY_ID,
      conversationId: CONVO_ID,
      isRead: false,
      isBlocked: false,
    });

    const { url } = lastCall();
    const params = new URL(url).searchParams;
    expect(params.get("limit")).toBe("50");
    expect(params.get("offset")).toBe("0");
    expect(params.get("agent_identity_id")).toBe(IDENTITY_ID);
    expect(params.get("conversation_id")).toBe(CONVO_ID);
    expect(params.get("is_read")).toBe("false");
    expect(params.get("is_blocked")).toBe("false");
    expect(msgs).toHaveLength(1);
    expect(msgs[0].conversationId).toBe(CONVO_ID);
  });

  it("list opts into groups explicitly", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([GROUP_IMESSAGE_DICT]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const messages = await resource.list({ includeGroups: true });

    const params = new URL(lastCall().url).searchParams;
    expect(params.get("include_groups")).toBe("true");
    expect(messages[0].isGroup).toBe(true);
  });

  it("listConversations parses summaries", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([CONVERSATION_SUMMARY_DICT]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const convos = await resource.listConversations({ isBlocked: false });

    const { url } = lastCall();
    expect(url.startsWith(`${BASE}/conversations?`)).toBe(true);
    expect(convos[0].remoteNumber).toBe(REMOTE);
    expect(convos[0].unreadCount).toBe(2);
    expect(convos[0].totalCount).toBe(5);
    expect(convos[0].latestMessageAt).toBeInstanceOf(Date);
    expect(convos[0].groupCreationStatus).toBeNull();
  });

  it("listConversations parses group summaries with nullable assignments", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([{
      ...CONVERSATION_SUMMARY_DICT,
      ...GROUP_CONVERSATION_DICT,
    }]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const conversations = await resource.listConversations({ includeGroups: true });

    const params = new URL(lastCall().url).searchParams;
    expect(params.get("include_groups")).toBe("true");
    expect(conversations[0].assignmentId).toBeNull();
    expect(conversations[0].assignmentStatus).toBeNull();
    expect(conversations[0].remoteNumber).toBeNull();
    expect(conversations[0].participants).toEqual([REMOTE, GROUP_REMOTE]);
    expect(conversations[0].isGroup).toBe(true);
    expect(conversations[0].groupCreationStatus).toBe(IMessageGroupCreationStatus.CREATING);
  });

  it("getConversation passes the identity assertion", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CONVERSATION_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const convo = await resource.getConversation(CONVO_ID, {
      agentIdentityId: IDENTITY_ID,
    });

    const { url } = lastCall();
    expect(url).toBe(
      `${BASE}/conversations/${CONVO_ID}?agent_identity_id=${IDENTITY_ID}`,
    );
    expect(convo.id).toBe(CONVO_ID);
    expect(convo.assignmentId).toBe(CONVERSATION_DICT.assignment_id);
  });

  it("getConversation returns a group without list opt-in", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(GROUP_CONVERSATION_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const conversation = await resource.getConversation(CONVO_ID);

    expect(lastCall().url).toBe(`${BASE}/conversations/${CONVO_ID}`);
    expect(conversation.isGroup).toBe(true);
    expect(conversation.assignmentId).toBeNull();
    expect(conversation.groupCreationStatus).toBe(IMessageGroupCreationStatus.CREATING);
  });

  it("sendReaction posts the tapback body", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(REACTION_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const reaction = await resource.sendReaction({
      messageId: MSG_ID,
      reaction: IMessageReactionType.LIKE,
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/reactions`);
    expect(JSON.parse(init.body as string)).toEqual({
      message_id: MSG_ID,
      reaction: "like",
      part_index: 0,
    });
    expect(reaction.reaction).toBe(IMessageReactionType.LIKE);
    expect(reaction.targetMessageId).toBe(MSG_ID);
  });

  it("sendReaction supports an inbound group target without changing the request", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(GROUP_REACTION_DICT));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const reaction = await resource.sendReaction({
      messageId: MSG_ID,
      reaction: IMessageReactionType.EYES,
      partIndex: 1,
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/reactions`);
    expect(JSON.parse(init.body as string)).toEqual({
      message_id: MSG_ID,
      reaction: "eyes",
      part_index: 1,
    });
    expect(reaction.assignmentId).toBeNull();
    expect(reaction.reaction).toBe(IMessageReactionType.EYES);
  });

  it("markConversationRead returns the updated count", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ conversation_id: CONVO_ID, updated_count: 3 }),
    );
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const result = await resource.markConversationRead(CONVO_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/mark-read`);
    expect(JSON.parse(init.body as string)).toEqual({ conversation_id: CONVO_ID });
    expect(result.updatedCount).toBe(3);
    expect(result.conversationId).toBe(CONVO_ID);
  });

  it("sendTyping posts the conversation id", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ status: "sent" }));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    await resource.sendTyping(CONVO_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/typing`);
    expect(JSON.parse(init.body as string)).toEqual({ conversation_id: CONVO_ID });
  });

  it("uploadMedia posts multipart form data and parses the URL", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ media_url: "https://media.example/abc.png", content_type: "image/png", size: 3 }),
    );
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const upload = await resource.uploadMedia({
      content: new Uint8Array([1, 2, 3]),
      filename: "abc.png",
      contentType: "image/png",
    });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/media`);
    expect(init.body).toBeInstanceOf(FormData);
    const file = (init.body as FormData).get("file") as File;
    expect(file.name).toBe("abc.png");
    // No manual Content-Type header — fetch must set the multipart boundary.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(upload.mediaUrl).toBe("https://media.example/abc.png");
    expect(upload.size).toBe(3);
  });
});

describe("parseIMessage", () => {
  it("maps the full wire shape to camelCase", () => {
    const msg = parseIMessage(IMESSAGE_DICT);

    expect(msg.remoteNumber).toBe(REMOTE);
    expect(msg.senderNumber).toBeNull();
    expect(msg.participants).toBeNull();
    expect(msg.isGroup).toBe(false);
    expect(msg.messageType).toBe("message");
    expect(msg.sendStyle).toBe(IMessageSendStyle.SLAM);
    expect(msg.wasDowngraded).toBe(false);
    expect(msg.isBlocked).toBe(false);
    expect(msg.media?.[0]).toEqual({
      url: "https://media.example/a.png",
      contentType: "image/png",
      size: 10,
    });
    expect(msg.recipients?.[0].remoteNumber).toBe(REMOTE);
    expect(msg.recipients?.[0].deliveryStatus).toBe(IMessageDeliveryStatus.QUEUED);
    expect(msg.reactions?.[0].reaction).toBe(IMessageReactionType.CUSTOM);
    expect(msg.reactions?.[0].customEmoji).toBe("\u{1F334}");
    expect(msg.reactions?.[0].direction).toBe("inbound");
    expect(msg.createdAt).toBeInstanceOf(Date);
  });

  it("defaults optional fields on a minimal inbound row", () => {
    const msg = parseIMessage({
      id: MSG_ID,
      conversation_id: CONVO_ID,
      assignment_id: "bbbb2222-0000-0000-0000-000000000001",
      direction: "inbound",
      remote_number: REMOTE,
      message_type: "message",
      service: "imessage",
      is_read: false,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });

    expect(msg.content).toBeNull();
    expect(msg.sendStyle).toBeNull();
    expect(msg.media).toBeNull();
    expect(msg.status).toBeNull();
    expect(msg.recipients).toBeNull();
    expect(msg.reactions).toBeNull();
    expect(msg.isBlocked).toBe(false);
  });
});

describe("IMessagesResource.getTriageNumber", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches and parses the triage line", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ number: "+15555550100", connect_command: "connect @support-bot" }),
    );
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const triage = await resource.getTriageNumber();

    const { url } = lastCall();
    expect(url).toBe(`${BASE}/triage-number`);
    expect(triage.number).toBe("+15555550100");
    expect(triage.connectCommand).toBe("connect @support-bot");
  });
});

describe("IMessageContactRulesResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list targets the per-identity path with filters", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([CONTACT_RULE_DICT]));
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    const rules = await resource.list(HANDLE, {
      action: IMessageRuleAction.BLOCK,
      limit: 10,
      offset: 5,
    });

    const { url } = lastCall();
    const parsed = new URL(url);
    expect(parsed.pathname.endsWith(`/identities/${HANDLE}/contact-rules`)).toBe(true);
    expect(parsed.searchParams.get("action")).toBe("block");
    expect(parsed.searchParams.get("limit")).toBe("10");
    expect(parsed.searchParams.get("offset")).toBe("5");
    expect(rules[0].matchTarget).toBe(REMOTE);
    expect(rules[0].status).toBe(ContactRuleStatus.ACTIVE);
  });

  it("get fetches one rule", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CONTACT_RULE_DICT));
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    const rule = await resource.get(HANDLE, RULE_ID);

    const { url } = lastCall();
    expect(url).toBe(`${BASE}/identities/${HANDLE}/contact-rules/${RULE_ID}`);
    expect(rule.id).toBe(RULE_ID);
  });

  it("create defaults match_type to exact_number", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CONTACT_RULE_DICT));
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    const rule = await resource.create(HANDLE, {
      action: IMessageRuleAction.BLOCK,
      matchTarget: REMOTE,
    });

    const { init } = lastCall();
    expect(JSON.parse(init.body as string)).toEqual({
      action: "block",
      match_type: "exact_number",
      match_target: REMOTE,
    });
    expect(rule.action).toBe(IMessageRuleAction.BLOCK);
    expect(rule.agentIdentityId).toBe(IDENTITY_ID);
  });

  it("update patches action/status", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CONTACT_RULE_DICT));
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    await resource.update(HANDLE, RULE_ID, { status: ContactRuleStatus.PAUSED });

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/identities/${HANDLE}/contact-rules/${RULE_ID}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ status: "paused" });
  });

  it("delete targets the rule path", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: { get() { return null; }, getSetCookie() { return []; } } as unknown as Headers,
      json: () => Promise.resolve(undefined),
    } as Response);
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    await resource.delete(HANDLE, RULE_ID);

    const { url, init } = lastCall();
    expect(url).toBe(`${BASE}/identities/${HANDLE}/contact-rules/${RULE_ID}`);
    expect(init.method).toBe("DELETE");
  });

  it("listAll targets the org-wide path with identity filter", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([CONTACT_RULE_DICT]));
    const resource = new IMessageContactRulesResource(new HttpTransport("k", BASE));

    await resource.listAll({ agentIdentityId: IDENTITY_ID });

    const { url } = lastCall();
    const parsed = new URL(url);
    expect(parsed.pathname.endsWith("/contact-rules")).toBe(true);
    expect(parsed.searchParams.get("agent_identity_id")).toBe(IDENTITY_ID);
  });
});

describe("identity iMessage fields", () => {
  it("parses imessage_enabled and filter mode on summaries", async () => {
    const { parseAgentIdentitySummary } = await import("../src/identities/types.js");
    const summary = parseAgentIdentitySummary({
      id: IDENTITY_ID,
      organization_id: "org_x",
      agent_handle: HANDLE,
      display_name: null,
      description: null,
      email_address: null,
      imessage_enabled: true,
      imessage_filter_mode: "whitelist",
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
    expect(summary.imessageEnabled).toBe(true);
    expect(summary.imessageFilterMode).toBe("whitelist");
  });

  it("defaults the fields when absent from the wire", async () => {
    const { parseAgentIdentitySummary } = await import("../src/identities/types.js");
    const summary = parseAgentIdentitySummary({
      id: IDENTITY_ID,
      organization_id: "org_x",
      agent_handle: HANDLE,
      display_name: null,
      description: null,
      email_address: null,
      created_at: "2026-06-01T00:00:00Z",
      updated_at: "2026-06-01T00:00:00Z",
    });
    expect(summary.imessageEnabled).toBe(false);
    expect(summary.imessageFilterMode).toBe("blacklist");
  });
});

describe("IMessagesResource.listAssignments", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("lists active connections with pagination and identity filter", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([
      {
        id: "bbbb2222-0000-0000-0000-000000000001",
        remote_number: REMOTE,
        agent_identity_id: IDENTITY_ID,
        organization_id: "org_x",
        status: "active",
        released_at: null,
        created_at: "2026-06-01T00:00:00Z",
        updated_at: "2026-06-01T00:00:00Z",
      },
    ]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const rows = await resource.listAssignments({
      agentIdentityId: IDENTITY_ID,
      limit: 25,
      offset: 50,
    });

    const { url } = lastCall();
    const params = new URL(url).searchParams;
    expect(new URL(url).pathname.endsWith("/assignments")).toBe(true);
    expect(params.get("limit")).toBe("25");
    expect(params.get("offset")).toBe("50");
    expect(params.get("agent_identity_id")).toBe(IDENTITY_ID);
    expect(rows[0].status).toBe(IMessageAssignmentStatus.ACTIVE);
    expect(rows[0].remoteNumber).toBe(REMOTE);
    expect(rows[0].releasedAt).toBeNull();
  });
});

describe("conversation assignmentStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses a released connection state", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ ...CONVERSATION_DICT, assignment_status: "released" }));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const convo = await resource.getConversation(CONVO_ID);

    expect(convo.assignmentStatus).toBe(IMessageAssignmentStatus.RELEASED);
  });

  it("defaults to active when the field is absent", async () => {
    vi.mocked(fetch).mockResolvedValue(ok([CONVERSATION_SUMMARY_DICT]));
    const resource = new IMessagesResource(new HttpTransport("k", BASE));

    const convos = await resource.listConversations();

    expect(convos[0].assignmentStatus).toBe(IMessageAssignmentStatus.ACTIVE);
  });
});

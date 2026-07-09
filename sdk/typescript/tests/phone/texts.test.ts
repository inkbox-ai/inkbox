// sdk/typescript/tests/phone/texts.test.ts
import { describe, it, expect, vi } from "vitest";
import { TextsResource } from "../../src/phone/resources/texts.js";
import type { HttpTransport } from "../../src/_http.js";
import {
  RAW_TEXT_MESSAGE,
  RAW_TEXT_MESSAGE_BLOCKED,
  RAW_TEXT_MESSAGE_GROUP,
  RAW_TEXT_MESSAGE_MMS,
  RAW_TEXT_MESSAGE_OUTBOUND_QUEUED,
  RAW_TEXT_CONVERSATION_GROUP_SUMMARY,
  RAW_TEXT_CONVERSATION_SUMMARY,
} from "../sampleData.js";
import {
  SmsDeliveryStatus,
  TextMessageOrigin,
} from "../../src/phone/types.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const NUM_ID = "aaaa1111-0000-0000-0000-000000000001";
const TEXT_ID = "dddd4444-0000-0000-0000-000000000001";
const REMOTE = "+15551234567";

describe("TextsResource.send", () => {
  it("posts to the correct path with to/text", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_TEXT_MESSAGE_OUTBOUND_QUEUED);
    const res = new TextsResource(http);

    await res.send(NUM_ID, { to: "+15551234567", text: "Hello" });

    expect(http.post).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts`,
      { to: "+15551234567", text: "Hello" },
    );
  });

  it("returns parsed message with lifecycle fields", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_TEXT_MESSAGE_OUTBOUND_QUEUED);
    const res = new TextsResource(http);

    const msg = await res.send(NUM_ID, { to: REMOTE, text: "Hello from Inkbox" });

    expect(msg.direction).toBe("outbound");
    expect(msg.deliveryStatus).toBe(SmsDeliveryStatus.QUEUED);
    expect(msg.origin).toBe(TextMessageOrigin.USER_INITIATED);
    expect(msg.sentAt).toBeNull();
    expect(msg.deliveredAt).toBeNull();
    expect(msg.failedAt).toBeNull();
    expect(msg.conversationId).toBe("eeee1111-0000-0000-0000-000000000001");
    // Outbound rows carry senderPhoneNumber=null; the implicit sender is the
    // local phone number. Only inbound rows have a non-null sender.
    expect(msg.senderPhoneNumber).toBeNull();
    expect(msg.recipients).toHaveLength(1);
    expect(msg.recipients?.[0].recipientPhoneNumber).toBe(REMOTE);
  });

  it("posts group MMS payloads", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_TEXT_MESSAGE_GROUP);
    const res = new TextsResource(http);

    const msg = await res.send(NUM_ID, {
      to: ["+15551234567", "+15557654321"],
      text: "Hello group",
      mediaUrls: ["https://example.com/photo.jpg"],
    });

    expect(http.post).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts`,
      {
        to: ["+15551234567", "+15557654321"],
        text: "Hello group",
        media_urls: ["https://example.com/photo.jpg"],
      },
    );
    expect(msg.remotePhoneNumber).toBeNull();
    expect(msg.recipients).toHaveLength(2);
  });

  it("posts conversation reply payloads", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_TEXT_MESSAGE_GROUP);
    const res = new TextsResource(http);
    const conversationId = "eeee1111-0000-0000-0000-0000000000fa";

    await res.send(NUM_ID, { conversationId, text: "Reply all" });

    expect(http.post).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts`,
      { conversation_id: conversationId, text: "Reply all" },
    );
  });
});

describe("TextsResource.list", () => {
  it("uses default limit and offset", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE]);
    const res = new TextsResource(http);

    const texts = await res.list(NUM_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts`, {
      limit: 50,
      offset: 0,
    });
    expect(texts).toHaveLength(1);
    expect(texts[0].direction).toBe("inbound");
    expect(texts[0].remotePhoneNumber).toBe(REMOTE);
    expect(texts[0].isRead).toBe(false);
  });

  it("forwards date-range params verbatim, only when set", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.list(NUM_ID, {
      startDatetime: "2026-07-01",
      endDatetime: "2026-07-08T15:30:00Z",
      tz: "America/New_York",
    });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts`, {
      limit: 50,
      offset: 0,
      start_datetime: "2026-07-01",
      end_datetime: "2026-07-08T15:30:00Z",
      tz: "America/New_York",
    });
  });

  it("passes isRead filter", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.list(NUM_ID, { isRead: false });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts`, {
      limit: 50,
      offset: 0,
      is_read: false,
    });
  });

  it("forwards isBlocked=true for the admin-side blocked listing", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE_BLOCKED]);
    const res = new TextsResource(http);

    const texts = await res.list(NUM_ID, { isBlocked: true });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts`, {
      limit: 50,
      offset: 0,
      is_blocked: true,
    });
    expect(texts[0].isBlocked).toBe(true);
  });

  it("forwards isBlocked=false to keep the admin/JWT view clean of blocked spam", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE]);
    const res = new TextsResource(http);

    const texts = await res.list(NUM_ID, { isBlocked: false });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts`, {
      limit: 50,
      offset: 0,
      is_blocked: false,
    });
    expect(texts[0].isBlocked).toBe(false);
  });

  it("defaults isBlocked to false when missing from server response (back-compat)", async () => {
    const http = mockHttp();
    const { is_blocked: _ignored, ...legacyPayload } = RAW_TEXT_MESSAGE;
    void _ignored;
    vi.mocked(http.get).mockResolvedValue([legacyPayload]);
    const res = new TextsResource(http);

    const texts = await res.list(NUM_ID);

    expect(texts[0].isBlocked).toBe(false);
  });

  it("parses MMS with media", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE_MMS]);
    const res = new TextsResource(http);

    const texts = await res.list(NUM_ID);

    expect(texts[0].type).toBe("mms");
    expect(texts[0].media).toHaveLength(1);
    expect(texts[0].media![0].contentType).toBe("image/jpeg");
    expect(texts[0].media![0].size).toBe(534972);
  });
});

describe("TextsResource.get", () => {
  it("fetches by ID", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_TEXT_MESSAGE);
    const res = new TextsResource(http);

    const text = await res.get(NUM_ID, TEXT_ID);

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts/${TEXT_ID}`);
    expect(text.id).toBe(TEXT_ID);
  });
});

describe("TextsResource.update", () => {
  it("marks as read", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({ ...RAW_TEXT_MESSAGE, is_read: true });
    const res = new TextsResource(http);

    const text = await res.update(NUM_ID, TEXT_ID, { isRead: true });

    expect(http.patch).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/${TEXT_ID}`,
      { is_read: true },
    );
    expect(text.isRead).toBe(true);
  });

});

describe("TextsResource.search", () => {
  it("searches with query", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE]);
    const res = new TextsResource(http);

    const results = await res.search(NUM_ID, { q: "support", limit: 10 });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts/search`, {
      q: "support",
      limit: 10,
    });
    expect(results).toHaveLength(1);
  });

  it("forwards isBlocked=true to search the blocked folder", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE_BLOCKED]);
    const res = new TextsResource(http);

    const results = await res.search(NUM_ID, { q: "crypto", isBlocked: true });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts/search`, {
      q: "crypto",
      limit: 50,
      is_blocked: true,
    });
    expect(results[0].isBlocked).toBe(true);
  });

  it("forwards isBlocked=false to keep admin search clean", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.search(NUM_ID, { q: "invoice", isBlocked: false });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts/search`, {
      q: "invoice",
      limit: 50,
      is_blocked: false,
    });
  });

  it("omits is_blocked param when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.search(NUM_ID, { q: "hello" });

    expect(http.get).toHaveBeenCalledWith(`/numbers/${NUM_ID}/texts/search`, {
      q: "hello",
      limit: 50,
    });
  });
});

describe("TextsResource.listConversations", () => {
  it("returns summaries", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_CONVERSATION_SUMMARY]);
    const res = new TextsResource(http);

    const convos = await res.listConversations(NUM_ID);

    expect(http.get).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations`,
      { limit: 50, offset: 0 },
    );
    expect(convos).toHaveLength(1);
    expect(convos[0].remotePhoneNumber).toBe(REMOTE);
    expect(convos[0].unreadCount).toBe(3);
    expect(convos[0].totalCount).toBe(15);
    expect(convos[0].latestHasMedia).toBe(false);
    expect(convos[0].id).toBe("eeee1111-0000-0000-0000-000000000001");
    expect(convos[0].participants).toStrictEqual([REMOTE]);
    expect(convos[0].isGroup).toBe(false);
  });

  it("can include group conversations", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_CONVERSATION_GROUP_SUMMARY]);
    const res = new TextsResource(http);

    const convos = await res.listConversations(NUM_ID, { includeGroups: true });

    expect(http.get).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations`,
      { limit: 50, offset: 0, include_groups: true },
    );
    expect(convos[0].remotePhoneNumber).toBeNull();
    expect(convos[0].isGroup).toBe(true);
    expect(convos[0].latestHasMedia).toBe(true);
    expect(convos[0].participants).toStrictEqual(["+15551234567", "+15557654321"]);
  });

  it("forwards isBlocked=false to hide spam-only counterparties", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.listConversations(NUM_ID, { isBlocked: false });

    expect(http.get).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations`,
      { limit: 50, offset: 0, is_blocked: false },
    );
  });

  it("forwards isBlocked=true to narrow to blocked-only conversations", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new TextsResource(http);

    await res.listConversations(NUM_ID, { isBlocked: true });

    expect(http.get).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations`,
      { limit: 50, offset: 0, is_blocked: true },
    );
  });
});

describe("TextsResource.getConversation", () => {
  it("returns messages for remote number", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_TEXT_MESSAGE]);
    const res = new TextsResource(http);

    const msgs = await res.getConversation(NUM_ID, REMOTE, { limit: 20 });

    expect(http.get).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations/${REMOTE}`,
      { limit: 20, offset: 0 },
    );
    expect(msgs).toHaveLength(1);
  });
});

describe("TextsResource.updateConversation", () => {
  it("marks conversation as read", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({
      remote_phone_number: REMOTE,
      conversation_id: "eeee1111-0000-0000-0000-000000000001",
      is_read: true,
      updated_count: 5,
    });
    const res = new TextsResource(http);

    const result = await res.updateConversation(NUM_ID, REMOTE, { isRead: true });

    expect(http.patch).toHaveBeenCalledWith(
      `/numbers/${NUM_ID}/texts/conversations/${REMOTE}`,
      { is_read: true },
    );
    expect(result.updatedCount).toBe(5);
    expect(result.remotePhoneNumber).toBe(REMOTE);
    expect(result.conversationId).toBe("eeee1111-0000-0000-0000-000000000001");
  });
});

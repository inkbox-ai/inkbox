// sdk/typescript/tests/phone/texts.test.ts
import { describe, it, expect, vi } from "vitest";
import { TextsResource } from "../../src/phone/resources/texts.js";
import type { HttpTransport } from "../../src/_http.js";
import {
  RAW_TEXT_MESSAGE,
  RAW_TEXT_MESSAGE_MMS,
  RAW_TEXT_CONVERSATION_SUMMARY,
} from "../sampleData.js";

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
const REMOTE = "+15167251294";

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
  });
});

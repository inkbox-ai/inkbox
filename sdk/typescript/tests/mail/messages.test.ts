// sdk/typescript/tests/mail/messages.test.ts
import { describe, it, expect, vi } from "vitest";
import { MessagesResource } from "../../src/mail/resources/messages.js";
import type { HttpTransport } from "../../src/_http.js";
import {
  RAW_MESSAGE,
  RAW_MESSAGE_DETAIL,
  CURSOR_PAGE_MESSAGES,
  CURSOR_PAGE_MESSAGES_MULTI,
} from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const ADDR = "agent01@inkbox.ai";
const MSG_ID = "bbbb2222-0000-0000-0000-000000000001";

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe("MessagesResource.list", () => {
  it("yields messages from a single page", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(CURSOR_PAGE_MESSAGES);
    const res = new MessagesResource(http);

    const messages = await collect(res.list(ADDR));

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(RAW_MESSAGE.id);
  });

  it("paginates through multiple pages", async () => {
    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(CURSOR_PAGE_MESSAGES_MULTI)
      .mockResolvedValueOnce(CURSOR_PAGE_MESSAGES);
    const res = new MessagesResource(http);

    const messages = await collect(res.list(ADDR));

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(messages).toHaveLength(2);
  });

  it("returns empty for empty page", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({ items: [], next_cursor: null, has_more: false });
    const res = new MessagesResource(http);

    const messages = await collect(res.list(ADDR));
    expect(messages).toHaveLength(0);
  });
});

describe("MessagesResource.get", () => {
  it("returns MessageDetail", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_MESSAGE_DETAIL);
    const res = new MessagesResource(http);

    const detail = await res.get(ADDR, MSG_ID);

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDR}/messages/${MSG_ID}`);
    expect(detail.bodyText).toBe("Hi there, this is a test message body.");
  });
});

describe("MessagesResource.send", () => {
  it("sends basic message", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);

    const msg = await res.send(ADDR, { to: ["user@example.com"], subject: "Hi" });

    const [path, body] = vi.mocked(http.post).mock.calls[0];
    expect(path).toBe(`/mailboxes/${ADDR}/messages`);
    expect((body as Record<string, unknown>)["subject"]).toBe("Hi");
    expect(msg.fromAddress).toBe("user@example.com");
  });

  it("includes all optional fields", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);

    await res.send(ADDR, {
      to: ["a@example.com"],
      subject: "Test",
      bodyText: "plain",
      bodyHtml: "<p>html</p>",
      cc: ["b@example.com"],
      bcc: ["c@example.com"],
      inReplyToMessageId: "<orig@mail>",
    });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["body_text"]).toBe("plain");
    expect(body["body_html"]).toBe("<p>html</p>");
    expect(body["in_reply_to_message_id"]).toBe("<orig@mail>");
    expect((body["recipients"] as Record<string, unknown>)["cc"]).toEqual(["b@example.com"]);
  });

  it("omits optional fields when not provided", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);

    await res.send(ADDR, { to: ["a@example.com"], subject: "Test" });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["body_text"]).toBeUndefined();
    expect(body["in_reply_to_message_id"]).toBeUndefined();
  });
});

describe("MessagesResource.updateFlags", () => {
  it("sends is_read flag", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);

    await res.updateFlags(ADDR, MSG_ID, { isRead: true });

    expect(http.patch).toHaveBeenCalledWith(
      `/mailboxes/${ADDR}/messages/${MSG_ID}`,
      { is_read: true },
    );
  });

  it("sends both flags", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);

    await res.updateFlags(ADDR, MSG_ID, { isRead: false, isStarred: true });

    expect(http.patch).toHaveBeenCalledWith(
      `/mailboxes/${ADDR}/messages/${MSG_ID}`,
      { is_read: false, is_starred: true },
    );
  });
});

describe("MessagesResource convenience methods", () => {
  it("markRead delegates to updateFlags", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);
    await res.markRead(ADDR, MSG_ID);
    expect(http.patch).toHaveBeenCalledWith(expect.any(String), { is_read: true });
  });

  it("markUnread delegates to updateFlags", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);
    await res.markUnread(ADDR, MSG_ID);
    expect(http.patch).toHaveBeenCalledWith(expect.any(String), { is_read: false });
  });

  it("star delegates to updateFlags", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);
    await res.star(ADDR, MSG_ID);
    expect(http.patch).toHaveBeenCalledWith(expect.any(String), { is_starred: true });
  });

  it("unstar delegates to updateFlags", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MESSAGE);
    const res = new MessagesResource(http);
    await res.unstar(ADDR, MSG_ID);
    expect(http.patch).toHaveBeenCalledWith(expect.any(String), { is_starred: false });
  });
});

describe("MessagesResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new MessagesResource(http);

    await res.delete(ADDR, MSG_ID);

    expect(http.delete).toHaveBeenCalledWith(`/mailboxes/${ADDR}/messages/${MSG_ID}`);
  });
});

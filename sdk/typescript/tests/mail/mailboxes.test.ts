import { describe, it, expect, vi } from "vitest";
import { MailboxesResource } from "../../src/mail/resources/mailboxes.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_MAILBOX, RAW_MESSAGE, CURSOR_PAGE_MESSAGES } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const ADDR = "agent01@inkbox.ai";

describe("MailboxesResource.create", () => {
  it("creates with displayName", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MAILBOX);
    const res = new MailboxesResource(http);

    const mailbox = await res.create({ agentHandle: "sales-agent", displayName: "Agent 01" });

    expect(http.post).toHaveBeenCalledWith("/mailboxes", {
      agent_handle: "sales-agent",
      display_name: "Agent 01",
    });
    expect(mailbox.emailAddress).toBe("agent01@inkbox.ai");
  });

  it("creates without displayName omits the field", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_MAILBOX);
    const res = new MailboxesResource(http);

    await res.create({ agentHandle: "sales-agent" });

    const [, body] = vi.mocked(http.post).mock.calls[0];
    expect((body as Record<string, unknown>)["display_name"]).toBeUndefined();
  });
});

describe("MailboxesResource.list", () => {
  it("returns array of mailboxes", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_MAILBOX]);
    const res = new MailboxesResource(http);

    const mailboxes = await res.list();

    expect(http.get).toHaveBeenCalledWith("/mailboxes");
    expect(mailboxes).toHaveLength(1);
    expect(mailboxes[0].emailAddress).toBe("agent01@inkbox.ai");
  });

  it("returns empty array", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new MailboxesResource(http);
    expect(await res.list()).toEqual([]);
  });
});

describe("MailboxesResource.get", () => {
  it("fetches by email address", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_MAILBOX);
    const res = new MailboxesResource(http);

    const mailbox = await res.get(ADDR);

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDR}`);
    expect(mailbox.displayName).toBe("Agent 01");
  });
});

describe("MailboxesResource.update", () => {
  it("sends displayName", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({ ...RAW_MAILBOX, display_name: "New Name" });
    const res = new MailboxesResource(http);

    const mailbox = await res.update(ADDR, { displayName: "New Name" });

    expect(http.patch).toHaveBeenCalledWith(`/mailboxes/${ADDR}`, { display_name: "New Name" });
    expect(mailbox.displayName).toBe("New Name");
  });

  it("sends empty body when no options provided", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_MAILBOX);
    const res = new MailboxesResource(http);

    await res.update(ADDR, {});

    expect(http.patch).toHaveBeenCalledWith(`/mailboxes/${ADDR}`, {});
  });
});

describe("MailboxesResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new MailboxesResource(http);

    await res.delete(ADDR);

    expect(http.delete).toHaveBeenCalledWith(`/mailboxes/${ADDR}`);
  });
});

describe("MailboxesResource.search", () => {
  it("passes q and default limit", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(CURSOR_PAGE_MESSAGES);
    const res = new MailboxesResource(http);

    const results = await res.search(ADDR, { q: "invoice" });

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDR}/search`, { q: "invoice", limit: 50 });
    expect(results).toHaveLength(1);
    expect(results[0].subject).toBe("Hello from test");
  });

  it("passes custom limit", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({ items: [], next_cursor: null, has_more: false });
    const res = new MailboxesResource(http);

    await res.search(ADDR, { q: "test", limit: 10 });

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDR}/search`, { q: "test", limit: 10 });
  });
});

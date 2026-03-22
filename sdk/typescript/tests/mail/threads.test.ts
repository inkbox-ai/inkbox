// sdk/typescript/tests/mail/threads.test.ts
import { describe, it, expect, vi } from "vitest";
import { ThreadsResource } from "../../src/mail/resources/threads.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_THREAD, RAW_THREAD_DETAIL, CURSOR_PAGE_THREADS } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const ADDR = "agent01@inkbox.ai";
const THREAD_ID = "eeee5555-0000-0000-0000-000000000001";

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of gen) items.push(item);
  return items;
}

describe("ThreadsResource.list", () => {
  it("yields threads from a single page", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(CURSOR_PAGE_THREADS);
    const res = new ThreadsResource(http);

    const threads = await collect(res.list(ADDR));

    expect(http.get).toHaveBeenCalledTimes(1);
    expect(threads).toHaveLength(1);
    expect(threads[0].subject).toBe("Hello from test");
  });

  it("paginates through multiple pages", async () => {
    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce({ items: [RAW_THREAD], next_cursor: "cur-1", has_more: true })
      .mockResolvedValueOnce(CURSOR_PAGE_THREADS);
    const res = new ThreadsResource(http);

    const threads = await collect(res.list(ADDR));

    expect(http.get).toHaveBeenCalledTimes(2);
    expect(threads).toHaveLength(2);
  });

  it("returns empty for empty page", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue({ items: [], next_cursor: null, has_more: false });
    const res = new ThreadsResource(http);
    expect(await collect(res.list(ADDR))).toHaveLength(0);
  });
});

describe("ThreadsResource.get", () => {
  it("returns ThreadDetail with nested messages", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_THREAD_DETAIL);
    const res = new ThreadsResource(http);

    const detail = await res.get(ADDR, THREAD_ID);

    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${ADDR}/threads/${THREAD_ID}`);
    expect(detail.messageCount).toBe(2);
    expect(detail.messages).toHaveLength(1);
  });
});

describe("ThreadsResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new ThreadsResource(http);

    await res.delete(ADDR, THREAD_ID);

    expect(http.delete).toHaveBeenCalledWith(`/mailboxes/${ADDR}/threads/${THREAD_ID}`);
  });
});

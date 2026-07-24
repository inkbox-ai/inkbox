import { describe, expect, it, vi } from "vitest";
import { MailImportUploadError } from "../../src/_http.js";
import { MailboxImportsResource } from "../../src/mail/resources/imports.js";
import { MailImportFormat, MailImportJobStatus } from "../../src/mail/types.js";
import type { HttpTransport } from "../../src/_http.js";

const MAILBOX = "archive@example.com";
const JOB_ID = "11111111-1111-1111-1111-111111111111";

function rawJob(status = "running") {
  return {
    id: JOB_ID,
    mailbox_id: "22222222-2222-2222-2222-222222222222",
    status,
    source_format: "zip",
    original_addresses: ["old@example.com"],
    mark_as_read: true,
    upload_size_bytes: 123,
    messages_processed: 4,
    messages_imported: 2,
    messages_skipped_duplicate: 1,
    messages_failed: 0,
    messages_rejected_unsafe: 1,
    error_detail: null,
    created_at: "2026-07-24T12:00:00Z",
    updated_at: "2026-07-24T12:01:00Z",
    started_at: "2026-07-24T12:00:10Z",
    finished_at: null,
  };
}

function mockHttp() {
  return { get: vi.fn(), post: vi.fn() } as unknown as HttpTransport;
}

describe("MailboxImportsResource", () => {
  it("creates and lists typed jobs", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      job: rawJob("pending_upload"),
      upload: { url: "https://uploads.example.test", fields: { key: "k" }, expires_in_seconds: 60 },
    });
    const resource = new MailboxImportsResource(http);
    const created = await resource.create(MAILBOX, {
      sourceFormat: MailImportFormat.ZIP,
      originalAddresses: ["old@example.com"],
      markAsRead: false,
    });
    expect(created.job.status).toBe(MailImportJobStatus.PENDING_UPLOAD);
    expect(created.job.messagesRejectedUnsafe).toBe(1);
    expect(http.post).toHaveBeenCalledWith(`/mailboxes/${MAILBOX}/imports`, {
      source_format: "zip",
      original_addresses: ["old@example.com"],
      mark_as_read: false,
    });

    vi.mocked(http.get).mockResolvedValue({ items: [rawJob()], next_cursor: "next", has_more: true });
    const page = await resource.list(MAILBOX, { cursor: "cursor", limit: 10 });
    expect(page.hasMore).toBe(true);
    expect(http.get).toHaveBeenCalledWith(`/mailboxes/${MAILBOX}/imports`, {
      cursor: "cursor",
      limit: 10,
    });
  });

  it.each(["completed", "failed", "cancelled"])("wait returns terminal %s jobs", async (status) => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(rawJob(status));
    const result = await new MailboxImportsResource(http).wait(MAILBOX, JOB_ID, {
      pollIntervalMs: 1,
    });
    expect(result.status).toBe(status);
  });

  it("wait times out without cancelling", async () => {
    vi.useFakeTimers();
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(rawJob());
    const promise = new MailboxImportsResource(http).wait(MAILBOX, JOB_ID, {
      timeoutMs: 10,
      pollIntervalMs: 5,
    });
    const rejection = expect(promise).rejects.toThrow("Timed out waiting");
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    expect(http.post).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("normalizes a poll request deadline", async () => {
    const http = mockHttp();
    const timeout = new Error("aborted");
    timeout.name = "AbortError";
    vi.mocked(http.get).mockRejectedValue(timeout);
    await expect(new MailboxImportsResource(http).wait(MAILBOX, JOB_ID, {
      timeoutMs: 10,
    })).rejects.toThrow(`Timed out waiting for import job ${JOB_ID}`);
  });

  it("uploads fields before the Blob without credentials or API headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const resource = new MailboxImportsResource(mockHttp());
    await resource.upload(
      { url: "https://uploads.example.test", fields: { policy: "p", key: "k" }, expiresInSeconds: 60 },
      new Blob(["Subject: Test\n\nBody"]),
      { fileName: "message.eml" },
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("omit");
    expect(init.headers).toBeUndefined();
    expect([...init.body.keys()]).toEqual(["policy", "key", "file"]);
    vi.unstubAllGlobals();
  });

  it("throws a distinct upload error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("denied", { status: 403 })));
    const resource = new MailboxImportsResource(mockHttp());
    await expect(resource.upload(
      { url: "https://uploads.example.test", fields: {}, expiresInSeconds: 60 },
      new Blob(["x"]),
    )).rejects.toBeInstanceOf(MailImportUploadError);
    vi.unstubAllGlobals();
  });

  it("can bound a stalled upload", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    })));
    const resource = new MailboxImportsResource(mockHttp());
    const upload = resource.upload(
      { url: "https://uploads.example.test", fields: {}, expiresInSeconds: 60 },
      new Blob(["x"]),
      { timeoutMs: 10 },
    );

    const rejection = expect(upload).rejects.toBeInstanceOf(MailImportUploadError);
    await vi.advanceTimersByTimeAsync(11);
    await rejection;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

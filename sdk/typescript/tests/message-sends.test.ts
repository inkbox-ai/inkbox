import { describe, expect, it, vi } from "vitest";
import { InkboxAPIError, InkboxConnectionError, HttpTransport } from "../src/_http.js";
import { MessageSendsResource, getMessageRequestKey, postMessage } from "../src/message_sends.js";
import type { MailboxesResource } from "../src/mail/resources/mailboxes.js";

describe("message request identity", () => {
  it("recovers a response-body disconnect with the original key and input", async () => {
    vi.useFakeTimers();
    const disconnected = new Response(new ReadableStream({
      start(controller) { controller.error(new TypeError("terminated")); },
    }), { status: 201 });
    const fetchMock = vi.fn().mockResolvedValueOnce(disconnected)
      .mockResolvedValueOnce(Response.json({ id: "original" }, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pending = postMessage(new HttpTransport("test-only", "https://api.example.com"),
        "/messages", { text: "hello" });
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ id: "original" });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      const first = fetchMock.mock.calls[0][1];
      const second = fetchMock.mock.calls[1][1];
      expect(first.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(second.headers).toEqual(first.headers);
      expect(second.body).toBe(first.body);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });

  it("bounds repeated response-body disconnects and preserves the cause and key", async () => {
    vi.useFakeTimers();
    const cause = new TypeError("terminated");
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new ReadableStream({
      start(controller) { controller.error(cause); },
    }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const pending = postMessage(new HttpTransport("test-only", "https://api.example.com"),
        "/messages", {}, "original-key").catch(error => error);
      await vi.runAllTimersAsync();
      const error = await pending;
      expect(error).toBeInstanceOf(InkboxConnectionError);
      expect(error.cause).toBe(cause);
      expect(getMessageRequestKey(error)).toBe("original-key");
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); vi.useRealTimers(); }
  });

  it("does not retry a programmer TypeError while decoding the response", async () => {
    const response = Response.json({ id: "original" }, { status: 201 });
    const error = new TypeError("Body is unusable: Body has already been read");
    vi.spyOn(response, "json").mockRejectedValue(error);
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(postMessage(new HttpTransport("test-only", "https://api.example.com"),
        "/messages", {}, "original-key")).rejects.toBe(error);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(getMessageRequestKey(error)).toBe("original-key");
    } finally { vi.unstubAllGlobals(); }
  });

  it.each([[409, "idempotency_in_progress", 3], [503, "send_outcome_ambiguous", 3], [409, "result_unavailable", 1]] as const)(
    "handles %s %s with %s stable-key attempts", async (status, code, count) => {
      vi.useFakeTimers();
      try {
        const error = new InkboxAPIError(status, { error: code }, 2);
        const post = vi.fn().mockRejectedValue(error);
        const pending = postMessage({ post } as unknown as HttpTransport, "/messages", { text: "hello" }).catch(e => e);
        await vi.advanceTimersByTimeAsync(1999);
        expect(post).toHaveBeenCalledTimes(1);
        await vi.runAllTimersAsync();
        expect(await pending).toBe(error);
        expect(post).toHaveBeenCalledTimes(count);
        expect(getMessageRequestKey(error)).toBe(post.mock.calls[0][2].headers["Idempotency-Key"]);
        for (const call of post.mock.calls) expect(call).toEqual(post.mock.calls[0]);
      } finally { vi.useRealTimers(); }
    });

  it("resolves the email address to its mailbox UUID before lookup", async () => {
    const get = vi.fn().mockResolvedValue({ message_id: "original" });
    const mailboxGet = vi.fn().mockResolvedValue({ id: "mailbox" });
    const resource = new MessageSendsResource({ get } as unknown as HttpTransport,
      { get: mailboxGet } as unknown as MailboxesResource);
    expect(await resource.lookupEmail("agent@example.com", { idempotencyKey: "same" })).toBe("original");
    expect(mailboxGet).toHaveBeenCalledWith("agent@example.com");
    expect(get).toHaveBeenCalledWith("/message-sends/lookup", {
      sender_kind: "mailbox", sender_id: "mailbox", operation: "mail.send",
    }, { headers: { "Idempotency-Key": "same" } });
  });
  it("retries a timed-out request with the same key", async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn().mockRejectedValueOnce(new DOMException("timeout", "AbortError")).mockResolvedValue({ id: "original" });
      const pending = postMessage({ post } as unknown as HttpTransport, "/messages", {}, "same");
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ id: "original" });
      expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
    } finally { vi.useRealTimers(); }
  });
  it("reuses its generated key after a lost response", async () => {
    vi.useFakeTimers();
    try {
      const post = vi.fn().mockRejectedValueOnce(new InkboxConnectionError("lost", null)).mockResolvedValue({ id: "original" });
      const pending = postMessage({ post } as unknown as HttpTransport, "/messages", { text: "hello" });
      await vi.runAllTimersAsync();
      expect(await pending).toEqual({ id: "original" });
      expect(post.mock.calls[0]).toEqual(post.mock.calls[1]);
      expect(post.mock.calls[0][2].headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);
      expect(post.mock.calls[0][2].headers.Prefer).toBe("idempotency-replay");
    } finally { vi.useRealTimers(); }
  });

  it("does not retry permanent errors or replace the original key", async () => {
    const error = new InkboxAPIError(422, { error: "invalid_input" });
    const post = vi.fn().mockRejectedValue(error);
    await expect(postMessage({ post } as unknown as HttpTransport, "/messages", {}, "same")).rejects.toMatchObject({ idempotencyKey: "same" });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("makes a separate call a new message", async () => {
    const post = vi.fn().mockResolvedValue({ id: "result" });
    const transport = { post } as unknown as HttpTransport;
    await postMessage(transport, "/messages", { text: "hello" });
    await postMessage(transport, "/messages", { text: "hello" });
    expect(post.mock.calls[0][2].headers["Idempotency-Key"]).not.toBe(post.mock.calls[1][2].headers["Idempotency-Key"]);
  });

  it("does not retry before a long Retry-After delay", async () => {
    const error = new InkboxAPIError(429, { error: "rate_limited" });
    Object.assign(error, { retryAfterSeconds: 60 });
    const post = vi.fn().mockRejectedValue(error);
    await expect(postMessage({ post } as unknown as HttpTransport, "/messages", {}, "original"))
      .rejects.toBe(error);
    expect(post).toHaveBeenCalledTimes(1);
    expect(error).toMatchObject({ idempotencyKey: "original" });
  });

  it("looks up the original ID without submitting a message", async () => {
    const get = vi.fn().mockResolvedValue({ message_id: "original" });
    const transport = { get, post: vi.fn() } as unknown as HttpTransport;
    const resource = new MessageSendsResource(transport, {} as MailboxesResource);
    expect(await resource.lookup({ senderKind: "phone_number", senderId: "sender", operation: "text.send", idempotencyKey: "same" })).toBe("original");
    expect(get.mock.calls[0][2]).toEqual({ headers: { "Idempotency-Key": "same" } });
    expect(transport.post).not.toHaveBeenCalled();
  });
});

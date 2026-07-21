import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { ContactsResource } from "../src/contacts/resources/contacts.js";

const BASE = "https://inkbox.ai/api/v1";

function makeOkResponse(body: unknown) {
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

describe("contact memory", () => {
  beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
  afterEach(() => vi.restoreAllMocks());

  it("lists, gets, and resolves contact fact citations", async () => {
    const fact = {
      id: "fact-1",
      contact_id: "contact-1",
      content: "Prefers concise replies.",
      confidence: "0.875",
      origin: "generated",
      locked_at: null,
      created_at: "2026-07-20T10:00:00Z",
      updated_at: "2026-07-20T11:00:00Z",
      citations: [{
        source_type: "email_message",
        availability: "available",
        source_id: "message-1",
        source_url: "/api/v1/contacts/contact-1/facts/fact-1/citations/citation-1",
        source_locator: { paragraph: 2 },
      }],
    } as const;
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeOkResponse([fact]))
      .mockResolvedValueOnce(makeOkResponse(fact))
      .mockResolvedValueOnce(makeOkResponse({
        source_type: "email_message",
        source_id: "message-1",
        source_locator: { paragraph: 2 },
        source_url: null,
      }));
    const resource = new ContactsResource(new HttpTransport("k", BASE));

    const listed = await resource.facts.list("contact-1");
    const fetched = await resource.facts.get("contact-1", "fact-1");
    const citation = await resource.facts.resolveCitation(
      "contact-1",
      "fact-1",
      "citation-1",
    );

    expect(listed[0].confidence).toBe(0.875);
    expect(fetched.updatedAt).toEqual(new Date("2026-07-20T11:00:00Z"));
    expect(citation.sourceLocator).toEqual({ paragraph: 2 });
  });

  it("queries and parses correspondence across all channels", async () => {
    const base = {
      direction: "inbound",
      occurred_at: "2026-07-20T10:00:00Z",
      identity_id: "identity-1",
      status: "delivered",
      detail_url: null,
    };
    vi.mocked(fetch).mockResolvedValue(makeOkResponse({
      contact_id: "contact-1",
      identity_id: "identity-1",
      items: [
        {
          ...base,
          channel: "email",
          source_id: "email-1",
          mailbox_email: "agent@example.com",
          thread_id: "thread-1",
          from_address: "person@example.com",
          to_addresses: ["agent@example.com"],
          cc_addresses: [],
          bcc_addresses: [],
          subject: "Hello",
          snippet: "Hi",
          body_text: null,
          content_unavailable: false,
          attachments: [{ filename: "a.txt", content_type: "text/plain", size: 2 }],
        },
        {
          ...base,
          channel: "sms",
          source_id: "sms-1",
          conversation_id: "sms-conversation-1",
          local_resource_id: "number-1",
          local_phone_number: "+12025550100",
          sender_phone_number: "+12025550101",
          participants: ["+12025550101"],
          matched_contact_phone: "+12025550101",
          is_group: false,
          text: "Hi",
          media: { count: 1 },
        },
        {
          ...base,
          channel: "imessage",
          source_id: "imessage-1",
          conversation_id: "imessage-conversation-1",
          remote_handle: "+12025550101",
          service: "imessage",
          text: "Hello",
          media: null,
        },
        {
          ...base,
          channel: "calls",
          source_id: "call-1",
          remote_phone_number: "+12025550101",
          local_phone_number: "+12025550100",
          started_at: "2026-07-20T10:00:00Z",
          ended_at: "2026-07-20T10:01:00Z",
          duration_seconds: 60,
          transcript: [{
            id: null,
            seq: null,
            party: null,
            text: null,
            ts_ms: null,
            marker: "abridged",
            omitted_turns: 3,
            omitted_ms: 5000,
          }],
          transcript_abridged: true,
          transcript_unavailable: false,
        },
      ],
      channels: [
        { channel: "email", status: "available", returned: 1 },
        { channel: "sms", status: "available", returned: 1 },
        { channel: "imessage", status: "available", returned: 1 },
        { channel: "calls", status: "available", returned: 1 },
      ],
      next_cursor: "next-page",
    }));
    const resource = new ContactsResource(new HttpTransport("k", BASE));

    const result = await resource.correspondence.get("contact-1", {
      channels: ["email", "sms", "imessage", "calls"],
      after: new Date("2026-07-01T00:00:00Z"),
      content: "full",
      transcripts: "abridged",
      includeFailed: true,
      identityId: "identity-1",
    });

    const params = new URL(vi.mocked(fetch).mock.calls[0][0] as string).searchParams;
    expect(params.getAll("channels")).toEqual(["email", "sms", "imessage", "calls"]);
    expect(params.get("after")).toBe("2026-07-01T00:00:00.000Z");
    expect(params.get("include_failed")).toBe("true");
    expect(result.items.map((item) => item.channel)).toEqual([
      "email",
      "sms",
      "imessage",
      "calls",
    ]);
    expect(result.items[0].occurredAt).toBeInstanceOf(Date);
    const call = result.items[3];
    expect(call.channel === "calls" && call.transcript?.[0].omittedTurns).toBe(3);
    expect(result.nextCursor).toBe("next-page");
  });

  it("supports fact deletion, citation URLs, bulk deletion, and batch export", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeOkResponse({
        source_type: "email_message",
        source_id: "message-1",
        source_locator: { paragraph: 2 },
        source_url: null,
      }))
      .mockResolvedValueOnce(makeOkResponse({
        deleted_fact_id: "fact-1",
        memory_count: 0,
        latest_memory: null,
      }))
      .mockResolvedValueOnce(makeOkResponse({
        deleted_count: 1,
        error_count: 0,
        results: [{ contact_id: "contact-1", status: "deleted", error: null }],
      }))
      .mockResolvedValueOnce(makeOkResponse({
        content_type: "text/vcard; charset=utf-8",
        contact_count: 1,
        vcard: "BEGIN:VCARD\r\nEND:VCARD\r\n",
      }));
    const resource = new ContactsResource(new HttpTransport("k", BASE));

    await resource.facts.resolveCitationUrl(
      `${BASE}/contacts/contact-1/facts/fact-1/citations/citation-1?view=source`,
    );
    const deletedFact = await resource.facts.delete("contact-1", "fact-1");
    const deletedContacts = await resource.bulkDelete(["contact-1"]);
    const exported = await resource.vcards.exportMany(["contact-1"]);

    expect(deletedFact.memoryCount).toBe(0);
    expect(deletedContacts.deletedCount).toBe(1);
    expect(exported.contactCount).toBe(1);
    expect(new URL(vi.mocked(fetch).mock.calls[0][0] as string).search).toBe("?view=source");
    expect(vi.mocked(fetch).mock.calls.map(([url]) => new URL(url as string).pathname)).toEqual([
      "/api/v1/contacts/contact-1/facts/fact-1/citations/citation-1",
      "/api/v1/contacts/contact-1/facts/fact-1",
      "/api/v1/contacts/bulk-delete",
      "/api/v1/contacts/vcard-export",
    ]);
  });

  it("forwards idempotency keys on contact mutations and vCard import", async () => {
    const contact = {
      id: "contact-1",
      preferred_name: "Alex",
      given_name: "Alex",
      family_name: null,
      company_name: null,
      job_title: null,
      notes: null,
      created_at: "2026-07-20T10:00:00Z",
      updated_at: "2026-07-20T10:00:00Z",
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeOkResponse(contact))
      .mockResolvedValueOnce(makeOkResponse(contact))
      .mockResolvedValueOnce(makeOkResponse({}))
      .mockResolvedValueOnce(makeOkResponse({ created_count: 0, error_count: 0, results: [] }));
    const resource = new ContactsResource(new HttpTransport("k", BASE));

    await resource.create({ givenName: "Alex", idempotencyKey: "create-contact-1" });
    await resource.update("contact-1", { notes: "Updated", idempotencyKey: "update-contact-1" });
    await resource.delete("contact-1", { idempotencyKey: "delete-contact-1" });
    await resource.vcards.import("BEGIN:VCARD\r\nEND:VCARD\r\n", "text/vcard", "import-vcard-1");

    expect(vi.mocked(fetch).mock.calls.map(([, init]) => new Headers(init?.headers).get("Idempotency-Key")))
      .toEqual(["create-contact-1", "update-contact-1", "delete-contact-1", "import-vcard-1"]);
  });
});

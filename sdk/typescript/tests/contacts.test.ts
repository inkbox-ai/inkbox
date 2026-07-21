// sdk/typescript/tests/contacts.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { ContactsResource } from "../src/contacts/resources/contacts.js";
import { VCardsResource } from "../src/contacts/resources/vcards.js";

const BASE = "https://inkbox.ai/api/v1";
const CONTACT_DICT = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  organization_id: "org_test",
  preferred_name: "Alex",
  name_prefix: null,
  given_name: "Alex",
  middle_name: null,
  family_name: "Waugh",
  name_suffix: null,
  company_name: null,
  job_title: null,
  birthday: "1990-01-01",
  notes: null,
  emails: [{ value: "a@b.com", label: "work", is_primary: true }],
  phones: [{ value_e164: "+15551234567" }],
  websites: [],
  dates: [],
  addresses: [],
  custom_fields: [],
  access: [
    {
      id: "bbbb2222-0000-0000-0000-000000000001",
      contact_id: "aaaa1111-0000-0000-0000-000000000001",
      identity_id: null,
      created_at: "2026-04-20T00:00:00Z",
    },
  ],
  creation_source: "manual",
  review_status: "confirmed",
  reviewed_at: "2026-04-21T00:00:00Z",
  reviewed_by: "user_test",
  preferred_name_source: "manual",
  preferred_name_locked_at: null,
  created_by_identity_id: null,
  merged_into_contact_id: null,
  is_auto_created: false,
  is_confirmed: true,
  memory_count: 3,
  status: "active",
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

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
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
}

describe("ContactsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list with q + order builds query string", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse({ items: [CONTACT_DICT] }));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    const rows = await resource.list({ q: "al", order: "name", limit: 10 });

    expect(rows.length).toBe(1);
    expect(rows[0].preferredName).toBe("Alex");
    expect(rows[0].memoryCount).toBe(3);
    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("q=al");
    expect(url).toContain("order=name");
    expect(url).toContain("limit=10");
  });

  it("lookup with zero filters throws before HTTP", async () => {
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await expect(resource.lookup({})).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("lookup with two filters throws before HTTP", async () => {
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await expect(resource.lookup({ email: "a@b.com", phone: "+1234" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("create omits access_identity_ids", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.create({ preferredName: "Alex" });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.preferred_name).toBe("Alex");
    expect("access_identity_ids" in body).toBe(false);
  });

  it("create serializes full name fields and birthday", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.create({
      preferredName: "Alex",
      namePrefix: "Dr.",
      givenName: "Alex",
      middleName: "Q",
      familyName: "Waugh",
      nameSuffix: "Jr.",
      birthday: "1990-01-01",
    });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.name_prefix).toBe("Dr.");
    expect(body.middle_name).toBe("Q");
    expect(body.name_suffix).toBe("Jr.");
    expect(body.birthday).toBe("1990-01-01");
  });

  it("update null clears name fields", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.update("aaaa1111-0000-0000-0000-000000000001", {
      middleName: null,
      birthday: null,
    });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.middle_name).toBeNull();
    expect(body.birthday).toBeNull();
  });

  it("parsed contact exposes all new name fields", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({
        ...CONTACT_DICT,
        name_prefix: "Dr.",
        middle_name: "Q",
        name_suffix: "Jr.",
      }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    const c = await resource.get("aaaa1111-0000-0000-0000-000000000001");
    expect(c.namePrefix).toBe("Dr.");
    expect(c.middleName).toBe("Q");
    expect(c.nameSuffix).toBe("Jr.");
    expect(c.birthday).toBe("1990-01-01");
    expect(c.organizationId).toBe("org_test");
    expect(c.status).toBe("active");
    expect(c.creationSource).toBe("manual");
    expect(c.reviewStatus).toBe("confirmed");
    expect(c.reviewedAt).toEqual(new Date("2026-04-21T00:00:00Z"));
    expect(c.isConfirmed).toBe(true);
  });

  it("defaults lifecycle fields omitted by older responses", async () => {
    const legacy = { ...CONTACT_DICT } as Record<string, unknown>;
    for (const key of [
      "creation_source", "review_status", "reviewed_at", "reviewed_by",
      "preferred_name_source", "preferred_name_locked_at", "created_by_identity_id",
      "merged_into_contact_id", "is_auto_created", "is_confirmed",
      "memory_count",
    ]) delete legacy[key];
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(legacy));

    const contact = await new ContactsResource(new HttpTransport("k", BASE)).get(CONTACT_DICT.id);

    expect(contact.creationSource).toBe("backfill");
    expect(contact.reviewStatus).toBe("confirmed");
    expect(contact.preferredNameSource).toBe("manual");
    expect(contact.isAutoCreated).toBe(false);
    expect(contact.isConfirmed).toBe(true);
    expect(contact.memoryCount).toBeNull();
  });

  it("lists repeated review statuses and gets a contact", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeOkResponse([CONTACT_DICT]))
      .mockResolvedValueOnce(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.list({ reviewStatus: ["unreviewed", "confirmed"] });
    await resource.get(CONTACT_DICT.id);

    const listParams = new URL(vi.mocked(fetch).mock.calls[0][0] as string).searchParams;
    expect(listParams.getAll("review_status")).toEqual(["unreviewed", "confirmed"]);
    const getParams = new URL(vi.mocked(fetch).mock.calls[1][0] as string).searchParams;
    expect([...getParams]).toEqual([]);
  });

  it("updates review status and merges contacts", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.update(CONTACT_DICT.id, { reviewStatus: "confirmed" });
    await resource.merge(CONTACT_DICT.id, {
      losingContactIds: ["contact-loser"],
      fieldSources: { preferredName: "contact-loser" },
    });

    const updateBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string,
    );
    expect(updateBody.review_status).toBe("confirmed");
    const mergeBody = JSON.parse(
      (vi.mocked(fetch).mock.calls[1][1] as RequestInit).body as string,
    );
    expect(mergeBody).toEqual({
      losing_contact_ids: ["contact-loser"],
      field_sources: { preferred_name: "contact-loser" },
    });
  });

  it("keeps contact access listing read-only", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT.access));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    const access = await resource.access.list(CONTACT_DICT.id);

    expect(access).toHaveLength(1);
    expect(access[0].identityId).toBeNull();
    expect("grant" in resource.access).toBe(false);
    expect("revoke" in resource.access).toBe(false);
  });
});

describe("VCardsResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("import sends raw body with text/vcard and parses results", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({
        created_count: 1,
        error_count: 1,
        results: [
          { index: 0, status: "created", contact: CONTACT_DICT, error: null },
          { index: 1, status: "error", contact: null, error: "bad FN" },
        ],
      }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new VCardsResource(http);

    const result = await resource.import("BEGIN:VCARD\r\nEND:VCARD\r\n");

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = call.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("text/vcard");
    expect(typeof call.body).toBe("string");
    expect(result.createdCount).toBe(1);
    expect(result.errorCount).toBe(1);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].status).toBe("created");
    expect(result.results[0].contact?.id).toBe(CONTACT_DICT.id);
    expect(result.results[1].status).toBe("error");
    expect(result.results[1].error).toBe("bad FN");
  });

  it("parses identifier conflicts", async () => {
    const conflictId = "aaaa1111-0000-0000-0000-000000000009";
    vi.mocked(fetch).mockResolvedValue(makeOkResponse({
      created_count: 0,
      error_count: 1,
      results: [{
        index: 0,
        status: "conflict",
        contact: null,
        error: "duplicate contact identifier",
        conflicting_contact_id: conflictId,
      }],
    }));

    const result = await new VCardsResource(new HttpTransport("k", BASE)).import("BEGIN:VCARD\r\nEND:VCARD\r\n");

    expect(result.results[0].status).toBe("conflict");
    expect(result.results[0].conflictingContactId).toBe(conflictId);
  });

  it("import then export is a coherent round-trip", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        makeOkResponse({
          created_count: 1,
          error_count: 0,
          results: [{ index: 0, status: "created", contact: CONTACT_DICT, error: null }],
        }),
      )
      .mockResolvedValueOnce(makeOkResponse("BEGIN:VCARD\r\nFN:Alex\r\nEND:VCARD\r\n"));
    const http = new HttpTransport("k", BASE);
    const resource = new VCardsResource(http);

    const imported = await resource.import("BEGIN:VCARD\r\nFN:Alex\r\nEND:VCARD\r\n");
    const created = imported.results[0].contact!;
    const exported = await resource.export(created.id);

    expect(exported).toContain("BEGIN:VCARD");
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
  });

  it("export returns raw text and sends Accept: text/vcard", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse("BEGIN:VCARD\r\nEND:VCARD\r\n"));
    const http = new HttpTransport("k", BASE);
    const resource = new VCardsResource(http);

    const text = await resource.export("aaaa1111-0000-0000-0000-000000000001");

    expect(text).toContain("BEGIN:VCARD");
    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const headers = call.headers as Record<string, string>;
    expect(headers.Accept).toBe("text/vcard");
  });
});

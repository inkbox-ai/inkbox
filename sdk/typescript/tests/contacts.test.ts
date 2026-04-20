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
  phones: [{ value: "+15551234567" }],
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

  it("create with wildcard default omits access_identity_ids", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.create({ preferredName: "Alex" });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.preferred_name).toBe("Alex");
    expect("access_identity_ids" in body).toBe(false);
  });

  it("create with empty-list access_identity_ids sends []", async () => {
    vi.mocked(fetch).mockResolvedValue(makeOkResponse(CONTACT_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.create({ accessIdentityIds: [] });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body.access_identity_ids).toEqual([]);
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
  });

  it("grant with both identity and wildcard throws", async () => {
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await expect(
      resource.access.grant("abc", { identityId: "x", wildcard: true }),
    ).rejects.toThrow();
  });

  it("grant wildcard sends identity_id: null", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeOkResponse({
        id: "b1",
        contact_id: "c1",
        identity_id: null,
        created_at: "2026-04-20T00:00:00Z",
      }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ContactsResource(http);

    await resource.access.grant("c1", { wildcard: true });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ identity_id: null });
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

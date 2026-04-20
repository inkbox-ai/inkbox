// sdk/typescript/tests/notes.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { NotesResource } from "../src/notes/resources/notes.js";
import { parseNote } from "../src/notes/types.js";

const BASE = "https://inkbox.ai/api/v1";

const NOTE_DICT = {
  id: "cccc3333-0000-0000-0000-000000000001",
  organization_id: "org_test",
  created_by: "user_test",
  title: "Design doc",
  body: "Some body text",
  status: "active",
  access: [
    {
      id: "gggg7777-0000-0000-0000-000000000001",
      note_id: "cccc3333-0000-0000-0000-000000000001",
      identity_id: "dddd4444-0000-0000-0000-000000000001",
      created_at: "2026-04-20T00:00:00Z",
    },
  ],
  created_at: "2026-04-20T00:00:00Z",
  updated_at: "2026-04-20T00:00:00Z",
};

function ok(body: unknown) {
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

describe("parseNote", () => {
  it("inlines access grants", () => {
    const note = parseNote(NOTE_DICT);
    expect(note.access.length).toBe(1);
    expect(note.access[0].identityId).toBe("dddd4444-0000-0000-0000-000000000001");
  });

  it("title: null parses to null", () => {
    const note = parseNote({ ...NOTE_DICT, title: null });
    expect(note.title).toBeNull();
  });

  it("round-trips organizationId, createdBy, and status", () => {
    const note = parseNote(NOTE_DICT);
    expect(note.organizationId).toBe("org_test");
    expect(note.createdBy).toBe("user_test");
    expect(note.status).toBe("active");
  });
});

describe("NotesResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("list threads q/identity/order through the query string", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ items: [NOTE_DICT] }));
    const http = new HttpTransport("k", BASE);
    const resource = new NotesResource(http);

    await resource.list({
      q: "design",
      identityId: "dddd4444-0000-0000-0000-000000000001",
      order: "recent",
      limit: 25,
    });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("q=design");
    expect(url).toContain("identity_id=dddd4444");
    expect(url).toContain("order=recent");
    expect(url).toContain("limit=25");
  });

  it("create sends body and title", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(NOTE_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new NotesResource(http);

    await resource.create({ body: "text", title: "Draft" });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ body: "text", title: "Draft" });
  });

  it("update title: null is a valid clear", async () => {
    vi.mocked(fetch).mockResolvedValue(ok({ ...NOTE_DICT, title: null }));
    const http = new HttpTransport("k", BASE);
    const resource = new NotesResource(http);

    await resource.update("cccc3333-0000-0000-0000-000000000001", { title: null });

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({ title: null });
  });

  it("access.grant posts identity_id", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({
        id: "gggg7777-0000-0000-0000-000000000002",
        note_id: "cccc3333-0000-0000-0000-000000000001",
        identity_id: "dddd4444-0000-0000-0000-000000000002",
        created_at: "2026-04-20T00:00:00Z",
      }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new NotesResource(http);

    await resource.access.grant(
      "cccc3333-0000-0000-0000-000000000001",
      "dddd4444-0000-0000-0000-000000000002",
    );

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    const body = JSON.parse(call.body as string);
    expect(body).toEqual({
      identity_id: "dddd4444-0000-0000-0000-000000000002",
    });
  });

  it("delete hits /notes/<id>", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      status: 204,
      statusText: "No Content",
      headers: { get() { return null; }, getSetCookie() { return []; } } as unknown as Headers,
      json: () => Promise.resolve(undefined),
    } as Response);
    const http = new HttpTransport("k", BASE);
    const resource = new NotesResource(http);

    await resource.delete("cccc3333-0000-0000-0000-000000000001");

    const call = vi.mocked(fetch).mock.calls[0][1] as RequestInit;
    expect(call.method).toBe("DELETE");
  });
});

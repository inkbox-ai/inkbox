import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Inkbox, type ContactAccessSettings, type ContactPermissions, type UpdateContactAccess, type UpdateContactPermissions } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/contact_communication_policy.json", import.meta.url), "utf8"));

describe("boolean contact permissions", () => {
  it("preserves group visibility, partial nested updates, and atomic initial access", async () => {
    const requests: { method: string | undefined; path: string; body: unknown }[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      requests.push({ method: init?.method, path: new URL(String(input)).pathname, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json(init?.method === "POST" ? {
        id: fixture.policy.contact_id, created_at: "2026-09-11T00:00:00Z", updated_at: "2026-09-11T00:00:00Z",
      } : fixture.access);
    });
    try {
      const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
      const loaded: ContactAccessSettings = await client.contacts.access.get("test-agent", fixture.policy.contact_id);
      expect(loaded).toEqual(fixture.access);
      const update: UpdateContactAccess = { email: { visible: true, contactable: [] }, phone: { visible: false }, profile: false, memories: true };
      expect(await client.contacts.access.update("test-agent", fixture.policy.contact_id, update)).toEqual(loaded);
      await client.contacts.access.update("test-agent", fixture.policy.contact_id, { email: {} });
      await client.contacts.access.update("test-agent", fixture.policy.contact_id, {});
      await client.contacts.create({ givenName: "Ada", permissions: { identityId: fixture.policy.identity_id, email: { visible: true, contactable: [] }, profile: false } });
      const path = `/api/v1/identities/test-agent/contacts/${fixture.policy.contact_id}/access`;
      expect(requests).toEqual([
        { method: "GET", path, body: null }, { method: "PATCH", path, body: fixture.access_update },
        { method: "PATCH", path, body: { email: {} } }, { method: "PATCH", path, body: {} },
        { method: "POST", path: "/api/v1/contacts/with-permissions", body: { given_name: "Ada", permissions: {
          identity_id: fixture.policy.identity_id, profile: false, email: { visible: true, contactable: [] },
        } } },
      ]);
    } finally { fetch.mockRestore(); }
  });
  it("reads effective booleans and preserves false, empty maps, and omitted settings through HTTP", async () => {
    const requests: { method: string | undefined; body: unknown }[] = [];
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      expect(new URL(String(input)).pathname).toBe(`/api/v1/identities/test-agent/contacts/${fixture.policy.contact_id}/permissions`);
      requests.push({ method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : null });
      return Response.json(fixture.permissions);
    });
    try {
      const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
      const loaded: ContactPermissions = await client.contacts.permissions.get("test-agent", fixture.policy.contact_id);
      expect(loaded).toEqual(fixture.permissions);
      const update: UpdateContactPermissions = { emails: { "person@example.com": false }, phones: {}, profile: false };
      expect(await client.contacts.permissions.update("test-agent", fixture.policy.contact_id, update)).toEqual(loaded);
      await client.contacts.permissions.update("test-agent", fixture.policy.contact_id, {});
      expect(requests).toEqual([
        { method: "GET", body: null }, { method: "PATCH", body: fixture.permissions_update }, { method: "PATCH", body: {} },
      ]);
    } finally { fetch.mockRestore(); }
  });
});

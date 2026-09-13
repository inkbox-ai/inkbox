import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Inkbox, type ContactPermissions, type UpdateContactPermissions } from "../src/index.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/contact_communication_policy.json", import.meta.url), "utf8"));

describe("boolean contact permissions", () => {
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

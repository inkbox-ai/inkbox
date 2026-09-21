import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Inkbox, type ContactAccessSettings, type ContactPermissions, type ContactCreatePermissions, type UpdateContactAccess, type UpdateContactPermissions } from "../src/index.js";

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
      expect(loaded).toMatchObject(fixture.access);
      expect(loaded.email.inboundContactable).toEqual(fixture.access.email.contactable);
      expect(loaded.phone.outboundContactable).toEqual(fixture.access.phone.contactable);
      const update: UpdateContactAccess = { email: { visible: false, contactable: [] }, phone: { visible: false }, profile: false, memories: false };
      expect(await client.contacts.access.update("test-agent", fixture.policy.contact_id, update)).toEqual(loaded);
      await client.contacts.access.update("test-agent", fixture.policy.contact_id, { email: {} });
      await client.contacts.access.update("test-agent", fixture.policy.contact_id, {});
      await client.contacts.create({ givenName: "Ada", permissions: { identityId: fixture.policy.identity_id, email: { visible: true, contactable: [] }, profile: true } });
      await expect(client.contacts.access.update("test-agent", fixture.policy.contact_id, {
        profile: false, memories: true,
      })).rejects.toThrow("Profile cannot be disabled");
      await expect(client.contacts.create({ permissions: {
        identityId: fixture.policy.identity_id, profile: false, emails: { "person@example.com": true },
      } })).rejects.toThrow("Profile cannot be disabled");
      const path = `/api/v1/identities/test-agent/contacts/${fixture.policy.contact_id}/access`;
      expect(requests).toEqual([
        { method: "GET", path, body: null }, { method: "PATCH", path, body: fixture.access_update },
        { method: "PATCH", path, body: { email: {} } }, { method: "PATCH", path, body: {} },
        { method: "POST", path: "/api/v1/contacts/with-permissions", body: { given_name: "Ada", permissions: {
          identity_id: fixture.policy.identity_id, profile: true, email: { visible: true, contactable: [] },
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
      expect(loaded).toMatchObject(fixture.permissions);
      expect(loaded.inboundEmails).toEqual(fixture.permissions.emails);
      expect(loaded.outboundPhones).toEqual(fixture.permissions.phones);
      const update: UpdateContactPermissions = { emails: { "person@example.com": false }, phones: {}, profile: false };
      expect(await client.contacts.permissions.update("test-agent", fixture.policy.contact_id, update)).toEqual(loaded);
      await client.contacts.permissions.update("test-agent", fixture.policy.contact_id, {});
      await expect(client.contacts.permissions.update("test-agent", fixture.policy.contact_id, {
        profile: false, emails: { "person@example.com": true },
      })).rejects.toThrow("Profile cannot be disabled");
      expect(requests).toEqual([
        { method: "GET", body: null }, { method: "PATCH", body: fixture.permissions_update }, { method: "PATCH", body: {} },
      ]);
    } finally { fetch.mockRestore(); }
  });
});

it("round-trips directional boolean permissions and keeps legacy reads outbound", async () => {
  const response = {
    emails: { "person@example.com": false }, phones: { "+15555550123": false }, profile: true, memories: false,
    inbound_emails: { "person@example.com": true }, outbound_emails: {},
    inbound_phones: {}, outbound_phones: { "+15555550123": true },
  };
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json(response));
  try {
    const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
    const result = await client.contacts.permissions.get("test-agent", "contact-1");
    expect(result).toEqual({
      emails: {}, phones: response.outbound_phones, profile: true, memories: false,
      inboundEmails: response.inbound_emails, outboundEmails: {}, inboundPhones: {}, outboundPhones: response.outbound_phones,
    });
    await client.contacts.permissions.update("test-agent", "contact-1", {
      inboundEmails: { "person@example.com": false }, outboundEmails: {}, inboundPhones: {}, outboundPhones: { "+15555550123": true },
    });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).toEqual({
      inbound_emails: { "person@example.com": false }, outbound_emails: {}, inbound_phones: {}, outbound_phones: { "+15555550123": true },
    });
    await client.contacts.permissions.update("test-agent", "contact-1", { emails: {}, inboundPhones: {} });
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).toEqual({ emails: {}, inbound_phones: {} });
  } finally { fetch.mockRestore(); }
});

it("rejects null, mixed, oversized and profile-conflicting maps before update or creation", async () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
  const invalid = [
    { emails: {}, inboundEmails: {} }, { phones: {}, outboundPhones: {} },
    ...["emails", "phones", "inboundEmails", "outboundEmails", "inboundPhones", "outboundPhones"].flatMap((key) => [
      { [key]: null }, { [key]: { "person@example.com": "false" } },
      { [key]: Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`person${i}@example.com`, true])) },
    ]),
    { profile: null }, { memories: null }, { profile: false, inboundEmails: { "person@example.com": true } },
  ];
  try {
    for (const options of invalid) {
      await expect(client.contacts.permissions.update("test-agent", "contact-1", options as never)).rejects.toThrow();
      await expect(client.contacts.create({ permissions: { identityId: "identity-1", ...options } as never })).rejects.toThrow();
    }
    await expect(client.contacts.create({ permissions: { identityId: "identity-1", inboundEmails: {}, email: {} } as never })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  } finally { fetch.mockRestore(); }
});

it("creates 200 directional choices for 50 email and 50 phone identifiers", async () => {
  const legacyProfile = (permissions: ContactCreatePermissions): boolean | undefined => permissions.profile;
  expect(legacyProfile({ identityId: "identity-1", profile: false })).toBe(false);
  const emails = Array.from({ length: 50 }, (_, index) => ({ value: `person${index}@example.com`, label: null, isPrimary: false }));
  const phones = Array.from({ length: 50 }, (_, index) => ({ value: `+1555555${String(index).padStart(4, "0")}`, label: null, isPrimary: false }));
  const addresses = [
    ...emails.flatMap(({ value }) => [
      { kind: "email" as const, value, action: "allow" as const, direction: "inbound" as const },
      { kind: "email" as const, value, action: "block" as const, direction: "outbound" as const },
    ]),
    ...phones.flatMap(({ value }) => [
      { kind: "phone" as const, value, action: "block" as const, direction: "inbound" as const },
      { kind: "phone" as const, value, action: "allow" as const, direction: "outbound" as const },
    ]),
  ];
  const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () => Response.json({
    id: "contact-1", created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
  }, { status: 201 }));
  try {
    const client = new Inkbox({ apiKey: "test-key", baseUrl: "https://example.com" });
    await client.contacts.create({ givenName: "Person", emails, phones, permissions: { identityId: "identity-1", addresses, profile: "allow" } });
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).permissions).toEqual({ identity_id: "identity-1", addresses, profile: "allow" });
    const inboundEmails = Object.fromEntries(emails.map(({ value }) => [value, true]));
    const outboundEmails = Object.fromEntries(emails.map(({ value }) => [value, false]));
    const inboundPhones = Object.fromEntries(phones.map(({ value }) => [value, false]));
    const outboundPhones = Object.fromEntries(phones.map(({ value }) => [value, true]));
    await client.contacts.create({ givenName: "Person", emails, phones, permissions: {
      identityId: "identity-1", inboundEmails, outboundEmails, inboundPhones, outboundPhones,
    } });
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body)).permissions).toEqual({
      identity_id: "identity-1", inbound_emails: inboundEmails, outbound_emails: outboundEmails,
      inbound_phones: inboundPhones, outbound_phones: outboundPhones,
    });
    await expect(client.contacts.create({ permissions: { identityId: "identity-1", addresses: [...addresses, addresses[0]] } })).rejects.toThrow("200");
    expect(fetch).toHaveBeenCalledTimes(2);
  } finally { fetch.mockRestore(); }
});

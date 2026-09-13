import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ContactCommunicationPolicyResource } from "../src/contacts/resources/communicationPolicy.js";
import { HttpTransport } from "../src/_http.js";

describe("contact communication policies", () => {
  it("uses the shared wire fixture through the HTTP transport", async () => {
    const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/contact_communication_policy.json", import.meta.url), "utf8"));
    const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(String(input));
      if (init?.method === "PUT") expect(JSON.parse(String(init.body))).toEqual(fixture.update);
      if (url.pathname.endsWith("communication-preview")) {
        expect(url.searchParams.get("identity_id")).toBe(fixture.preview.identity_id);
        return Response.json(fixture.preview);
      }
      expect(url.pathname).toBe(`/api/v1/contacts/${fixture.policy.contact_id}/communication-policy`);
      if (init?.method === "GET") expect(url.searchParams.get("identity_id")).toBe(fixture.policy.identity_id);
      return Response.json(fixture.policy);
    });
    try {
      const resource = new ContactCommunicationPolicyResource(new HttpTransport("test-key", "https://example.com/api/v1"));
      const policy = await resource.get(fixture.policy.contact_id, fixture.policy.identity_id);
      expect(policy.addresses[0].allowed).toBe(false);
      expect(policy.effectiveVisibility).toEqual({ profile: false, memories: false });
      expect(await resource.replace(policy.contactId, { expectedRevision: 7, identityId: fixture.policy.identity_id,
        addresses: [{ kind: "email", value: "person@example.com", action: "block", expectedAction: "inherit" }],
        visibility: policy.visibility })).toEqual(policy);
      const preview = await resource.preview(policy.contactId, fixture.preview.identity_id);
      expect(preview.visibility).toEqual({ profile: false, memories: false });
      expect(preview.contact).toBeNull();
      expect(fetch).toHaveBeenCalledTimes(3);
    } finally { fetch.mockRestore(); }
  });
  it("maps the management roster without making it a full contact", async () => {
    const get = vi.fn().mockResolvedValue({ items: [{
      contact: { id: "contact", preferred_name: "Person", given_name: null, family_name: null, company_name: null,
        review_status: "confirmed", emails: [], phones: [{ value_e164: "+15555550123", label: "Work", is_primary: true }] },
      revision: 8,
      visibility: { defaults: { profile: "inherit", memories: "inherit" }, identity_override: { profile: "allow", memories: "block" } },
      effective: { email: "no_identifiers", phone: "some", profile: true, memories: false },
    }], limit: 1, offset: 2, has_more: true });
    const page = await new ContactCommunicationPolicyResource({ get } as unknown as HttpTransport)
      .listManagementForIdentity("test-agent", { q: "Person", order: "name", limit: 1, offset: 2, reviewStatus: ["confirmed"] });
    expect(get).toHaveBeenCalledWith("/identities/test-agent/contact-permissions", {
      q: "Person", order: "name", limit: 1, offset: 2, review_status: ["confirmed"],
    });
    expect(page.hasMore).toBe(true);
    expect(page.items[0].contact.phones[0].value).toBe("+15555550123");
    expect(page.items[0].visibility.identityOverride.memories).toBe("block");
    expect(page.items[0].effective.phone).toBe("some");
    expect(page.items[0].revision).toBe(8);
    expect(page.items[0].contact).not.toHaveProperty("notes");
  });
  it("serializes independent visibility while preserving omission", async () => {
    const put = vi.fn().mockResolvedValue({ contact_id: "contact", revision: 2,
      identity_id: "agent", addresses: [], effective_visibility: { profile: true, memories: false }, visibility: {
        defaults: { profile: "block", memories: "block" },
        identities: [{ identity_id: "agent", profile: "allow", memories: "block" }],
      } });
    const resource = new ContactCommunicationPolicyResource({ put } as unknown as HttpTransport);
    const result = await resource.replace("contact", { expectedRevision: 1,
      identityId: "agent", addresses: [], visibility: {
        defaults: { profile: "block", memories: "block" }, identities: [{ identityId: "agent", profile: "allow", memories: "block" }],
      } });
    expect(put.mock.calls[0][1].visibility.identities[0]).toEqual({ identity_id: "agent", profile: "allow", memories: "block" });
    expect(put.mock.calls[0][1]).not.toHaveProperty("defaults");
    expect(result.visibility.identities[0].identityId).toBe("agent");
    await resource.replace("contact", { expectedRevision: 2, identityId: "agent", addresses: [] });
    expect(put.mock.calls[1][1]).not.toHaveProperty("visibility");
  });
  it("maps guarded address edits and an unselected policy response", async () => {
    const put = vi.fn().mockResolvedValue({
      contact_id: "contact", revision: 2, identity_id: null, addresses: [], effective_visibility: null,
      visibility: { defaults: { profile: "inherit", memories: "inherit" }, identities: [] },
    });
    const resource = new ContactCommunicationPolicyResource({ put } as unknown as HttpTransport);
    const result = await resource.replace("contact", {
      expectedRevision: 1, identityId: "agent",
      addresses: [{ kind: "phone", value: "+15555550123", action: "allow", expectedAction: "block" }],
    });
    expect(put).toHaveBeenCalledWith("/contacts/contact/communication-policy", {
      expected_revision: 1, identity_id: "agent",
      addresses: [{ kind: "phone", value: "+15555550123", action: "allow", expected_action: "block" }],
    });
    expect(result.identityId).toBeNull();
    expect(result.effectiveVisibility).toBeNull();
    expect(result.revision).toBe(2);
  });

  it("preserves null previews and page continuation", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [{ identity_id: "agent", contact: null, email: false, phone: false, full_profile: false, visibility: { profile: false, memories: false } }],
      limit: 1, offset: 2, has_more: true,
    });
    const resource = new ContactCommunicationPolicyResource({ get } as unknown as HttpTransport);
    const page = await resource.listForIdentity("test-agent", { limit: 1, offset: 2 });
    expect(page.items[0].contact).toBeNull();
    expect(page.hasMore).toBe(true);
    expect(get).toHaveBeenCalledWith("/identities/test-agent/contact-communication-policies", { limit: 1, offset: 2 });
  });
});

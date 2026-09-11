import { describe, expect, it, vi } from "vitest";
import { ContactCommunicationPolicyResource } from "../src/contacts/resources/communicationPolicy.js";
import { type HttpTransport } from "../src/_http.js";

describe("contact communication policies", () => {
  it("serializes independent visibility while preserving legacy omission", async () => {
    const put = vi.fn().mockResolvedValue({ contact_id: "contact", revision: 2,
      defaults: { email: "allow", phone: "allow" }, identities: [], visibility: {
        defaults: { profile: "block", memories: "block" },
        identities: [{ identity_id: "agent", profile: "allow", memories: "block" }],
      } });
    const resource = new ContactCommunicationPolicyResource({ put } as unknown as HttpTransport);
    const result = await resource.replace("contact", { expectedRevision: 1,
      defaults: { email: "allow", phone: "allow" }, identities: [], visibility: {
        defaults: { profile: "block", memories: "block" }, identities: [{ identityId: "agent", profile: "allow", memories: "block" }],
      } });
    expect(put.mock.calls[0][1].visibility.identities[0]).toEqual({ identity_id: "agent", profile: "allow", memories: "block" });
    expect(Object.keys(put.mock.calls[0][1].defaults)).toEqual(["email", "phone"]);
    expect(result.visibility?.identities[0].identityId).toBe("agent");
    await resource.replace("contact", { expectedRevision: 2, defaults: { email: "inherit", phone: "inherit" }, identities: [] });
    expect(put.mock.calls[1][1]).not.toHaveProperty("visibility");
  });
  it("maps revision and identity override fields without changing legacy rule types", async () => {
    const put = vi.fn().mockResolvedValue({
      contact_id: "contact", revision: 2, defaults: { email: "block", phone: "block" },
      identities: [{ identity_id: "agent", email: "allow", phone: "block" }],
    });
    const resource = new ContactCommunicationPolicyResource({ put } as unknown as HttpTransport);
    const result = await resource.replace("contact", {
      expectedRevision: 1, defaults: { email: "block", phone: "block" },
      identities: [{ identityId: "agent", email: "allow", phone: "block" }],
    });
    expect(put).toHaveBeenCalledWith("/contacts/contact/communication-policy", {
      expected_revision: 1, defaults: { email: "block", phone: "block" },
      identities: [{ identity_id: "agent", email: "allow", phone: "block" }],
    });
    expect(result.identities[0].identityId).toBe("agent");
    expect(result.revision).toBe(2);
  });

  it("preserves null previews and page continuation", async () => {
    const get = vi.fn().mockResolvedValue({
      items: [{ identity_id: "agent", contact: null, email: false, phone: false, full_profile: false }],
      limit: 1, offset: 2, has_more: true,
    });
    const resource = new ContactCommunicationPolicyResource({ get } as unknown as HttpTransport);
    const page = await resource.listForIdentity("test-agent", { limit: 1, offset: 2 });
    expect(page.items[0].contact).toBeNull();
    expect(page.hasMore).toBe(true);
    expect(get).toHaveBeenCalledWith("/identities/test-agent/contact-communication-policies", { limit: 1, offset: 2 });
  });
});

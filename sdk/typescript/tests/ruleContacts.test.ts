import { describe, expect, it } from "vitest";
import { parseMailIdentityContactRule } from "../src/mail/types.js";
import { parsePhoneIdentityContactRule } from "../src/phone/types.js";
import { parseIMessageContactRule } from "../src/imessage/types.js";
import type { RawContact } from "../src/contacts/types.js";

const timestamp = "2026-09-05T00:00:00Z";
const card: RawContact = {
  id: "33333333-3333-4333-8333-333333333333", preferred_name: "Person",
  given_name: null, family_name: null, company_name: null, job_title: null, notes: null,
  emails: [{ value: "person@example.com", label: null, is_primary: true }],
  phones: [], websites: [], dates: [], addresses: [], custom_fields: [], access: [],
  created_at: timestamp, updated_at: timestamp,
};

describe.each([
  ["mail", parseMailIdentityContactRule],
  ["phone", parsePhoneIdentityContactRule],
  ["imessage", parseIMessageContactRule],
] as const)("%s rule contacts", (channel, parse) => {
  it.each(["absent", "null", "card"])("parses %s contact", (shape) => {
    const raw = {
      id: "11111111-1111-4111-8111-111111111111",
      agent_identity_id: "22222222-2222-4222-8222-222222222222",
      action: "allow", status: "active",
      match_type: channel === "mail" ? "exact_email" : "exact_number",
      match_target: channel === "mail" ? "person@example.com" : "+14155550123",
      created_at: timestamp, updated_at: timestamp,
      ...(shape === "absent" ? {} : { contact: shape === "card" ? card : null }),
    };
    const result = parse(raw);
    if (shape === "card") {
      expect(result.contact?.preferredName).toBe("Person");
      expect(result.contact?.emails[0].isPrimary).toBe(true);
      expect(result.contact?.createdAt).toEqual(new Date(timestamp));
    } else {
      expect(result.contact).toBeNull();
    }
  });
});

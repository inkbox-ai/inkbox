// sdk/typescript/tests/identities/types.test.ts
import { describe, it, expect } from "vitest";
import {
  identityMailboxCreateOptionsToWire,
  parseAgentIdentitySummary,
  parseAgentIdentityData,
  parseIdentityMailbox,
  parseIdentityPhoneNumber,
} from "../../src/identities/types.js";
import {
  RAW_IDENTITY,
  RAW_IDENTITY_DETAIL,
  RAW_IDENTITY_MAILBOX,
  RAW_IDENTITY_PHONE,
} from "../sampleData.js";

describe("parseAgentIdentitySummary", () => {
  it("converts all fields", () => {
    const i = parseAgentIdentitySummary(RAW_IDENTITY);
    expect(i.id).toBe(RAW_IDENTITY.id);
    expect(i.organizationId).toBe("org-abc123");
    expect(i.agentHandle).toBe("sales-agent");
    expect(i.emailAddress).toBe("sales-agent@inkboxmail.com");
    expect(i.createdAt).toBeInstanceOf(Date);
    expect(i.updatedAt).toBeInstanceOf(Date);
  });
});

describe("parseAgentIdentityData", () => {
  it("includes nested mailbox and phone number", () => {
    const d = parseAgentIdentityData(RAW_IDENTITY_DETAIL);
    expect(d.agentHandle).toBe("sales-agent");
    expect(d.mailbox).not.toBeNull();
    expect(d.mailbox!.emailAddress).toBe("sales-agent@inkbox.ai");
    expect(d.phoneNumber).not.toBeNull();
    expect(d.phoneNumber!.number).toBe("+18335794607");
  });

  it("returns null for missing channels", () => {
    const d = parseAgentIdentityData({ ...RAW_IDENTITY, mailbox: null, phone_number: null });
    expect(d.mailbox).toBeNull();
    expect(d.phoneNumber).toBeNull();
  });
});

describe("parseIdentityMailbox", () => {
  it("converts all fields", () => {
    const m = parseIdentityMailbox(RAW_IDENTITY_MAILBOX);
    expect(m.id).toBe(RAW_IDENTITY_MAILBOX.id);
    expect(m.emailAddress).toBe("sales-agent@inkbox.ai");
    expect(m.agentIdentityId).toBe("eeee5555-0000-0000-0000-000000000001");
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeInstanceOf(Date);
  });

  it("reads sending_domain when present", () => {
    const m = parseIdentityMailbox({
      ...RAW_IDENTITY_MAILBOX,
      sending_domain: "mail.acme.com",
    });
    expect(m.sendingDomain).toBe("mail.acme.com");
  });

  it("falls back to email_address split when sending_domain absent", () => {
    const m = parseIdentityMailbox(RAW_IDENTITY_MAILBOX);
    expect(m.sendingDomain).toBe("inkbox.ai");
  });

});

describe("identityMailboxCreateOptionsToWire", () => {
  it("returns an empty object when nothing is set", () => {
    expect(identityMailboxCreateOptionsToWire({})).toEqual({});
  });

  it("includes email_local_part when set", () => {
    expect(identityMailboxCreateOptionsToWire({ emailLocalPart: "alice" })).toEqual({
      email_local_part: "alice",
    });
  });

  it("includes null when sendingDomain is explicitly null", () => {
    expect(
      identityMailboxCreateOptionsToWire({ sendingDomain: null }),
    ).toEqual({ sending_domain: null });
  });

  it("includes string when sendingDomain is a name", () => {
    expect(
      identityMailboxCreateOptionsToWire({ sendingDomain: "mail.acme.com" }),
    ).toEqual({ sending_domain: "mail.acme.com" });
  });
});

describe("parseIdentityPhoneNumber", () => {
  it("converts all fields", () => {
    const p = parseIdentityPhoneNumber(RAW_IDENTITY_PHONE);
    expect(p.id).toBe(RAW_IDENTITY_PHONE.id);
    expect(p.number).toBe("+18335794607");
    expect(p.type).toBe("local");
    expect(p.incomingCallAction).toBe("auto_reject");
    expect(p.clientWebsocketUrl).toBeNull();
    expect(p.incomingCallWebhookUrl).toBeNull();
    expect(p.state).toBeNull();
    expect(p.agentIdentityId).toBe("eeee5555-0000-0000-0000-000000000001");
    expect(p.createdAt).toBeInstanceOf(Date);
  });

  it("parses incomingCallWebhookUrl", () => {
    const p = parseIdentityPhoneNumber({
      ...RAW_IDENTITY_PHONE,
      incoming_call_webhook_url: "https://example.com/calls",
    });
    expect(p.incomingCallWebhookUrl).toBe("https://example.com/calls");
  });

  it("parses state for local numbers", () => {
    const p = parseIdentityPhoneNumber({
      ...RAW_IDENTITY_PHONE,
      type: "local",
      state: "NY",
    });
    expect(p.state).toBe("NY");
  });
});

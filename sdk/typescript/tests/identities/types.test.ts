// sdk/typescript/tests/identities/types.test.ts
import { describe, it, expect } from "vitest";
import {
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
    expect(i.status).toBe("active");
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
    expect(m.displayName).toBe("Sales Agent");
    expect(m.status).toBe("active");
    expect(m.createdAt).toBeInstanceOf(Date);
    expect(m.updatedAt).toBeInstanceOf(Date);
  });
});

describe("parseIdentityPhoneNumber", () => {
  it("converts all fields", () => {
    const p = parseIdentityPhoneNumber(RAW_IDENTITY_PHONE);
    expect(p.id).toBe(RAW_IDENTITY_PHONE.id);
    expect(p.number).toBe("+18335794607");
    expect(p.type).toBe("toll_free");
    expect(p.incomingCallAction).toBe("auto_reject");
    expect(p.clientWebsocketUrl).toBeNull();
    expect(p.incomingTextWebhookUrl).toBeNull();
    expect(p.createdAt).toBeInstanceOf(Date);
  });

  it("parses incomingTextWebhookUrl", () => {
    const p = parseIdentityPhoneNumber({
      ...RAW_IDENTITY_PHONE,
      incoming_text_webhook_url: "https://example.com/texts",
    });
    expect(p.incomingTextWebhookUrl).toBe("https://example.com/texts");
  });
});

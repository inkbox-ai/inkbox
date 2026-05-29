// sdk/typescript/tests/webhooks-types.test.ts
//
// Parse the canonical server example payloads and exercise the
// wire-shape types in src/webhooks/types.ts. Runtime probes only;
// missing-key drift is caught by the per-field assertions below,
// not by the TypeScript type system (tests aren't included in the
// SDK's tsconfig.json `"src"` scope, and JSON.parse(...) as T
// suppresses excess-key checks anyway).

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type {
  MailWebhookPayload,
  PhoneIncomingCallWebhookPayload,
  RawTextMessageRecipient,
  TextWebhookPayload,
  WebhookMailContact,
  WebhookMailAgentIdentity,
} from "../src/index.js";

const FIXTURES_DIR = join(__dirname, "..", "..", "..", "tests", "fixtures", "webhook_payloads");

// Drift-loud inventory. Adding a new fixture without listing it here
// (or vice versa) fails the suite.
const EXPECTED_FIXTURES = [
  "message_received.json",
  "message_sent.json",
  "message_forwarded.json",
  "message_delivered.json",
  "message_bounced.json",
  "message_failed.json",
  "text_received.json",
  "text_sent.json",
  "text_delivered.json",
  "text_delivery_failed.json",
  "text_delivery_unconfirmed.json",
  "text_group_delivered.json",
  "phone_incoming_call.json",
] as const;

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), "utf8")) as T;
}

describe("webhook fixture inventory", () => {
  it("matches the canonical event set exactly (drift-loud)", () => {
    const present = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json")).sort();
    const expected = [...EXPECTED_FIXTURES].sort();
    expect(present).toStrictEqual(expected);
  });
});

describe("MailWebhookPayload", () => {
  const mailEvents = [
    "message_received.json",
    "message_sent.json",
    "message_forwarded.json",
    "message_delivered.json",
    "message_bounced.json",
    "message_failed.json",
  ] as const;

  it.each(mailEvents)("parses %s into MailWebhookPayload", (file) => {
    const payload = loadFixture<MailWebhookPayload>(file);
    expect(payload.event_type.startsWith("message.")).toBe(true);
    expect(typeof payload.timestamp).toBe("string");
    expect(payload.data.message.id).toBeTypeOf("string");
    expect(payload.data.message.mailbox_id).toBeTypeOf("string");
    expect(["inbound", "outbound"]).toContain(payload.data.message.direction);
  });

  it("data.contacts and data.agent_identities are always present (possibly empty)", () => {
    for (const file of mailEvents) {
      const payload = loadFixture<MailWebhookPayload>(file);
      expect(Array.isArray(payload.data.contacts)).toBe(true);
      expect(Array.isArray(payload.data.agent_identities)).toBe(true);
    }
  });

  it("inbound carries from + cc contact matches with bucket-paired entries", () => {
    const received = loadFixture<MailWebhookPayload>("message_received.json");
    expect(received.data.contacts).toHaveLength(2);
    const [first, second]: WebhookMailContact[] = received.data.contacts;
    expect(first.bucket).toBe("from");
    expect(first.address).toBe(received.data.message.from_address);
    expect(first.id).toBeTypeOf("string");
    expect(first.name).toBeTypeOf("string");
    expect(second.bucket).toBe("cc");
    expect(received.data.message.cc_addresses).not.toBeNull();
    expect(received.data.message.cc_addresses).toContain(second.address);
  });

  it("inbound exposes an agent_identities match with bucket/address keys", () => {
    const received = loadFixture<MailWebhookPayload>("message_received.json");
    const agents: WebhookMailAgentIdentity[] = received.data.agent_identities;
    expect(agents).toHaveLength(1);
    expect(agents[0].bucket).toBe("cc");
    expect(agents[0].id).toBeTypeOf("string");
    expect(agents[0].agent_handle).toBeTypeOf("string");
    expect(agents[0].display_name === null || typeof agents[0].display_name === "string").toBe(true);
    expect(received.data.message.cc_addresses).toContain(agents[0].address);
  });

  it("outbound carries to + cc + bcc contact matches", () => {
    const sent = loadFixture<MailWebhookPayload>("message_sent.json");
    const buckets = sent.data.contacts.map((c) => c.bucket);
    expect(buckets).toStrictEqual(["to", "cc", "bcc"]);
    const bcc = sent.data.contacts.find((c) => c.bucket === "bcc");
    expect(bcc?.address).toBe("audit@inkboxmail.com");
    expect(sent.data.message.bcc_addresses).toContain("audit@inkboxmail.com");
  });

  it("represents an unmatched send as both lists empty", () => {
    const forwarded = loadFixture<MailWebhookPayload>("message_forwarded.json");
    expect(forwarded.data.contacts).toStrictEqual([]);
    expect(forwarded.data.agent_identities).toStrictEqual([]);
  });

  it("agent_identities allows display_name: null", () => {
    const sent = loadFixture<MailWebhookPayload>("message_sent.json");
    expect(sent.data.agent_identities).toHaveLength(1);
    expect(sent.data.agent_identities[0].display_name).toBeNull();
  });

  it("bcc_addresses is null on inbound and a string[] on outbound when populated", () => {
    const inbound = loadFixture<MailWebhookPayload>("message_received.json");
    expect(inbound.data.message.bcc_addresses).toBeNull();
    const outbound = loadFixture<MailWebhookPayload>("message_sent.json");
    expect(outbound.data.message.bcc_addresses).toContain("audit@inkboxmail.com");
  });

  it("narrows event_type via switch", () => {
    const fixtures = mailEvents.map((f) => loadFixture<MailWebhookPayload>(f));
    for (const payload of fixtures) {
      switch (payload.event_type) {
        case "message.received":
        case "message.sent":
        case "message.forwarded":
        case "message.delivered":
        case "message.bounced":
        case "message.failed":
          expect(payload.data.message.id).toBeTypeOf("string");
          break;
      }
    }
  });
});

describe("TextWebhookPayload", () => {
  const textEvents = [
    "text_received.json",
    "text_sent.json",
    "text_delivered.json",
    "text_delivery_failed.json",
    "text_delivery_unconfirmed.json",
    "text_group_delivered.json",
  ] as const;

  it.each(textEvents)("parses %s into TextWebhookPayload", (file) => {
    const payload = loadFixture<TextWebhookPayload>(file);
    expect(payload.event_type.startsWith("text.")).toBe(true);
    expect(payload.data.text_message.id).toBeTypeOf("string");
    expect(payload.data.text_message.origin).toBe("user_initiated");
  });

  it.each(textEvents)("data.contacts and agent_identities are arrays, and singular 'contact' is absent on %s", (file) => {
    const payload = loadFixture<TextWebhookPayload>(file);
    expect(Array.isArray(payload.data.contacts)).toBe(true);
    expect(Array.isArray(payload.data.agent_identities)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload.data, "contact")).toBe(false);
  });

  it("exposes the full outbound-lifecycle block on text.delivery_failed (1:1)", () => {
    const payload = loadFixture<TextWebhookPayload>("text_delivery_failed.json");
    expect(payload.data.text_message.delivery_status).toBe("delivery_failed");
    expect(payload.data.text_message.error_code).toBe("30007");
    expect(payload.data.text_message.error_detail).toBe("Message filtered by carrier");
    expect(payload.data.text_message.sent_at).toBeTypeOf("string");
    expect(payload.data.text_message.failed_at).toBeTypeOf("string");
    expect(payload.data.text_message.delivered_at).toBeNull();
    expect(payload.data.text_message.conversation_id).toBeTypeOf("string");
    expect(payload.data.text_message.recipients).toHaveLength(1);
    expect(payload.data.text_message.recipients?.[0].recipient_phone_number).toBe(
      payload.data.text_message.remote_phone_number,
    );
  });

  it("inbound text carries no lifecycle timestamps and recipients: null", () => {
    const payload = loadFixture<TextWebhookPayload>("text_received.json");
    expect(payload.data.text_message.delivery_status).toBeNull();
    expect(payload.data.text_message.sent_at).toBeNull();
    expect(payload.data.text_message.delivered_at).toBeNull();
    expect(payload.data.text_message.failed_at).toBeNull();
    expect(payload.data.text_message.recipients).toBeNull();
    expect(payload.data.text_message.remote_phone_number).toBeTypeOf("string");
    expect(payload.data.text_message.sender_phone_number).toBe(
      payload.data.text_message.remote_phone_number,
    );
    expect(payload.data.recipient_phone_number).toBeNull();
    expect(payload.data.contacts).toHaveLength(1);
    expect(payload.data.contacts[0].id).toBeTypeOf("string");
  });

  it("outbound 1:1 has a single-entry recipients[] and populated legacy lifecycle fields", () => {
    const payload = loadFixture<TextWebhookPayload>("text_sent.json");
    expect(payload.data.text_message.recipients).not.toBeNull();
    expect(payload.data.text_message.recipients).toHaveLength(1);
    const recipient = payload.data.text_message.recipients![0];
    expect(recipient.recipient_phone_number).toBe(payload.data.text_message.remote_phone_number);
    expect(payload.data.recipient_phone_number).toBeNull();
  });

  it("group lifecycle events identify the recipient that changed state", () => {
    const payload = loadFixture<TextWebhookPayload>("text_group_delivered.json");
    const message = payload.data.text_message;
    expect(message.remote_phone_number).toBeNull();
    expect(message.type).toBe("mms");
    expect(message.media).toHaveLength(1);
    expect(message.conversation_id).toBeTypeOf("string");
    // Outbound rows carry sender_phone_number=null; the implicit sender is
    // local_phone_number. Inbound rows are the only ones with a non-null sender.
    expect(message.sender_phone_number).toBeNull();
    expect(Array.isArray(message.recipients)).toBe(true);
    expect(message.recipients!.length).toBeGreaterThanOrEqual(2);
    const required: (keyof RawTextMessageRecipient)[] = [
      "recipient_phone_number",
      "delivery_status",
      "carrier",
      "line_type",
      "error_code",
      "error_detail",
      "sent_at",
      "delivered_at",
      "failed_at",
    ];
    for (const entry of message.recipients!) {
      for (const key of required) {
        expect(Object.prototype.hasOwnProperty.call(entry, key)).toBe(true);
      }
    }
    expect(payload.data.recipient_phone_number).toBe("+14155550999");
    expect(
      message.recipients!.map((r) => r.recipient_phone_number),
    ).toContain(payload.data.recipient_phone_number);
  });

  it.each(textEvents)("does not carry is_blocked on %s", (file) => {
    const payload = loadFixture<TextWebhookPayload>(file);
    expect(
      Object.prototype.hasOwnProperty.call(payload.data.text_message, "is_blocked"),
    ).toBe(false);
  });
});

describe("PhoneIncomingCallWebhookPayload", () => {
  it("parses the flat (no-envelope) call payload with plural matches", () => {
    const payload = loadFixture<PhoneIncomingCallWebhookPayload>("phone_incoming_call.json");
    expect(payload.id).toBeTypeOf("string");
    expect(payload.direction).toBe("inbound");
    expect(payload.status).toBe("initiated");
    expect(Array.isArray(payload.contacts)).toBe(true);
    expect(Array.isArray(payload.agent_identities)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(payload, "contact")).toBe(false);
  });

  it("does not carry is_blocked on the wire", () => {
    const payload = loadFixture<PhoneIncomingCallWebhookPayload>("phone_incoming_call.json");
    expect(Object.prototype.hasOwnProperty.call(payload, "is_blocked")).toBe(false);
  });

  it("exposes rate_limit as the snake_case RawRateLimitInfo wire shape", () => {
    const payload = loadFixture<PhoneIncomingCallWebhookPayload>("phone_incoming_call.json");
    expect(payload.rate_limit).not.toBeNull();
    if (payload.rate_limit !== null) {
      expect(payload.rate_limit.calls_used).toBe(4);
      expect(payload.rate_limit.minutes_remaining).toBe(287.5);
    }
  });

  it("populated agent_identities entries carry id / agent_handle / display_name", () => {
    const payload = loadFixture<PhoneIncomingCallWebhookPayload>("phone_incoming_call.json");
    expect(payload.agent_identities).toHaveLength(1);
    const entry = payload.agent_identities[0];
    expect(entry.id).toBeTypeOf("string");
    expect(entry.agent_handle).toBeTypeOf("string");
    expect(entry.display_name === null || typeof entry.display_name === "string").toBe(true);
  });
});

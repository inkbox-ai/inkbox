// sdk/typescript/tests/webhooks-types.test.ts
//
// Parse the canonical server example payloads (copied verbatim from
// ~/servers/src/apps/api_server/webhook_specs_router.py) and exercise
// the wire-shape types in src/webhooks/types.ts. The asserts on
// discriminated-union narrowing double as compile-time checks: if a
// field is wrong, `tsc` fails before the runtime expectations run.

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";
import type {
  MailWebhookPayload,
  PhoneIncomingCallWebhookPayload,
  TextWebhookPayload,
  WebhookContact,
} from "../src/index.js";

const FIXTURES_DIR = join(__dirname, "..", "..", "..", "tests", "fixtures", "webhook_payloads");

// The complete canonical event set. Drift-loud test below asserts the
// fixture directory matches this exactly — adding a new server event
// without copying a fixture, or vice versa, fails the suite.
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
    // direction is "inbound" | "outbound" — both literals are accepted
    // by the wire union; this assertion exists to lock in the narrowing.
    expect(["inbound", "outbound"]).toContain(payload.data.message.direction);
  });

  it("discriminates contact: null vs WebhookContact", () => {
    const received = loadFixture<MailWebhookPayload>("message_received.json");
    expect(received.data.contact).not.toBeNull();
    // The non-null branch narrows to WebhookContact.
    const contact: WebhookContact | null = received.data.contact;
    if (contact !== null) {
      expect(contact.id).toBeTypeOf("string");
      expect(contact.name).toBeTypeOf("string");
    }

    const sent = loadFixture<MailWebhookPayload>("message_sent.json");
    expect(sent.data.contact).toBeNull();
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
          // All six branches reachable — TS narrowing succeeded.
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
  ] as const;

  it.each(textEvents)("parses %s into TextWebhookPayload", (file) => {
    const payload = loadFixture<TextWebhookPayload>(file);
    expect(payload.event_type.startsWith("text.")).toBe(true);
    expect(payload.data.text_message.id).toBeTypeOf("string");
    expect(payload.data.text_message.origin).toBe("user_initiated");
  });

  it("exposes the full outbound-lifecycle block on text.delivery_failed", () => {
    const payload = loadFixture<TextWebhookPayload>("text_delivery_failed.json");
    // These typecheck only because `delivery_status` is
    // SmsDeliveryStatusWire | null and the other lifecycle fields are
    // string | null — the headline value of the new text.* events.
    expect(payload.data.text_message.delivery_status).toBe("delivery_failed");
    expect(payload.data.text_message.error_code).toBe("30007");
    expect(payload.data.text_message.error_detail).toBe("Message filtered by carrier");
    expect(payload.data.text_message.sent_at).toBeTypeOf("string");
    expect(payload.data.text_message.failed_at).toBeTypeOf("string");
    expect(payload.data.text_message.delivered_at).toBeNull();
  });

  it("inbound text carries no lifecycle timestamps", () => {
    const payload = loadFixture<TextWebhookPayload>("text_received.json");
    expect(payload.data.text_message.delivery_status).toBeNull();
    expect(payload.data.text_message.sent_at).toBeNull();
    expect(payload.data.text_message.delivered_at).toBeNull();
    expect(payload.data.text_message.failed_at).toBeNull();
    expect(payload.data.contact).not.toBeNull();
  });

  it.each(textEvents)("does not carry is_blocked on %s", (file) => {
    const payload = loadFixture<TextWebhookPayload>(file);
    expect(
      Object.prototype.hasOwnProperty.call(payload.data.text_message, "is_blocked"),
    ).toBe(false);
  });
});

describe("PhoneIncomingCallWebhookPayload", () => {
  it("parses the flat (no-envelope) call payload", () => {
    const payload = loadFixture<PhoneIncomingCallWebhookPayload>("phone_incoming_call.json");
    // No event_type / timestamp / data envelope — fields sit at the top.
    expect(payload.id).toBeTypeOf("string");
    expect(payload.direction).toBe("inbound");
    expect(payload.status).toBe("initiated");
    expect(payload.contact).toBeNull();
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
});

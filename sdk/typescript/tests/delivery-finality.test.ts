import { describe, expect, it } from "vitest";
import {
  parseIMessage, parseIMessageRecipient, parseIMessageConversationSummary,
} from "../src/imessage/types.js";
import {
  parseTextMessage, parseTextMessageRecipient, parseTextConversationSummary,
} from "../src/phone/types.js";

const timestamp = "2026-01-01T00:00:00Z";
const message = {
  id: "message-id", conversation_id: "conversation-id", assignment_id: null,
  remote_number: "+15551234567", direction: "outbound", message_type: "message",
  service: "sms", status: "sent", is_read: false, created_at: timestamp, updated_at: timestamp,
};
const text = {
  id: "text-id", direction: "outbound", local_phone_number: "+15557654321",
  type: "sms", delivery_status: "delivered", text: null, media: null,
  is_read: false, created_at: timestamp, updated_at: timestamp,
};

describe("server-reported delivery finality", () => {
  for (const fields of [{}, { delivery_final: null }, { delivery_final: false }, { delivery_final: true }]) {
    it(`preserves ${JSON.stringify(fields)} without deriving a state`, () => {
      const expected = "delivery_final" in fields ? fields.delivery_final : null;
      expect(parseIMessage({ ...message, ...fields }).deliveryFinal).toBe(expected);
      expect(parseTextMessage({ ...text, ...fields }).deliveryFinal).toBe(expected);
      expect(parseIMessageRecipient({ remote_number: "+15551234567", ...fields }).deliveryFinal).toBe(expected);
      expect(parseTextMessageRecipient({ recipient_phone_number: "+15551234567", ...fields }).deliveryFinal).toBe(expected);
    });
  }

  it("keeps aggregate and recipient state separate, including the legacy flag", () => {
    const result = parseIMessage({ ...message, delivery_final: false, was_downgraded: false,
      recipients: [{ remote_number: "+15551234567", delivery_final: true }] });
    expect(result.deliveryFinal).toBe(false);
    expect(result.recipients?.[0].deliveryFinal).toBe(true);
    expect(result.wasDowngraded).toBe(false);
    expect(result.service).toBe("sms");
    expect(parseIMessage(message).wasDowngraded).toBeNull();
    const sms = parseTextMessage({ ...text, delivery_final: false,
      recipients: [{ recipient_phone_number: "+15551234567", delivery_final: true }] });
    expect(sms.deliveryFinal).toBe(false);
    expect(sms.recipients?.[0].deliveryFinal).toBe(true);
  });

  it.each([null, false, true])("retains outbound summary state after inbound replies (%s)", (finality) => {
    const imessageSummary = { id: "conversation-id", assignment_id: null, remote_number: "+15551234567",
      latest_direction: "inbound", created_at: timestamp, updated_at: timestamp };
    const textSummary = { latest_text: "Reply", latest_direction: "inbound", latest_type: "sms",
      latest_message_at: timestamp, unread_count: 1, total_count: 2 };
    for (const row of [parseIMessageConversationSummary(imessageSummary), parseTextConversationSummary(textSummary)]) {
      expect(row.latestOutboundService).toBeNull();
      expect(row.latestOutboundStatus).toBeNull();
      expect(row.latestOutboundDeliveryFinal).toBeNull();
    }
    const rows = [
      parseIMessageConversationSummary({ ...imessageSummary, latest_outbound_service: "rcs",
        latest_outbound_status: "sent", latest_outbound_delivery_final: finality }),
      parseTextConversationSummary({ ...textSummary, latest_outbound_service: "mms",
        latest_outbound_status: "delivery_unconfirmed", latest_outbound_delivery_final: finality }),
    ];
    expect(rows.map((row) => row.latestOutboundService)).toEqual(["rcs", "mms"]);
    expect(rows.map((row) => row.latestOutboundStatus)).toEqual(["sent", "delivery_unconfirmed"]);
    for (const row of rows) {
      expect(row.latestDirection).toBe("inbound");
      expect(row.latestOutboundDeliveryFinal).toBe(finality);
    }
  });
});

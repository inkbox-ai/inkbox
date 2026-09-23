import { describe, expect, it } from "vitest";
import { parseWebhookDelivery, type RawWebhookDelivery } from "../src/webhooks/deliveries.js";

const raw: RawWebhookDelivery = {
  id: "11111111-1111-1111-1111-111111111111", organization_id: "org_test",
  webhook_subscription_id: "22222222-2222-2222-2222-222222222222", phone_number_id: null,
  event_id: "evt_example", event_type: "message.received", url: "https://example.com/hook",
  request_payload: "{}", response_status: 200, response_body: null, error_detail: null,
  duration_ms: 1, is_replay: false, created_at: "2026-09-15T00:00:00Z",
};

describe("delivery history", () => {
  it("preserves the original target while exposing current replayability", () => {
    const row = parseWebhookDelivery({ ...raw, replayable: true });
    expect(row.webhookSubscriptionId).toBe(raw.webhook_subscription_id);
    expect(row.replayable).toBe(true);
    expect(row.replayUnavailableReason).toBeNull();
  });
  it("does not infer replayability from an old response", () => {
    expect(parseWebhookDelivery(raw)).toMatchObject({ replayable: false, replayUnavailableReason: null });
  });
  it("preserves an unavailable reason", () => {
    expect(parseWebhookDelivery({ ...raw, replayable: false,
      replay_unavailable_reason: "event_not_subscribed" }).replayUnavailableReason)
      .toBe("event_not_subscribed");
  });
});

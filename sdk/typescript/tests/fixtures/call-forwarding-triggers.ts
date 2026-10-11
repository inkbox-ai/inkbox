// sdk/typescript/tests/fixtures/call-forwarding-triggers.ts
import { CallForwardingTrigger, type WebhookPhoneCallForwarding } from "../../src/index.js";

const wireTriggers: WebhookPhoneCallForwarding["trigger"][] = [
  "incoming_action", "live_transfer", "live_conference",
];
const triggers: CallForwardingTrigger[] = [
  CallForwardingTrigger.INCOMING_ACTION,
  CallForwardingTrigger.LIVE_TRANSFER,
  CallForwardingTrigger.LIVE_CONFERENCE,
];

void wireTriggers;
void triggers;

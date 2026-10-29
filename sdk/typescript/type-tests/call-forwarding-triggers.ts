// Existing exhaustive consumers must still compile unchanged.
import { CallForwardingTrigger, type WebhookPhoneCallForwarding } from "../dist/index.js";

const wireTrigger: WebhookPhoneCallForwarding["trigger"] = "incoming_action";
function legacyTriggerLabel(trigger: CallForwardingTrigger): string {
  switch (trigger) {
    case CallForwardingTrigger.INCOMING_ACTION: return "Incoming forwarding";
    default: {
      const exhaustive: never = trigger;
      return exhaustive;
    }
  }
}
void wireTrigger;
void legacyTriggerLabel;

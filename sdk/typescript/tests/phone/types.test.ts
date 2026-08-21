// sdk/typescript/tests/phone/types.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  parsePhoneNumber,
  parsePhoneCall,
  parseRateLimitInfo,
  parsePhoneCallWithRateLimit,
  parsePhoneTranscript,
  parseIncomingCallActionConfig,
  CallOrigin,
  VoicemailDetection,
  IncomingCallAction,
  CallForwardingStatus,
  CallForwardingTrigger,
  ForwardingTargetType,
  SmsStatus,
} from "../../src/phone/types.js";
import {
  RAW_PHONE_NUMBER,
  RAW_PHONE_CALL,
  RAW_RATE_LIMIT,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
  RAW_PHONE_TRANSCRIPT,
  RAW_INCOMING_CALL_ACTION_CONFIG,
} from "../sampleData.js";

describe("parsePhoneNumber", () => {
  it("converts all fields", () => {
    const n = parsePhoneNumber(RAW_PHONE_NUMBER);
    expect(n.id).toBe(RAW_PHONE_NUMBER.id);
    expect(n.number).toBe("+18335794607");
    expect(n.type).toBe("local");
    expect(n.status).toBe("active");
    expect(n.incomingCallAction).toBe("auto_reject");
    expect(n.clientWebsocketUrl).toBeNull();
    expect(n.agentIdentityId).toBe("eeee5555-0000-0000-0000-000000000001");
    expect(n.createdAt).toBeInstanceOf(Date);
    expect(n.updatedAt).toBeInstanceOf(Date);
  });

  it("null agentIdentityId on released-state response", () => {
    const n = parsePhoneNumber({ ...RAW_PHONE_NUMBER, agent_identity_id: null });
    expect(n.agentIdentityId).toBeNull();
  });

  it("parses SMS readiness fields", () => {
    const n = parsePhoneNumber(RAW_PHONE_NUMBER);
    expect(n.smsStatus).toBe(SmsStatus.READY);
    expect(n.smsErrorCode).toBeNull();
    expect(n.smsErrorDetail).toBeNull();
    expect(n.smsReadyAt).toBeInstanceOf(Date);
  });

  it("parses SMS provisioning failure", () => {
    const n = parsePhoneNumber({
      ...RAW_PHONE_NUMBER,
      sms_status: "assignment_failed",
      sms_error_code: "tcr_campaign_rejected",
      sms_error_detail: "Campaign brand mismatch",
      sms_ready_at: null,
    });
    expect(n.smsStatus).toBe(SmsStatus.ASSIGNMENT_FAILED);
    expect(n.smsErrorCode).toBe("tcr_campaign_rejected");
    expect(n.smsErrorDetail).toBe("Campaign brand mismatch");
    expect(n.smsReadyAt).toBeNull();
  });

  it("defaults smsStatus to READY when missing (legacy server)", () => {
    const {
      sms_status: _ss,
      sms_error_code: _sec,
      sms_error_detail: _sed,
      sms_ready_at: _sra,
      ...legacy
    } = RAW_PHONE_NUMBER;
    const n = parsePhoneNumber(legacy as typeof RAW_PHONE_NUMBER);
    expect(n.smsStatus).toBe(SmsStatus.READY);
  });
});

describe("parsePhoneCall", () => {
  it("converts all fields", () => {
    const c = parsePhoneCall(RAW_PHONE_CALL);
    expect(c.id).toBe(RAW_PHONE_CALL.id);
    expect(c.localPhoneNumber).toBe("+18335794607");
    expect(c.remotePhoneNumber).toBe("+15551234567");
    expect(c.direction).toBe("outbound");
    expect(c.status).toBe("completed");
    expect(c.clientWebsocketUrl).toBe("wss://agent.example.com/ws");
    expect(c.startedAt).toBeInstanceOf(Date);
    expect(c.endedAt).toBeInstanceOf(Date);
    expect(c.isBlocked).toBe(false);
    expect(c.origin).toBe(CallOrigin.DEDICATED_NUMBER);
    expect(c.voicemailDetection).toBe(VoicemailDetection.ENABLED);
    expect(c.forwardings).toEqual([]);
  });

  it("parses shared-pool origin and null localPhoneNumber", () => {
    const c = parsePhoneCall({
      ...RAW_PHONE_CALL,
      local_phone_number: null,
      origin: "shared_imessage_number",
    });
    expect(c.localPhoneNumber).toBeNull();
    expect(c.origin).toBe(CallOrigin.SHARED_IMESSAGE_NUMBER);
  });

  it("defaults origin to dedicated_number when missing", () => {
    const { origin: _ignored, ...legacyPayload } = RAW_PHONE_CALL;
    void _ignored;
    const c = parsePhoneCall(legacyPayload);
    expect(c.origin).toBe(CallOrigin.DEDICATED_NUMBER);
  });

  it("parses dedicated iMessage origin", () => {
    const c = parsePhoneCall({
      ...RAW_PHONE_CALL,
      origin: "dedicated_imessage_number",
      local_phone_number: "+15555550123",
    });
    expect(c.origin).toBe(CallOrigin.DEDICATED_IMESSAGE_NUMBER);
    expect(c.localPhoneNumber).toBe("+15555550123");
  });

  it("defaults legacy voicemail detection and preserves disabled", () => {
    const { voicemail_detection: _ignored, ...legacyPayload } = RAW_PHONE_CALL;
    void _ignored;
    expect(parsePhoneCall(legacyPayload).voicemailDetection).toBe(
      VoicemailDetection.ENABLED,
    );
    expect(
      parsePhoneCall({
        ...RAW_PHONE_CALL,
        voicemail_detection: "disabled",
      }).voicemailDetection,
    ).toBe(VoicemailDetection.DISABLED);
  });

  it("handles null timestamps", () => {
    const c = parsePhoneCall({ ...RAW_PHONE_CALL, started_at: null, ended_at: null });
    expect(c.startedAt).toBeNull();
    expect(c.endedAt).toBeNull();
  });

  it("preserves isBlocked=true (admin/JWT view of a blocked call)", () => {
    const c = parsePhoneCall({ ...RAW_PHONE_CALL, is_blocked: true });
    expect(c.isBlocked).toBe(true);
  });

  it("defaults isBlocked to false when missing from server response", () => {
    // Older server payloads predate the field — parser must default to false
    // so existing clients keep working.
    const { is_blocked: _ignored, ...legacyPayload } = RAW_PHONE_CALL;
    void _ignored;
    const c = parsePhoneCall(legacyPayload);
    expect(c.isBlocked).toBe(false);
  });

  it("parses forwarding history", () => {
    const c = parsePhoneCall({
      ...RAW_PHONE_CALL,
      forwardings: [{
        id: "bbbb2222-0000-0000-0000-000000000099",
        trigger: "incoming_action",
        status: "forwarded",
        target_type: "phone",
        target: "+14155550100",
        requested_at: "2026-08-21T12:00:00Z",
        dialing_at: "2026-08-21T12:00:01Z",
        forwarded_at: "2026-08-21T12:00:03Z",
        ended_at: null,
        failure_code: null,
      }],
    });
    expect(c.forwardings[0].trigger).toBe(CallForwardingTrigger.INCOMING_ACTION);
    expect(c.forwardings[0].status).toBe(CallForwardingStatus.FORWARDED);
    expect(c.forwardings[0].targetType).toBe(ForwardingTargetType.PHONE);
    expect(c.forwardings[0].requestedAt).toBeInstanceOf(Date);
  });
});

describe("parseRateLimitInfo", () => {
  it("converts all fields", () => {
    const r = parseRateLimitInfo(RAW_RATE_LIMIT);
    expect(r.callsUsed).toBe(5);
    expect(r.callsRemaining).toBe(95);
    expect(r.callsLimit).toBe(100);
    expect(r.minutesUsed).toBe(12.5);
    expect(r.minutesRemaining).toBe(987.5);
    expect(r.minutesLimit).toBe(1000);
  });
});

describe("parsePhoneCallWithRateLimit", () => {
  it("includes rateLimit", () => {
    const c = parsePhoneCallWithRateLimit(RAW_PHONE_CALL_WITH_RATE_LIMIT);
    expect(c.rateLimit.callsUsed).toBe(5);
    expect(c.status).toBe("completed");
  });

  it("carries call fields through — shared origin and null localPhoneNumber", () => {
    const c = parsePhoneCallWithRateLimit({
      ...RAW_PHONE_CALL_WITH_RATE_LIMIT,
      local_phone_number: null,
      origin: "shared_imessage_number",
    });
    expect(c.localPhoneNumber).toBeNull();
    expect(c.origin).toBe(CallOrigin.SHARED_IMESSAGE_NUMBER);
    expect(c.rateLimit.minutesRemaining).toBe(987.5);
  });
});

describe("parsePhoneTranscript", () => {
  it("converts all fields", () => {
    const t = parsePhoneTranscript(RAW_PHONE_TRANSCRIPT);
    expect(t.id).toBe(RAW_PHONE_TRANSCRIPT.id);
    expect(t.callId).toBe(RAW_PHONE_TRANSCRIPT.call_id);
    expect(t.seq).toBe(0);
    expect(t.tsMs).toBe(1500);
    expect(t.party).toBe("local");
    expect(t.text).toBe("Hello, how can I help you?");
    expect(t.createdAt).toBeInstanceOf(Date);
  });
});

describe("parseIncomingCallActionConfig", () => {
  it("parses the shared forwarding fixture", () => {
    const fixture = JSON.parse(readFileSync(
      new URL("../../../../tests/fixtures/incoming_call_forwarding.json", import.meta.url),
      "utf8",
    ));
    const config = parseIncomingCallActionConfig(fixture.config);
    expect(config.incomingCallAction).toBe(IncomingCallAction.FORWARD);
    expect(config.forwardingTargetType).toBe(ForwardingTargetType.SIP);
  });

  it("converts all fields", () => {
    const c = parseIncomingCallActionConfig(RAW_INCOMING_CALL_ACTION_CONFIG);
    expect(c.agentIdentityId).toBe(RAW_INCOMING_CALL_ACTION_CONFIG.agent_identity_id);
    expect(c.incomingCallAction).toBe(IncomingCallAction.WEBHOOK);
    expect(c.clientWebsocketUrl).toBeNull();
    expect(c.incomingCallWebhookUrl).toBe("https://agent.example.com/incoming-call");
  });

  it("coerces missing optional urls to null", () => {
    const c = parseIncomingCallActionConfig({
      agent_identity_id: "id-1",
      incoming_call_action: "auto_accept",
    });
    expect(c.clientWebsocketUrl).toBeNull();
    expect(c.incomingCallWebhookUrl).toBeNull();
  });
});

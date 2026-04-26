// sdk/typescript/tests/phone/types.test.ts
import { describe, it, expect } from "vitest";
import {
  parsePhoneNumber,
  parsePhoneCall,
  parseRateLimitInfo,
  parsePhoneCallWithRateLimit,
  parsePhoneTranscript,
  SmsStatus,
} from "../../src/phone/types.js";
import {
  RAW_PHONE_NUMBER,
  RAW_PHONE_CALL,
  RAW_RATE_LIMIT,
  RAW_PHONE_CALL_WITH_RATE_LIMIT,
  RAW_PHONE_TRANSCRIPT,
} from "../sampleData.js";

describe("parsePhoneNumber", () => {
  it("converts all fields", () => {
    const n = parsePhoneNumber(RAW_PHONE_NUMBER);
    expect(n.id).toBe(RAW_PHONE_NUMBER.id);
    expect(n.number).toBe("+18335794607");
    expect(n.type).toBe("toll_free");
    expect(n.status).toBe("active");
    expect(n.incomingCallAction).toBe("auto_reject");
    expect(n.clientWebsocketUrl).toBeNull();
    expect(n.agentIdentityId).toBe("eeee5555-0000-0000-0000-000000000001");
    expect(n.createdAt).toBeInstanceOf(Date);
    expect(n.updatedAt).toBeInstanceOf(Date);
  });

  it("null agentIdentityId for standalone number", () => {
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
    expect(c.remotePhoneNumber).toBe("+15167251294");
    expect(c.direction).toBe("outbound");
    expect(c.status).toBe("completed");
    expect(c.clientWebsocketUrl).toBe("wss://agent.example.com/ws");
    expect(c.startedAt).toBeInstanceOf(Date);
    expect(c.endedAt).toBeInstanceOf(Date);
  });

  it("handles null timestamps", () => {
    const c = parsePhoneCall({ ...RAW_PHONE_CALL, started_at: null, ended_at: null });
    expect(c.startedAt).toBeNull();
    expect(c.endedAt).toBeNull();
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


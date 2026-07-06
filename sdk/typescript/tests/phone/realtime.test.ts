// sdk/typescript/tests/phone/realtime.test.ts
import { describe, it, expect } from "vitest";
import { parseEvent } from "../../src/phone/realtime/events.js";
import type {
  BargeInEvent,
  CallEndedEvent,
  CallStartedEvent,
  ConsultRequestedEvent,
  TranscriptEvent,
  UnknownEvent,
} from "../../src/phone/realtime/events.js";
import {
  consultAnswer,
  hangUp,
  injectContext,
  say,
  updateInstructions,
} from "../../src/phone/realtime/intervene.js";

const IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001";
const CALL_ID = "call_abc123";

describe("parseEvent (observe)", () => {
  it("decodes call.started with identity and optional number", () => {
    const started = parseEvent({
      event: "call.started", call_id: CALL_ID,
      agent_identity_id: IDENTITY_ID, direction: "inbound",
    }) as CallStartedEvent;
    expect(started.event).toBe("call.started");
    expect(started.agentIdentityId).toBe(IDENTITY_ID);
    expect(started.direction).toBe("inbound");
    expect(started.phoneNumber).toBeNull(); // absent on some inbound legs
  });

  it("decodes transcript and barge_in with a callId", () => {
    const transcript = parseEvent({
      event: "transcript", call_id: CALL_ID, party: "remote", text: "hello",
      is_final: true, turn_id: "t1",
    }) as TranscriptEvent;
    expect(transcript.callId).toBe(CALL_ID);
    expect(transcript.text).toBe("hello");
    expect(transcript.isFinal).toBe(true);
    expect(transcript.turnId).toBe("t1");

    // barge_in carries only callId + optional turnId on the hosted-call wire.
    const barge = parseEvent({
      event: "barge_in", call_id: CALL_ID, turn_id: null,
    }) as BargeInEvent;
    expect(barge.callId).toBe(CALL_ID);
    expect(barge.turnId).toBeNull(); // optional
  });

  it("decodes consult.requested and call.ended", () => {
    const consult = parseEvent({
      event: "consult.requested", call_id: CALL_ID, consult_id: "c1", query: "refund?",
      transcript_tail: [{ speaker: "remote", text: "hi" }],
    }) as ConsultRequestedEvent;
    expect(consult.callId).toBe(CALL_ID);
    expect(consult.consultId).toBe("c1");
    expect(consult.transcriptTail[0].text).toBe("hi");

    const ended = parseEvent({
      event: "call.ended", call_id: CALL_ID, reason: "hangup",
      post_call_actions: [{ action: "note", details: { x: 1 } }],
      transcript: [{ speaker: "local", text: "bye" }],
    }) as CallEndedEvent;
    expect(ended.callId).toBe(CALL_ID);
    expect(ended.reason).toBe("hangup");
    expect(ended.postCallActions[0].action).toBe("note");
    expect(ended.transcript[0].text).toBe("bye");
  });

  it("falls back to an unknown variant that retains raw", () => {
    const event = parseEvent({ event: "future.thing", x: 1 }) as UnknownEvent;
    expect(event.event).toBe("future.thing");
    expect(event.raw.x).toBe(1); // forward-compat: raw payload retained
  });
});

describe("intervene builders", () => {
  it("consultAnswer includes optional instructions", () => {
    expect(consultAnswer("c1", "Yes, full refund", "be warm")).toEqual({
      event: "consult.answer", consult_id: "c1",
      answer: "Yes, full refund", instructions: "be warm",
    });
    expect(consultAnswer("c1", "ok")).toEqual({
      event: "consult.answer", consult_id: "c1", answer: "ok",
    });
  });

  it("say and injectContext map to inject modes (no callId)", () => {
    expect(say("One moment")).toEqual({ event: "inject", mode: "say", text: "One moment" });
    expect(injectContext("VIP customer")).toEqual({
      event: "inject", mode: "context", text: "VIP customer",
    });
  });

  it("updateInstructions and hangUp", () => {
    expect(updateInstructions("Speak French")).toEqual({
      event: "update_instructions", instructions: "Speak French",
    });
    expect(hangUp("resolved")).toEqual({ event: "hang_up", reason: "resolved" });
    expect(hangUp()).toEqual({ event: "hang_up" });
  });
});

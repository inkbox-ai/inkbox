// sdk/typescript/tests/phone/realtimeControl.test.ts
import { describe, it, expect } from "vitest";
import {
  RealtimeResource,
  type ControlTransport,
} from "../../src/phone/realtime/session.js";
import type {
  CallEndedEvent,
  ConsultRequestedEvent,
  ModelToolCallEvent,
  TranscriptEvent,
} from "../../src/phone/realtime/events.js";

const IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001";
const CALL_ID = "call_abc123";

/** Records outbound messages; replays a scripted inbound queue. */
class FakeTransport implements ControlTransport {
  sent: unknown[] = [];
  closed = false;
  private inbound: string[];

  constructor(inbound: string[] = []) {
    this.inbound = [...inbound];
  }

  send(text: string): void {
    this.sent.push(JSON.parse(text));
  }

  next(): Promise<string | null> {
    return Promise.resolve(this.inbound.shift() ?? null);
  }

  close(): void {
    this.closed = true;
  }
}

function makeResource(transport: FakeTransport) {
  const captured: { url?: string; headers?: Record<string, string> } = {};
  const resource = new RealtimeResource({
    apiKey: "sk-test",
    baseUrl: "https://inkbox.ai",
    transportFactory: async (url, headers) => {
      captured.url = url;
      captured.headers = headers;
      return transport;
    },
  });
  return { resource, captured };
}

describe("RealtimeResource.connect", () => {
  it("subscribes by callId with the service-token header", async () => {
    const transport = new FakeTransport();
    const { resource, captured } = makeResource(transport);

    await resource.connect({ callId: CALL_ID });

    expect(captured.url).toBe("wss://inkbox.ai/api/v1/phone/ws/realtime-control");
    expect(captured.headers).toEqual({ "X-Service-Token": "sk-test" });
    expect(transport.sent).toEqual([{ event: "subscribe", call_id: CALL_ID }]);
  });

  it("subscribes by agentIdentityId", async () => {
    const transport = new FakeTransport();
    const { resource } = makeResource(transport);

    await resource.connect({ agentIdentityId: IDENTITY_ID });

    expect(transport.sent).toEqual([
      { event: "subscribe", agent_identity_id: IDENTITY_ID },
    ]);
  });

  it("requires exactly one of callId or agentIdentityId", async () => {
    const { resource } = makeResource(new FakeTransport());
    await expect(resource.connect({})).rejects.toThrow();
    await expect(
      resource.connect({ callId: CALL_ID, agentIdentityId: IDENTITY_ID }),
    ).rejects.toThrow();
  });
});

describe("RealtimeControlSession observe", () => {
  it("iterates typed events until the peer closes", async () => {
    const inbound = [
      JSON.stringify({
        event: "transcript", call_id: CALL_ID, party: "remote",
        text: "hello", is_final: true, turn_id: "t1",
      }),
      JSON.stringify({
        event: "model.tool_call", call_id: CALL_ID, tool_call_id: "tc1",
        tool_name: "lookup_contact", arguments: { name: "Ada" },
        requires_approval: true,
      }),
      JSON.stringify({
        event: "consult.requested", call_id: CALL_ID, consult_id: "c1",
        query: "refund?", transcript_tail: [{ speaker: "remote", text: "hi" }],
      }),
      JSON.stringify({
        event: "call.ended", call_id: CALL_ID, reason: "hangup",
        post_call_actions: [{ action: "note", details: { x: 1 } }],
        transcript: [{ speaker: "local", text: "bye" }],
      }),
    ];
    const transport = new FakeTransport(inbound);
    const { resource } = makeResource(transport);
    const session = await resource.connect({ callId: CALL_ID });

    const events = [];
    for await (const event of session) events.push(event);

    expect(events).toHaveLength(4);
    const transcript = events[0] as TranscriptEvent;
    expect(transcript.event).toBe("transcript");
    expect(transcript.text).toBe("hello");
    expect(transcript.isFinal).toBe(true);
    const tool = events[1] as ModelToolCallEvent;
    expect(tool.requiresApproval).toBe(true);
    expect(tool.arguments).toEqual({ name: "Ada" });
    const consult = events[2] as ConsultRequestedEvent;
    expect(consult.consultId).toBe("c1");
    expect(consult.transcriptTail[0].text).toBe("hi");
    const ended = events[3] as CallEndedEvent;
    expect(ended.postCallActions[0].action).toBe("note");
  });
});

describe("RealtimeControlSession intervene", () => {
  async function connected() {
    const transport = new FakeTransport();
    const { resource } = makeResource(transport);
    const session = await resource.connect({ callId: CALL_ID });
    transport.sent.length = 0; // drop the subscribe frame
    return { session, transport };
  }

  it("answerConsult sends the answer command", async () => {
    const { session, transport } = await connected();
    session.answerConsult("c1", "Yes, full refund", "be warm");
    expect(transport.sent).toEqual([
      {
        event: "consult.answer", consult_id: "c1",
        answer: "Yes, full refund", instructions: "be warm",
      },
    ]);
  });

  it("say and injectContext map to inject modes", async () => {
    const { session, transport } = await connected();
    session.say(CALL_ID, "One moment");
    session.injectContext(CALL_ID, "VIP customer");
    expect(transport.sent).toEqual([
      { event: "inject", call_id: CALL_ID, mode: "say", text: "One moment" },
      { event: "inject", call_id: CALL_ID, mode: "context", text: "VIP customer" },
    ]);
  });

  it("approveTool and denyTool send tool decisions", async () => {
    const { session, transport } = await connected();
    session.approveTool(CALL_ID, "tc1");
    session.denyTool(CALL_ID, "tc2", "not allowed");
    expect(transport.sent).toEqual([
      { event: "tool.decision", call_id: CALL_ID, tool_call_id: "tc1", decision: "approve" },
      {
        event: "tool.decision", call_id: CALL_ID, tool_call_id: "tc2",
        decision: "deny", reason: "not allowed",
      },
    ]);
  });

  it("updateInstructions, hangUp, and close", async () => {
    const { session, transport } = await connected();
    session.updateInstructions(CALL_ID, "Speak French");
    session.hangUp(CALL_ID, "resolved");
    await session.close();
    expect(transport.sent).toEqual([
      { event: "update_instructions", call_id: CALL_ID, instructions: "Speak French" },
      { event: "hang_up", call_id: CALL_ID, reason: "resolved" },
    ]);
    expect(transport.closed).toBe(true);
  });
});

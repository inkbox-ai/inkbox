// sdk/typescript/tests/phone/connections.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CallConnectionKind, CallConnectionStatus, CallConnectionTrigger, CallForwardingTrigger } from "../../src/index.js";
import type { PhoneCallConnection, WebhookPhoneCallConnection } from "../../src/index.js";
import { parsePhoneCall, type RawPhoneCall } from "../../src/phone/types.js";

function fixture(): RawPhoneCall {
  return JSON.parse(readFileSync(new URL("../../../../tests/fixtures/phone_call_connections.json", import.meta.url), "utf8"));
}

describe("call connections", () => {
  it("keeps connection kinds, triggers, progress and timestamps distinct", () => {
    const call = parsePhoneCall(fixture());
    const connections: PhoneCallConnection[] = call.connections!;
    expect(connections[0].kind).toBe(CallConnectionKind.HANDOFF);
    expect(connections[0].trigger).toBe(CallConnectionTrigger.INCOMING_ACTION);
    expect(connections[1].trigger).toBe(CallConnectionTrigger.AGENT_TOOL);
    expect(connections[1].failureCode).toBe("destination_rejected");
    expect(connections[2].kind).toBe(CallConnectionKind.CONFERENCE);
    expect(connections[2].status).toBe(CallConnectionStatus.CONNECTED);
    expect(connections[2].connectedAt).toBeInstanceOf(Date);
    expect(connections[2].endedAt!.getTime()).toBeGreaterThan(connections[2].connectedAt!.getTime());
    expect(connections[3].status).toBe(CallConnectionStatus.REQUESTED);
    expect(connections[3].dialingAt).toBeNull();
    expect(connections[4].status).toBe(CallConnectionStatus.DIALING);
    expect(connections[4].connectedAt).toBeNull();
    expect(call.forwardings[1].trigger).toBe(CallForwardingTrigger.LIVE_TRANSFER);
    expect(call.forwardings[2].trigger).toBe(CallForwardingTrigger.LIVE_CONFERENCE);
  });

  it("preserves absent versus authoritative empty connections", () => {
    const wire = fixture();
    delete wire.connections;
    expect(parsePhoneCall(wire).connections).toBeUndefined();
    wire.connections = [];
    const call = parsePhoneCall(wire);
    expect(call.connections).toEqual([]);
    expect(call.forwardings).toHaveLength(5);
  });

  it("exports the snake-case webhook contract", () => {
    const connection: WebhookPhoneCallConnection = {
      id: "22222222-2222-4222-8222-000000000001", kind: "conference", trigger: "agent_tool", status: "connected",
      target_type: "phone", target: "+14155550102", requested_at: "2026-10-09T12:00:00Z",
      dialing_at: null, connected_at: "2026-10-09T12:00:03Z", ended_at: null, failure_code: null,
    };
    expect(connection.connected_at).toBe("2026-10-09T12:00:03Z");
  });
});

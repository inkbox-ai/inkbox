// sdk/typescript/tests/phone/connections.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CallConnectionKind, CallConnectionStatus, CallConnectionTrigger } from "../../src/index.js";
import type { PhoneCallConnection, WebhookPhoneCallConnection } from "../../src/index.js";
import { parseCorrespondenceItem, type RawCallCorrespondenceItem } from "../../src/contacts/correspondence.js";
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
    expect(call.forwardings).toHaveLength(1);
    expect(call.forwardings[0].trigger).toBe("incoming_action");
  });

  it("preserves absent versus authoritative empty connections", () => {
    const wire = fixture();
    delete wire.connections;
    expect(parsePhoneCall(wire).connections).toBeUndefined();
    wire.connections = [];
    const call = parsePhoneCall(wire);
    expect(call.connections).toEqual([]);
    expect(call.forwardings).toHaveLength(1);
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


describe("call correspondence connections", () => {
  it("shares the canonical parser and preserves absent versus empty history", () => {
    const wire = fixture();
    const item: RawCallCorrespondenceItem = {
      channel: "calls", source_id: wire.id, identity_id: "55555555-5555-4555-8555-555555555555",
      direction: "inbound", occurred_at: wire.created_at, status: "completed", detail_url: null,
      remote_phone_number: wire.remote_phone_number!, local_phone_number: wire.local_phone_number,
      started_at: null, ended_at: null, duration_seconds: null, transcript: null,
      transcript_abridged: false, transcript_unavailable: false, connections: wire.connections,
    };
    function parse() {
      const parsed = parseCorrespondenceItem(item);
      if (parsed.channel !== "calls") throw new Error("Expected call correspondence");
      return parsed;
    }
    expect(parse().connections).toEqual(parsePhoneCall(wire).connections);
    item.connections = [];
    expect(parse().connections).toEqual([]);
    delete item.connections;
    expect(parse().connections).toBeUndefined();
  });
});


it("preserves future connection values without classifying them as known outcomes", () => {
  const wire = fixture();
  Object.assign(wire.connections![0], {kind: "future_kind", trigger: "future_trigger", status: "future_status"});
  const connection = parsePhoneCall(wire).connections![0];
  expect(connection.kind).toBe("future_kind");
  expect(connection.trigger).toBe("future_trigger");
  expect(connection.status).toBe("future_status");
  expect(connection.kind).not.toBe(CallConnectionKind.HANDOFF);
  expect(connection.status).not.toBe(CallConnectionStatus.CONNECTED);
  const webhook: WebhookPhoneCallConnection = {...wire.connections![0], target_type: "phone"};
  expect(webhook.kind).toBe("future_kind");
});

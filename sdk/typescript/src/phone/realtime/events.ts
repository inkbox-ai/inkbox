/**
 * inkbox/phone/realtime/events.ts
 *
 * Typed observe events the platform emits on the call WebSocket when an
 * identity runs on platform-hosted voice. Field names match the wire JSON
 * (snake_case in, camelCase out); `event` is the discriminator. Every variant
 * keeps the full decoded `raw` payload so unknown fields stay reachable across
 * server versions. These frames ride the one existing per-call WebSocket and
 * each carries the `callId` it belongs to; only the outbound intervene frames
 * omit it (that socket is already scoped to one call — see `./intervene`).
 */

export interface TranscriptTurn {
  party: "local" | "remote";
  text: string;
}

export interface PostCallAction {
  action: string;
  details: unknown;
}

interface Base {
  raw: Record<string, unknown>;
}

export interface CallStartedEvent extends Base {
  event: "call.started";
  callId: string;
  agentIdentityId: string;
  direction: "inbound" | "outbound";
  phoneNumber: string | null;
}

export interface CallAnsweredEvent extends Base {
  event: "call.answered";
  callId: string;
}

export interface TranscriptEvent extends Base {
  event: "transcript";
  callId: string;
  party: "local" | "remote";
  text: string;
  isFinal: boolean;
  turnId: string | null;
}

export interface BargeInEvent extends Base {
  event: "barge_in";
  callId: string;
  turnId: string | null;
}

export interface ConsultRequestedEvent extends Base {
  event: "consult.requested";
  callId: string;
  consultId: string;
  query: string;
  transcriptTail: TranscriptTurn[];
}

export interface CallEndedEvent extends Base {
  event: "call.ended";
  callId: string;
  reason: string | null;
  postCallActions: PostCallAction[];
  transcript: TranscriptTurn[];
}

export interface UnknownEvent extends Base {
  event: string;
}

export type RealtimeEvent =
  | CallStartedEvent
  | CallAnsweredEvent
  | TranscriptEvent
  | BargeInEvent
  | ConsultRequestedEvent
  | CallEndedEvent
  | UnknownEvent;

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

/** A wire string that may be absent — kept as `null` rather than "". */
function optS(v: unknown): string | null {
  return v == null ? null : s(v);
}

function turns(v: unknown): TranscriptTurn[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => ({
    party: (t as any)?.party === "local" ? "local" : "remote",
    text: s((t as any)?.text),
  }));
}

/** Decode one wire message into its typed observe event. */
export function parseEvent(d: Record<string, unknown>): RealtimeEvent {
  const raw = d;
  switch (d.event) {
    case "call.started":
      return {
        event: "call.started", raw, callId: s(d.call_id),
        agentIdentityId: s(d.agent_identity_id),
        direction: d.direction === "outbound" ? "outbound" : "inbound",
        phoneNumber: optS(d.phone_number),
      };
    case "call.answered":
      return { event: "call.answered", raw, callId: s(d.call_id) };
    case "transcript":
      return {
        event: "transcript", raw, callId: s(d.call_id),
        party: d.party === "local" ? "local" : "remote", text: s(d.text),
        isFinal: Boolean(d.is_final), turnId: optS(d.turn_id),
      };
    case "barge_in":
      return {
        event: "barge_in", raw, callId: s(d.call_id), turnId: optS(d.turn_id),
      };
    case "consult.requested":
      return {
        event: "consult.requested", raw, callId: s(d.call_id),
        consultId: s(d.consult_id), query: s(d.query),
        transcriptTail: turns(d.transcript_tail),
      };
    case "call.ended":
      return {
        event: "call.ended", raw, callId: s(d.call_id), reason: optS(d.reason),
        postCallActions: Array.isArray(d.post_call_actions)
          ? (d.post_call_actions as any[]).map((a) => ({
              action: s(a?.action), details: a?.details ?? null,
            }))
          : [],
        transcript: turns(d.transcript),
      };
    default:
      return { event: s(d.event), raw };
  }
}

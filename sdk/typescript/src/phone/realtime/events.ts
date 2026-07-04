/**
 * inkbox/phone/realtime/events.ts
 *
 * Typed observe events emitted by the realtime control channel. Field names
 * match the wire JSON (snake_case); `event` is the discriminator. Every
 * variant keeps the full decoded `raw` payload so unknown fields stay
 * reachable across server versions.
 */

export interface TranscriptTurn {
  speaker: string;
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
  phoneNumber: string;
  direction: "inbound" | "outbound";
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
  turnId: string;
}

export interface BargeInEvent extends Base {
  event: "barge_in";
  callId: string;
  turnId: string;
}

export interface ModelToolCallEvent extends Base {
  event: "model.tool_call";
  callId: string;
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  requiresApproval: boolean;
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
  reason: string;
  postCallActions: PostCallAction[];
  transcript: TranscriptTurn[];
}

export interface ControlAckEvent extends Base {
  event: "ack";
  refEvent: string;
  ok: boolean;
  error: string | null;
}

export interface ControlErrorEvent extends Base {
  event: "error";
  message: string;
}

export interface UnknownEvent extends Base {
  event: string;
}

export type RealtimeEvent =
  | CallStartedEvent
  | CallAnsweredEvent
  | TranscriptEvent
  | BargeInEvent
  | ModelToolCallEvent
  | ConsultRequestedEvent
  | CallEndedEvent
  | ControlAckEvent
  | ControlErrorEvent
  | UnknownEvent;

function s(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function turns(v: unknown): TranscriptTurn[] {
  if (!Array.isArray(v)) return [];
  return v.map((t) => ({ speaker: s((t as any)?.speaker), text: s((t as any)?.text) }));
}

/** Decode one wire message into its typed observe event. */
export function parseEvent(d: Record<string, unknown>): RealtimeEvent {
  const raw = d;
  switch (d.event) {
    case "call.started":
      return {
        event: "call.started", raw, callId: s(d.call_id),
        agentIdentityId: s(d.agent_identity_id), phoneNumber: s(d.phone_number),
        direction: d.direction === "outbound" ? "outbound" : "inbound",
      };
    case "call.answered":
      return { event: "call.answered", raw, callId: s(d.call_id) };
    case "transcript":
      return {
        event: "transcript", raw, callId: s(d.call_id),
        party: d.party === "local" ? "local" : "remote", text: s(d.text),
        isFinal: Boolean(d.is_final), turnId: s(d.turn_id),
      };
    case "barge_in":
      return { event: "barge_in", raw, callId: s(d.call_id), turnId: s(d.turn_id) };
    case "model.tool_call":
      return {
        event: "model.tool_call", raw, callId: s(d.call_id),
        toolCallId: s(d.tool_call_id), toolName: s(d.tool_name),
        arguments: (d.arguments as Record<string, unknown>) ?? {},
        requiresApproval: Boolean(d.requires_approval),
      };
    case "consult.requested":
      return {
        event: "consult.requested", raw, callId: s(d.call_id),
        consultId: s(d.consult_id), query: s(d.query),
        transcriptTail: turns(d.transcript_tail),
      };
    case "call.ended":
      return {
        event: "call.ended", raw, callId: s(d.call_id), reason: s(d.reason),
        postCallActions: Array.isArray(d.post_call_actions)
          ? (d.post_call_actions as any[]).map((a) => ({
              action: s(a?.action), details: a?.details ?? null,
            }))
          : [],
        transcript: turns(d.transcript),
      };
    case "ack":
      return {
        event: "ack", raw, refEvent: s(d.ref_event), ok: Boolean(d.ok),
        error: d.error == null ? null : s(d.error),
      };
    case "error":
      return { event: "error", raw, message: s(d.message) };
    default:
      return { event: s(d.event), raw };
  }
}

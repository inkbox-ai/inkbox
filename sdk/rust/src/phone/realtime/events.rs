//! Typed observe events the platform emits on the call WebSocket when an
//! identity runs on platform-hosted voice.
//!
//! Field names match the wire JSON (snake_case); `event` is the serde tag.
//! These frames ride the one existing per-call WebSocket and each carries the
//! `call_id` it belongs to; only the outbound intervene frames omit it (that
//! socket is already scoped to one call — see [`super::intervene`]).

use serde::Deserialize;
use serde_json::Value;

/// One turn in a transcript tail / post-call transcript.
#[derive(Debug, Clone, Deserialize)]
pub struct TranscriptTurn {
    /// `"local"` (agent) or `"remote"` (caller) — matches the wire.
    pub party: String,
    pub text: String,
}

/// An action the agent registered during the call.
#[derive(Debug, Clone, Deserialize)]
pub struct PostCallAction {
    pub action: String,
    #[serde(default)]
    pub details: Value,
}

/// Server -> client observe events, discriminated on the `event` field.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "event")]
pub enum RealtimeEvent {
    #[serde(rename = "call.started")]
    CallStarted {
        call_id: String,
        agent_identity_id: String,
        /// `"inbound"` or `"outbound"`.
        direction: String,
        /// Absent on some inbound legs.
        #[serde(default)]
        phone_number: Option<String>,
    },
    #[serde(rename = "call.answered")]
    CallAnswered { call_id: String },
    #[serde(rename = "transcript")]
    Transcript {
        call_id: String,
        /// `"local"` (agent) or `"remote"` (caller).
        party: String,
        text: String,
        is_final: bool,
        #[serde(default)]
        turn_id: Option<String>,
    },
    #[serde(rename = "barge_in")]
    BargeIn {
        call_id: String,
        #[serde(default)]
        turn_id: Option<String>,
    },
    #[serde(rename = "consult.requested")]
    ConsultRequested {
        call_id: String,
        consult_id: String,
        query: String,
        #[serde(default)]
        transcript_tail: Vec<TranscriptTurn>,
    },
    #[serde(rename = "call.ended")]
    CallEnded {
        call_id: String,
        #[serde(default)]
        reason: Option<String>,
        #[serde(default)]
        post_call_actions: Vec<PostCallAction>,
        #[serde(default)]
        transcript: Vec<TranscriptTurn>,
    },
    /// An event whose `event` tag this SDK version does not model.
    #[serde(other)]
    Unknown,
}

/// Decode one wire message into its typed observe event.
pub fn parse_event(text: &str) -> serde_json::Result<RealtimeEvent> {
    serde_json::from_str(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_transcript_with_call_id() {
        let event = parse_event(
            r#"{"event":"transcript","call_id":"c1","party":"remote",
                "text":"hello","is_final":true,"turn_id":"t1"}"#,
        )
        .unwrap();
        match event {
            RealtimeEvent::Transcript {
                call_id,
                party,
                text,
                is_final,
                turn_id,
            } => {
                assert_eq!(call_id, "c1");
                assert_eq!(party, "remote");
                assert_eq!(text, "hello");
                assert!(is_final);
                assert_eq!(turn_id.as_deref(), Some("t1"));
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_call_started_with_optional_number() {
        let event = parse_event(
            r#"{"event":"call.started","call_id":"c1",
                "agent_identity_id":"id1","direction":"inbound"}"#,
        )
        .unwrap();
        match event {
            RealtimeEvent::CallStarted {
                agent_identity_id,
                direction,
                phone_number,
                ..
            } => {
                assert_eq!(agent_identity_id, "id1");
                assert_eq!(direction, "inbound");
                assert!(phone_number.is_none());
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_barge_in_fields() {
        // barge_in carries only call_id + optional turn_id on the hosted-call wire.
        let event = parse_event(r#"{"event":"barge_in","call_id":"c1","turn_id":null}"#).unwrap();
        match event {
            RealtimeEvent::BargeIn { call_id, turn_id } => {
                assert_eq!(call_id, "c1");
                assert!(turn_id.is_none());
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_consult_and_call_ended_nested() {
        let consult = parse_event(
            r#"{"event":"consult.requested","call_id":"c1","consult_id":"q1",
                "query":"refund?","transcript_tail":[{"party":"remote","text":"hi"}]}"#,
        )
        .unwrap();
        match consult {
            RealtimeEvent::ConsultRequested {
                call_id,
                transcript_tail,
                ..
            } => {
                assert_eq!(call_id, "c1");
                assert_eq!(transcript_tail[0].text, "hi");
            }
            other => panic!("unexpected: {other:?}"),
        }

        let ended = parse_event(
            r#"{"event":"call.ended","call_id":"c1","reason":"hangup",
                "post_call_actions":[{"action":"note","details":{"x":1}}],
                "transcript":[{"party":"local","text":"bye"}]}"#,
        )
        .unwrap();
        match ended {
            RealtimeEvent::CallEnded {
                call_id,
                reason,
                post_call_actions,
                transcript,
            } => {
                assert_eq!(call_id, "c1");
                assert_eq!(reason.as_deref(), Some("hangup"));
                assert_eq!(post_call_actions[0].action, "note");
                assert_eq!(transcript[0].text, "bye");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn unknown_event_tag_maps_to_unknown() {
        let event = parse_event(r#"{"event":"future.thing","x":1}"#).unwrap();
        assert!(matches!(event, RealtimeEvent::Unknown));
    }
}

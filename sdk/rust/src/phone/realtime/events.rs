//! Typed observe events emitted by the realtime control channel.
//!
//! Field names match the wire JSON (snake_case); `event` is the serde tag.

use serde::Deserialize;
use serde_json::Value;

/// One turn in a transcript tail / post-call transcript.
#[derive(Debug, Clone, Deserialize)]
pub struct TranscriptTurn {
    pub speaker: String,
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
        phone_number: String,
        /// `"inbound"` or `"outbound"`.
        direction: String,
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
        turn_id: String,
    },
    #[serde(rename = "barge_in")]
    BargeIn { call_id: String, turn_id: String },
    #[serde(rename = "model.tool_call")]
    ModelToolCall {
        call_id: String,
        tool_call_id: String,
        tool_name: String,
        #[serde(default)]
        arguments: Value,
        requires_approval: bool,
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
        reason: String,
        #[serde(default)]
        post_call_actions: Vec<PostCallAction>,
        #[serde(default)]
        transcript: Vec<TranscriptTurn>,
    },
    #[serde(rename = "ack")]
    Ack {
        #[serde(default)]
        ref_event: String,
        #[serde(default)]
        ok: bool,
        #[serde(default)]
        error: Option<String>,
    },
    #[serde(rename = "error")]
    Error {
        #[serde(default)]
        message: String,
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
    fn parses_transcript() {
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
                assert_eq!(turn_id, "t1");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_tool_call_with_arguments() {
        let event = parse_event(
            r#"{"event":"model.tool_call","call_id":"c1","tool_call_id":"tc1",
                "tool_name":"lookup","arguments":{"name":"Ada"},"requires_approval":true}"#,
        )
        .unwrap();
        match event {
            RealtimeEvent::ModelToolCall {
                requires_approval,
                arguments,
                ..
            } => {
                assert!(requires_approval);
                assert_eq!(arguments["name"], "Ada");
            }
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parses_consult_and_call_ended_nested() {
        let consult = parse_event(
            r#"{"event":"consult.requested","call_id":"c1","consult_id":"q1",
                "query":"refund?","transcript_tail":[{"speaker":"remote","text":"hi"}]}"#,
        )
        .unwrap();
        match consult {
            RealtimeEvent::ConsultRequested {
                transcript_tail, ..
            } => {
                assert_eq!(transcript_tail[0].text, "hi");
            }
            other => panic!("unexpected: {other:?}"),
        }

        let ended = parse_event(
            r#"{"event":"call.ended","call_id":"c1","reason":"hangup",
                "post_call_actions":[{"action":"note","details":{"x":1}}],
                "transcript":[{"speaker":"local","text":"bye"}]}"#,
        )
        .unwrap();
        match ended {
            RealtimeEvent::CallEnded {
                post_call_actions,
                transcript,
                ..
            } => {
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

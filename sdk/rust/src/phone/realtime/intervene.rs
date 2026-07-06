//! Builders for the intervene frames your main agent sends back on the call
//! WebSocket to steer a platform-hosted call.
//!
//! Each returns the exact wire JSON (`serde_json::Value`, ready to serialize
//! onto the socket). The socket is already scoped to one call, so none of
//! these carry a `call_id`.

use serde_json::{json, Value};

/// Resolve a `consult.requested` with an answer for the caller.
pub fn consult_answer(consult_id: &str, answer: &str, instructions: Option<&str>) -> Value {
    let mut command = json!({
        "event": "consult.answer",
        "consult_id": consult_id,
        "answer": answer,
    });
    if let Some(instructions) = instructions {
        command["instructions"] = json!(instructions);
    }
    command
}

/// Have the voice agent speak `text` on the call now.
pub fn say(text: &str) -> Value {
    json!({ "event": "inject", "mode": "say", "text": text })
}

/// Add hidden system context to the live session without speaking.
pub fn inject_context(text: &str) -> Value {
    json!({ "event": "inject", "mode": "context", "text": text })
}

/// Replace the live session instructions.
pub fn update_instructions(instructions: &str) -> Value {
    json!({ "event": "update_instructions", "instructions": instructions })
}

/// Force-end the call.
pub fn hang_up(reason: Option<&str>) -> Value {
    let mut command = json!({ "event": "hang_up" });
    if let Some(reason) = reason {
        command["reason"] = json!(reason);
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn consult_answer_includes_optional_instructions() {
        assert_eq!(
            consult_answer("q1", "yes", Some("warm")),
            json!({ "event": "consult.answer", "consult_id": "q1",
                    "answer": "yes", "instructions": "warm" })
        );
        assert_eq!(
            consult_answer("q1", "yes", None),
            json!({ "event": "consult.answer", "consult_id": "q1", "answer": "yes" })
        );
    }

    #[test]
    fn inject_shapes() {
        assert_eq!(
            say("hi"),
            json!({ "event": "inject", "mode": "say", "text": "hi" })
        );
        assert_eq!(
            inject_context("vip"),
            json!({ "event": "inject", "mode": "context", "text": "vip" })
        );
    }

    #[test]
    fn update_instructions_and_hang_up() {
        assert_eq!(
            update_instructions("Speak French"),
            json!({ "event": "update_instructions", "instructions": "Speak French" })
        );
        assert_eq!(
            hang_up(Some("resolved")),
            json!({ "event": "hang_up", "reason": "resolved" })
        );
        assert_eq!(hang_up(None), json!({ "event": "hang_up" }));
    }
}

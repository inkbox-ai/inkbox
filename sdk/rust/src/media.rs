//! Transcription results for incoming audio attachments.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionStatus {
    Pending,
    Completed,
    Failed,
    Skipped,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct MediaTranscription {
    pub status: TranscriptionStatus,
    pub text: Option<String>,
    pub error_code: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde::de::DeserializeOwned;
    use serde_json::{json, Value};
    fn check<T: DeserializeOwned + serde::Serialize>(raw: &Value) {
        let value: T = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(value).unwrap()["transcription"],
            raw["transcription"]
        );
    }
    #[test]
    fn media_transcription_compatibility() {
        for status in ["pending", "completed", "failed", "skipped"] {
            let mut raw = json!({"id": "00000000-0000-4000-8000-000000000001", "filename": "audio.m4a", "content_type": "audio/mp4", "size": 42, "url": "https://example.com/audio", "status": "ready", "transcription": {"status": status, "text": "", "error_code": null}});
            check::<crate::phone::types::TextMediaItem>(&raw);
            check::<crate::imessage::types::IMessageMediaItem>(&raw);
            check::<crate::whatsapp::WhatsAppMedia>(&raw);
            check::<crate::webhooks::types::TextMediaItemWire>(&raw);
            check::<crate::webhooks::types::IMessageMediaItemWire>(&raw);
            check::<crate::webhooks::types::WhatsAppWebhookMedia>(&raw);
            raw["transcription"] = Value::Null;
            check::<crate::whatsapp::WhatsAppMedia>(&raw);
            raw.as_object_mut().unwrap().remove("transcription");
            check::<crate::whatsapp::WhatsAppMedia>(&raw);
            raw.as_object_mut().unwrap().remove("id");
            check::<crate::phone::types::TextMediaItem>(&raw);
            check::<crate::imessage::types::IMessageMediaItem>(&raw);
        }
    }
    #[test]
    fn terminal_event_routes_to_the_original_message() {
        use crate::webhooks::{
            MessageTranscriptionFinishedWebhookPayload, TranscriptionFinishedSource,
        };
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
        for (channel, file, key) in [
            (
                "text",
                "webhook_payloads/text_received.json",
                "text_message",
            ),
            ("imessage", "imessage_sender_addresses.json", "message"),
            ("whatsapp", "whatsapp.json", "message"),
        ] {
            let fixture: Value =
                serde_json::from_str(&std::fs::read_to_string(root.join(file)).unwrap()).unwrap();
            let receipt = fixture.get("webhook").unwrap_or(&fixture);
            let mut event = receipt.clone();
            event["id"] = json!("evt_complete");
            event["event_type"] = json!("message.transcription_finished");
            event["data"]["channel"] = json!(channel);
            event["data"]["message_id"] = receipt["data"][key]["id"].clone();
            let parsed: MessageTranscriptionFinishedWebhookPayload =
                serde_json::from_value(event).unwrap();
            let (parsed_channel, original_id) = match parsed.data.source {
                TranscriptionFinishedSource::Text { text_message, .. } => ("text", text_message.id),
                TranscriptionFinishedSource::IMessage { message } => ("imessage", message.id),
                TranscriptionFinishedSource::WhatsApp { message } => ("whatsapp", message.id),
                TranscriptionFinishedSource::Slack(_) => unreachable!("not a Slack fixture"),
            };
            assert_eq!(parsed_channel, channel);
            assert_eq!(original_id, parsed.data.message_id);
        }
    }
    #[test]
    fn slack_terminal_event_carries_message_coordinates_and_file_results() {
        use crate::webhooks::{
            MessageTranscriptionFinishedWebhookPayload, SlackWebhookPayload,
            TranscriptionFinishedSource,
        };
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures");
        let fixtures: Vec<Value> = serde_json::from_str(
            &std::fs::read_to_string(root.join("slack_webhook_events.json")).unwrap(),
        )
        .unwrap();
        let message_id = "33333333-3333-4333-8333-333333333333";
        let mut received = fixtures[0].clone();
        received["data"]["message_id"] = json!(message_id);
        received["data"]["event"]["files"] =
            json!([{"id": "F123", "name": "clip.m4a", "transcription": {"status": "pending"}}]);
        let parsed: SlackWebhookPayload = serde_json::from_value(received.clone()).unwrap();
        assert_eq!(parsed.data.message_id.as_deref(), Some(message_id));
        assert_eq!(serde_json::to_value(&parsed).unwrap(), received);

        let mut event = received.clone();
        event["id"] = json!("evt_complete");
        event["event_type"] = json!("message.transcription_finished");
        event["data"]["channel"] = json!("slack");
        event["data"]["event"]["files"][0]["transcription"] =
            json!({"status": "completed", "text": "See you at noon", "error_code": null});
        let parsed: MessageTranscriptionFinishedWebhookPayload =
            serde_json::from_value(event.clone()).unwrap();
        assert_eq!(parsed.data.message_id, message_id);
        assert!(parsed.data.contacts.is_empty() && parsed.data.agent_identities.is_empty());
        let TranscriptionFinishedSource::Slack(data) = &parsed.data.source else {
            panic!("expected the Slack projection");
        };
        assert_eq!(data.connection_id, received["data"]["connection_id"]);
        assert_eq!(
            data.message_ts,
            received["data"]["message_ts"].as_str().map(String::from)
        );
        assert!(data.thread_ts.is_none() && data.message_id.is_none());
        assert_eq!(
            data.event["files"][0]["transcription"]["text"],
            json!("See you at noon")
        );
        let mut round_trip = serde_json::to_value(&parsed).unwrap();
        round_trip["data"]
            .as_object_mut()
            .unwrap()
            .remove("contacts");
        round_trip["data"]
            .as_object_mut()
            .unwrap()
            .remove("agent_identities");
        assert_eq!(round_trip, event);
    }
}

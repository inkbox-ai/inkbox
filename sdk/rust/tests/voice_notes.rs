//! Voice-note send options on iMessage, SMS/MMS, WhatsApp and Slack.

use httpmock::prelude::*;
use inkbox::{
    imessage::IMessageRecipients, phone::resources::texts::TextRecipients, Inkbox,
    SlackSendMessageOptions, TranscriptionStatus, WhatsAppSendOptions,
};
use serde_json::{json, Value};
use uuid::Uuid;

fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
    Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap()
}

fn audio(url: &str) -> Value {
    json!({
        "id": "44444444-4444-4444-4444-444444444444",
        "url": url,
        "content_type": "audio/mpeg",
        "size": 1024,
        "transcription": {"status": "completed", "text": "Hello there", "error_code": null}
    })
}

#[test]
fn imessage_voice_note_sends_flags_and_parses_audio_reply() {
    let server = MockServer::start();
    let conversation = Uuid::parse_str("33333333-3333-3333-3333-333333333333").unwrap();
    let identity = Uuid::new_v4();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/imessage/messages")
            .query_param("agent_identity_id", identity.to_string())
            .header("Idempotency-Key", "voice-1")
            .json_body(json!({
                "conversation_id": conversation.to_string(),
                "text": "Hello there",
                "send_as_voice_note": true,
                "fallback_to_text": false
            }));
        then.status(200).json_body(json!({"message": {
            "id": "22222222-2222-2222-2222-222222222222",
            "conversation_id": conversation,
            "assignment_id": null,
            "direction": "outbound",
            "remote_number": "+15550001111",
            "content": null,
            "media": [audio("https://media.example/voice.caf")],
            "message_type": "message",
            "service": "imessage",
            "is_read": false,
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z"
        }}));
    });
    let message = client(&server)
        .imessages()
        .send_voice_note(
            None,
            Some(&conversation),
            "Hello there",
            Some(&identity),
            Some("voice-1"),
            false,
        )
        .unwrap();
    send.assert();
    assert!(message.content.is_none());
    let media = message.media.unwrap();
    let transcription = media[0].transcription.as_ref().unwrap();
    assert_eq!(transcription.status, TranscriptionStatus::Completed);
    assert_eq!(transcription.text.as_deref(), Some("Hello there"));
}

#[test]
fn imessage_group_voice_note_sends_recipient_list() {
    let server = MockServer::start();
    let identity = Uuid::new_v4();
    let recipients = vec!["+15550001111".to_string(), "+15550002222".to_string()];
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/imessage/messages")
            .query_param("agent_identity_id", identity.to_string())
            .json_body(json!({
                "to": ["+15550001111", "+15550002222"],
                "text": "Hello there",
                "send_as_voice_note": true
            }));
        then.status(200).json_body(json!({"message": {
            "id": "22222222-2222-2222-2222-222222222222",
            "conversation_id": "33333333-3333-3333-3333-333333333333",
            "assignment_id": null,
            "direction": "outbound",
            "remote_number": null,
            "content": null,
            "media": [audio("https://media.example/voice.caf")],
            "message_type": "message",
            "service": "imessage",
            "is_read": false,
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z"
        }}));
    });
    let message = client(&server)
        .imessages()
        .send_voice_note(
            Some(IMessageRecipients::Group(&recipients)),
            None,
            "Hello there",
            Some(&identity),
            None,
            true,
        )
        .unwrap();
    send.assert();
    assert!(message.content.is_none());
    assert_eq!(message.media.unwrap().len(), 1);
}

#[test]
fn text_voice_note_omits_default_fallback() {
    let server = MockServer::start();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/phone/numbers/number/texts")
            .json_body(json!({
                "to": "+15550001111",
                "text": "Hello there",
                "send_as_voice_note": true
            }));
        then.status(200).json_body(json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "direction": "outbound",
            "local_phone_number": "+15550009999",
            "remote_phone_number": "+15550001111",
            "text": null,
            "type": "mms",
            "media": [audio("https://media.example/voice.mp3")],
            "is_read": false,
            "created_at": "2026-07-22T00:00:00Z",
            "updated_at": "2026-07-22T00:00:00Z",
            "delivery_status": "queued"
        }));
    });
    let message = client(&server)
        .texts()
        .send_voice_note(
            "number",
            Some(TextRecipients::One("+15550001111".into())),
            None,
            "Hello there",
            None,
            true,
        )
        .unwrap();
    send.assert();
    assert!(message.text.is_none());
    assert_eq!(message.media.unwrap().len(), 1);
}

#[test]
fn whatsapp_voice_note_options_are_sent_only_when_set() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp.json")).unwrap();
    let server = MockServer::start();
    let voice = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .header("Idempotency-Key", "voice-1")
            .json_body(json!({
                "to": "+15555550101",
                "text": "Hello",
                "send_as_voice_note": true,
                "fallback_to_text": false
            }));
        then.status(201).json_body(json!({"message": f["message"]}));
    });
    let plain = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .header("Idempotency-Key", "plain-1")
            .json_body(json!({"to": "+15555550101", "text": "Hello"}));
        then.status(201).json_body(json!({"message": f["message"]}));
    });
    let sdk = client(&server);
    sdk.whatsapp()
        .send(&WhatsAppSendOptions {
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            send_as_voice_note: Some(true),
            fallback_to_text: Some(false),
            idempotency_key: Some("voice-1".into()),
            ..Default::default()
        })
        .unwrap();
    sdk.whatsapp()
        .send(&WhatsAppSendOptions {
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            send_as_voice_note: Some(false),
            fallback_to_text: Some(true),
            idempotency_key: Some("plain-1".into()),
            ..Default::default()
        })
        .unwrap();
    voice.assert();
    plain.assert();
}

#[test]
fn slack_voice_note_reuses_message_options() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/slack.json")).unwrap();
    let c = Uuid::parse_str(f["connection"]["id"].as_str().unwrap()).unwrap();
    let server = MockServer::start();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path(format!("/api/v1/slack/connections/{c}/messages"))
            .header("Idempotency-Key", "voice:1")
            .json_body(json!({
                "conversation_id": "CEXAMPLE",
                "text": "Hello",
                "send_as_voice_note": true,
                "fallback_to_text": false
            }));
        then.status(200).json_body(f["action"].clone());
    });
    client(&server)
        .slack()
        .send_voice_note(
            c,
            &SlackSendMessageOptions {
                conversation_id: "CEXAMPLE".into(),
                text: "Hello".into(),
                idempotency_key: "voice:1".into(),
                thread_ts: None,
            },
            false,
        )
        .unwrap();
    send.assert();
}

use httpmock::prelude::*;
use inkbox::webhooks::WhatsAppWebhookPayload;
use inkbox::{
    Inkbox, WhatsAppDeliveryState, WhatsAppListOptions, WhatsAppMessageStatus, WhatsAppRecipients,
    WhatsAppSendOptions,
};
use serde_json::{json, Value};
use uuid::Uuid;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp.json")).unwrap()
}
#[test]
fn send_ownership_idempotency_and_uncertain_delivery_are_independent() {
    let f = fixture();
    let server = MockServer::start();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let media = Uuid::parse_str(f["media"]["id"].as_str().unwrap()).unwrap();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .query_param("agent_identity_id", owner.to_string())
            .header("Idempotency-Key", "logical-send")
            .json_body(json!({"to":["+15555550101"],"text":"Hello","media_ids":[media]}));
        then.status(201).json_body(json!({"message":f["message"]}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let message = client
        .whatsapp()
        .send(&WhatsAppSendOptions {
            to: Some(WhatsAppRecipients::Many(vec!["+15555550101".into()])),
            text: Some("Hello".into()),
            media_ids: Some(vec![media]),
            agent_identity_id: Some(owner),
            idempotency_key: Some("logical-send".into()),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(message.status, WhatsAppMessageStatus::Sent);
    assert_eq!(message.delivery_state, Some(WhatsAppDeliveryState::Unknown));
    assert!(message.failed_at.is_none());
    send.assert();
    let invalid = WhatsAppSendOptions {
        to: Some(WhatsAppRecipients::Many(vec![
            "+15555550101".into(),
            "+15555550102".into(),
        ])),
        text: Some("Hello".into()),
        ..Default::default()
    };
    assert!(client.whatsapp().send(&invalid).is_err());
}
#[test]
fn reads_media_and_local_mark_read_use_exact_owner_and_boundary() {
    let f = fixture();
    let server = MockServer::start();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let conv = Uuid::parse_str(f["conversation"]["id"].as_str().unwrap()).unwrap();
    let message = Uuid::parse_str(f["message"]["id"].as_str().unwrap()).unwrap();
    let media = Uuid::parse_str(f["media"]["id"].as_str().unwrap()).unwrap();
    let list = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/whatsapp/messages")
            .query_param("agent_identity_id", owner.to_string())
            .query_param("conversation_id", conv.to_string())
            .query_param("limit", "10")
            .query_param("offset", "4")
            .query_param("is_read", "false");
        then.status(200).json_body(json!([f["inbound_message"]]));
    });
    let get = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/whatsapp/messages/{message}"))
            .query_param("agent_identity_id", owner.to_string());
        then.status(200).json_body(f["message"].clone());
    });
    let conversations = server.mock(|when, then| {
        when.method(GET).path("/api/v1/whatsapp/conversations");
        then.status(200)
            .json_body(json!([f["conversation_summary"]]));
    });
    let conversation = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/whatsapp/conversations/{conv}"));
        then.status(200).json_body(f["conversation"].clone());
    });
    let upload = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/media")
            .query_param("agent_identity_id", owner.to_string())
            .body_contains("image.png");
        then.status(201).json_body(f["media"].clone());
    });
    let renew = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/whatsapp/media/{media}"))
            .query_param("agent_identity_id", owner.to_string());
        then.status(200).json_body(f["media"].clone());
    });
    let read = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/mark-read")
            .query_param("agent_identity_id", owner.to_string())
            .json_body(json!({"conversation_id":conv,"through_message_id":message}));
        then.status(200)
            .json_body(json!({"conversation_id":conv,"updated_count":2}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let r = client.whatsapp();
    assert!(r
        .list(&WhatsAppListOptions {
            agent_identity_id: Some(owner),
            conversation_id: Some(conv),
            limit: Some(10),
            offset: Some(4),
            is_read: Some(false),
            ..Default::default()
        })
        .unwrap()[0]
        .media[0]
        .url
        .is_none());
    assert_eq!(r.get(&message, Some(&owner)).unwrap().id, message);
    assert_eq!(
        r.list_conversations(&Default::default()).unwrap()[0].unread_count,
        2
    );
    assert!(!r.get_conversation(&conv, None).unwrap().is_group);
    assert_eq!(
        r.upload_media(
            b"png".to_vec(),
            "image.png",
            Some("image/png"),
            Some(&owner)
        )
        .unwrap()
        .id,
        media
    );
    assert!(r.get_media(&media, Some(&owner)).unwrap().url.is_some());
    assert_eq!(
        r.mark_read(&conv, &message, Some(&owner))
            .unwrap()
            .updated_count,
        2
    );
    for m in [list, get, conversations, conversation, upload, renew, read] {
        m.assert();
    }
}
#[test]
fn fresh_status_missing_on_older_api_is_none_and_webhooks_are_typed() {
    let f = fixture();
    let server = MockServer::start();
    let missing = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/agent/channel-status");
        then.status(200).json_body(json!({"imessage":{}}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    assert!(client
        .identities()
        .get_whatsapp_status("agent")
        .unwrap()
        .is_none());
    missing.assert();
    let payload: WhatsAppWebhookPayload = serde_json::from_value(f["webhook"].clone()).unwrap();
    assert!(payload.data.message.media[0].url.is_none());
    assert_eq!(payload.data.message.sender_number, "+15555550101");
}

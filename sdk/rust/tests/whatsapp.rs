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
            "+15555550101".into(),
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
    assert!(payload.data.message.as_ref().unwrap().media[0]
        .url
        .is_none());
    assert_eq!(
        payload.data.message.as_ref().unwrap().sender_number,
        "+15555550101"
    );
}

#[test]
fn effective_limits_retain_owned_future_policy_keys() {
    let f = fixture();
    let server = MockServer::start();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let get = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/whatsapp/limits")
            .query_param("agent_identity_id", owner.to_string());
        then.status(200).json_body(f["limits"].clone());
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = client.whatsapp().get_limits(Some(&owner)).unwrap();
    assert_eq!(result.agent_identity_id, owner);
    let public = serde_json::to_value(&result).unwrap();
    assert_eq!(public.as_object().unwrap().len(), 3);
    assert!(public.get("cycle_start").is_none());
    assert_eq!(
        result.limits["whatsapp.texts_per_agent_identity_per_24h"],
        1000
    );
    assert_eq!(result.limits["whatsapp.pre_reply_messages"], 3);
    assert_eq!(result.limits["whatsapp.pre_reply_max_text_length"], 159);
    assert_eq!(
        result.limits["whatsapp.outbound_new_contact_min_interval_seconds"],
        60
    );
    assert_eq!(result.limits["whatsapp.future_limit"], 7);
    assert_eq!(result.usage["whatsapp.texts_per_agent_identity_per_24h"], 2);
    assert_eq!(result.usage.len(), 1);
    get.assert();
}

#[test]
fn v2_shared_send_vectors_and_legacy_quotes_are_preserved() {
    let data: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-v2.json")).unwrap();
    let server = MockServer::start();
    let send = server.mock(|when, then| {
        when.method(POST).path("/api/v1/whatsapp/messages");
        then.status(201)
            .json_body(json!({"message":data["message"]}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mut valid = 0;
    for case in data["send_cases"].as_array().unwrap() {
        let body = &case["body"];
        let options = WhatsAppSendOptions {
            to: body
                .get("to")
                .map(|to| serde_json::from_value(to.clone()).unwrap()),
            conversation_id: body["conversation_id"]
                .as_str()
                .map(|value| Uuid::parse_str(value).unwrap()),
            reply_to_message_id: body["reply_to_message_id"]
                .as_str()
                .map(|value| Uuid::parse_str(value).unwrap()),
            group_name: body["group_name"].as_str().map(String::from),
            text: body["text"].as_str().map(String::from),
            idempotency_key: Some(case["name"].as_str().unwrap().into()),
            ..Default::default()
        };
        if case["valid"].as_bool().unwrap() {
            assert!(client.whatsapp().send(&options).is_ok());
            valid += 1;
        } else {
            assert!(matches!(
                client.whatsapp().send(&options),
                Err(inkbox::InkboxError::InvalidArgument(_))
            ));
        }
    }
    send.assert_hits(valid);
    let legacy: inkbox::WhatsAppMessage =
        serde_json::from_value(fixture()["message"].clone()).unwrap();
    assert!(legacy.reply_to_message_id.is_none() && legacy.reactions.is_empty());
    let group: inkbox::WhatsAppConversation =
        serde_json::from_value(data["conversation"].clone()).unwrap();
    assert_eq!(
        group.group_creation_status,
        Some(inkbox::WhatsAppGroupCreationStatus::Uncertain)
    );
}

#[test]
fn v2_threads_and_reaction_receipts_preserve_keys_and_unknown_actors() {
    let data: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-v2.json")).unwrap();
    let server = MockServer::start();
    let id = Uuid::parse_str(data["message"]["id"].as_str().unwrap()).unwrap();
    let rid = Uuid::parse_str(data["reaction"]["id"].as_str().unwrap()).unwrap();
    let conversation =
        Uuid::parse_str(data["thread"]["conversation_id"].as_str().unwrap()).unwrap();
    let thread = Uuid::parse_str(data["thread"]["thread_id"].as_str().unwrap()).unwrap();
    let thread_mock = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/whatsapp/messages/{id}/thread"))
            .query_param("cursor", "opaque+/cursor=");
        then.json_body(data["thread"].clone());
    });
    let conversation_mock = server.mock(|when, then| {
        when.method(GET).path(format!(
            "/api/v1/whatsapp/conversations/{conversation}/threads/{thread}"
        ));
        then.json_body(data["thread"].clone());
    });
    let mut uncertain = data["uncertain_reaction"].clone();
    uncertain["remote_number"] = Value::Null;
    let react = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/reactions")
            .header("Idempotency-Key", "reaction-original")
            .json_body(json!({"message_id":id,"custom_emoji":"👨‍👩‍👧‍👦"}));
        then.status(201).json_body(json!({"reaction":uncertain}));
    });
    let remove = server.mock(|when, then| {
        when.method(DELETE)
            .path(format!("/api/v1/whatsapp/reactions/{rid}"))
            .header("Idempotency-Key", "remove-original");
        then.json_body(json!({"reaction":data["removed_reaction"]}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let options = inkbox::WhatsAppThreadOptions {
        limit: Some(1),
        cursor: Some("opaque+/cursor=".into()),
        ..Default::default()
    };
    assert_eq!(
        client
            .whatsapp()
            .get_thread(&id, &options)
            .unwrap()
            .messages
            .len(),
        2
    );
    assert_eq!(
        client
            .whatsapp()
            .get_conversation_thread(&conversation, &thread, &options)
            .unwrap()
            .next_cursor,
        Some("opaque+/cursor=".into())
    );
    let reaction = client
        .whatsapp()
        .send_reaction(&inkbox::WhatsAppReactionOptions {
            message_id: id,
            custom_emoji: Some("👨‍👩‍👧‍👦".into()),
            idempotency_key: "reaction-original".into(),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(reaction.status, inkbox::WhatsAppReactionStatus::Uncertain);
    assert!(reaction.remote_number.is_none());
    assert_eq!(
        client
            .whatsapp()
            .remove_reaction(&rid, "remove-original", None)
            .unwrap()
            .status,
        inkbox::WhatsAppReactionStatus::Removed
    );
    thread_mock.assert();
    conversation_mock.assert();
    react.assert();
    remove.assert();
}

#[test]
fn whatsapp_correspondence_omitted_and_null_options_deserialize_without_source_changes() {
    let mut wire = json!({"channel":"whatsapp", "source_id":"30000000-0000-4000-8000-000000000003",
        "direction":"inbound", "occurred_at":"2026-10-01T12:00:00Z", "identity_id":"10000000-0000-4000-8000-000000000001",
        "conversation_id":"20000000-0000-4000-8000-000000000002", "local_number":"+15555550100", "participants":["+15555550101"], "is_group":false});
    for explicit_null in [false, true] {
        if explicit_null {
            for name in ["remote_number", "text", "media"] {
                wire[name] = Value::Null;
            }
        }
        let item: inkbox::contacts::CorrespondenceItem =
            serde_json::from_value(wire.clone()).unwrap();
        match item {
            inkbox::contacts::CorrespondenceItem::WhatsApp(item) => {
                assert!(item.remote_number.is_none());
                assert!(item.text.is_none());
                assert!(item.media.is_none());
            }
            _ => panic!("wrong correspondence channel"),
        }
    }
}

#[test]
fn reaction_notification_preserves_unknown_actor_and_original_target_message() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-v2.json")).unwrap();
    let event: WhatsAppWebhookPayload =
        serde_json::from_value(f["reaction_webhook"].clone()).unwrap();
    let target = event.data.message.as_ref().unwrap();
    assert_eq!(target.id.to_string(), f["message"]["id"].as_str().unwrap());
    assert_eq!(target.direction, inkbox::WhatsAppDirection::Outbound);
    let reaction = event.data.reaction.unwrap();
    assert!(reaction.remote_number.is_none());
    assert_eq!(
        reaction.target_message_id.to_string(),
        f["message"]["id"].as_str().unwrap()
    );
}

#[test]
fn documented_identity_bound_rust_send_selects_the_agent_for_organization_keys() {
    let f = fixture();
    let server = MockServer::start();
    let owner = f["identity_id"].as_str().unwrap();
    let identity_get = server.mock(|when,then| { when.method(GET).path("/api/v1/identities/my-agent");
        then.status(200).json_body(json!({"id":owner,"organization_id":"org_example","agent_handle":"my-agent","created_at":"2026-10-01T12:00:00Z","updated_at":"2026-10-01T12:00:00Z"})); });
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .query_param("agent_identity_id", owner);
        then.status(201).json_body(json!({"message":f["message"]}));
    });
    let client = Inkbox::builder("organization-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = client.get_identity("my-agent").unwrap();
    identity
        .send_whatsapp(&WhatsAppSendOptions {
            to: Some(WhatsAppRecipients::One("+15555550101".into())),
            text: Some("Hello".into()),
            idempotency_key: Some("order-confirmation-123".into()),
            ..Default::default()
        })
        .unwrap();
    identity_get.assert();
    send.assert();
}

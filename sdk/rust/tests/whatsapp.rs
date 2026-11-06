use httpmock::prelude::*;
use inkbox::webhooks::WhatsAppWebhookPayload;
use inkbox::{
    Inkbox, WhatsAppDeliveryState, WhatsAppListOptions, WhatsAppMessageStatus, WhatsAppSendOptions,
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
            .json_body(json!({"to":"+15555550101","text":"Hello","media_ids":[media]}));
        then.status(201).json_body(json!({"message":f["message"]}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let message = client
        .whatsapp()
        .send(&WhatsAppSendOptions {
            to: Some("+15555550101".into()),
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
        to: Some("+15555550101,+15555550101".into()),
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
    assert_eq!(
        r.get_conversation(&conv, None).unwrap().participants.len(),
        1
    );
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
        payload
            .data
            .message
            .as_ref()
            .unwrap()
            .sender_number
            .as_deref(),
        Some("+15555550101")
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
        if body["to"].is_array() {
            assert!(!case["valid"].as_bool().unwrap());
            assert!(serde_json::from_value::<String>(body["to"].clone()).is_err());
            continue;
        }
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
    let conversation: inkbox::WhatsAppConversation =
        serde_json::from_value(data["conversation"].clone()).unwrap();
    assert_eq!(conversation.participants.len(), 1);
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
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            idempotency_key: Some("order-confirmation-123".into()),
            ..Default::default()
        })
        .unwrap();
    identity_get.assert();
    send.assert();
}

#[test]
fn list_direct_message_date_filters() {
    let server = MockServer::start();
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    for path in ["messages", "conversations"] {
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/whatsapp/{path}"))
                .query_param("start_datetime", "2026-03-08")
                .query_param("end_datetime", "2026-03-08")
                .query_param("tz", "America/New_York");
            then.status(200).json_body(json!([]));
        });
        let options = WhatsAppListOptions {
            start_datetime: Some("2026-03-08".into()),
            end_datetime: Some("2026-03-08".into()),
            tz: Some("America/New_York".into()),
            ..Default::default()
        };
        if path == "messages" {
            client.whatsapp().list(&options).unwrap();
        } else {
            client.whatsapp().list_conversations(&options).unwrap();
        }
        mock.assert();
    }
}

#[test]
fn reply_fallback_wire_preserves_legacy_default() {
    let f = fixture();
    let conversation = Uuid::parse_str(f["conversation"]["id"].as_str().unwrap()).unwrap();
    let message = Uuid::parse_str(f["message"]["id"].as_str().unwrap()).unwrap();
    for quoted in [false, true] {
        for fallback in [false, true] {
            let server = MockServer::start();
            let mut expected = json!({"conversation_id":conversation,"text":"Reply"});
            if quoted {
                expected["reply_to_message_id"] = json!(message);
            }
            if quoted && !fallback {
                expected["plain_reply_fallback"] = json!(false);
            }
            let mock = server.mock(|when, then| {
                when.method(POST)
                    .path("/api/v1/whatsapp/messages")
                    .header("Idempotency-Key", "same-operation")
                    .json_body(expected);
                then.status(201).json_body(json!({"message":f["message"]}));
            });
            let client = Inkbox::builder("test-only")
                .base_url(server.base_url())
                .build()
                .unwrap();
            client
                .whatsapp()
                .send(&WhatsAppSendOptions {
                    conversation_id: Some(conversation),
                    reply_to_message_id: if quoted { Some(message) } else { None },
                    plain_reply_fallback: Some(fallback),
                    text: Some("Reply".into()),
                    idempotency_key: Some("same-operation".into()),
                    ..Default::default()
                })
                .unwrap();
            mock.assert();
        }
    }
}

#[test]
fn failed_send_exposes_generated_key_after_lost_responses() {
    use std::io::Read;
    use std::net::TcpListener;
    use std::time::Duration;

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let address = listener.local_addr().unwrap();
    let receiver = std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + Duration::from_secs(10);
        let mut requests = Vec::new();
        while requests.len() < 3 {
            let (mut socket, _) = match listener.accept() {
                Ok(connection) => connection,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(std::time::Instant::now() < deadline, "missing retry");
                    std::thread::sleep(Duration::from_millis(5));
                    continue;
                }
                Err(error) => panic!("{error}"),
            };
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0; 4096];
            loop {
                let read = socket.read(&mut chunk).unwrap();
                assert_ne!(read, 0);
                bytes.extend_from_slice(&chunk[..read]);
                if let Some(end) = bytes.windows(4).position(|v| v == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length: ")
                                .map(|v| v.parse().unwrap())
                        })
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            // The request was received, but no acknowledgement reaches the caller.
            drop(socket);
        }
        requests
    });
    let client = Inkbox::builder("test-only")
        .base_url(format!("http://{address}"))
        .timeout_secs(2.0)
        .build()
        .unwrap();
    let error = client
        .whatsapp()
        .send(&WhatsAppSendOptions {
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            ..Default::default()
        })
        .unwrap_err();
    let key = error.idempotency_key().unwrap();
    assert!(Uuid::parse_str(key).is_ok());
    assert!(matches!(
        error.original_error(),
        inkbox::InkboxError::Transport(_)
    ));
    assert!(std::error::Error::source(&error).is_some());
    let requests = receiver.join().unwrap();
    assert_eq!(requests.len(), 3);
    for request in &requests {
        assert!(request
            .to_lowercase()
            .contains(&format!("idempotency-key: {key}\r\n")));
        assert!(request.ends_with(r#"{"to":"+15555550101","text":"Hello"}"#));
    }
}

#[test]
fn failed_send_retains_key_for_json_and_typed_response_decoding() {
    for response in ["{interrupted", r#"{"message":{}}"#] {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST).path("/api/v1/whatsapp/messages");
            then.status(201).body(response);
        });
        let client = Inkbox::builder("test-only")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let options = WhatsAppSendOptions {
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            ..Default::default()
        };
        let error = client.whatsapp().send(&options).unwrap_err();
        let key = error.idempotency_key().unwrap();
        assert!(Uuid::parse_str(key).is_ok());
        assert!(matches!(
            error.original_error(),
            inkbox::InkboxError::Decode(_)
        ));
        request.assert_hits(if response == "{interrupted" { 3 } else { 1 });
    }
}

#[test]
fn failed_send_preserves_explicit_key_and_api_metadata() {
    let server = MockServer::start();
    let request = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .header("Idempotency-Key", "logical-send");
        then.status(429).header("Retry-After", "60").json_body(
            json!({"detail":{"error":"rate_limited"},"agent_support":"Contact support."}),
        );
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mut options = WhatsAppSendOptions {
        to: Some("+15555550101".into()),
        text: Some("Hello".into()),
        idempotency_key: Some("logical-send".into()),
        ..Default::default()
    };
    let error = client.whatsapp().send(&options).unwrap_err();
    assert_eq!(error.idempotency_key(), Some("logical-send"));
    assert_eq!(error.retry_after_seconds(), Some(60));
    assert_eq!(error.agent_support(), Some("Contact support."));
    assert!(matches!(
        error.original_error(),
        inkbox::InkboxError::Api {
            status_code: 429,
            ..
        }
    ));
    assert_eq!(error.to_string(), error.original_error().to_string());
    request.assert_hits(1);
    options.idempotency_key = Some("".into());
    let error = client.whatsapp().send(&options).unwrap_err();
    assert!(matches!(error, inkbox::InkboxError::InvalidArgument(_)));
    assert_eq!(error.idempotency_key(), None);
    request.assert_hits(1);
}

#[test]
fn identity_lists_retain_configured_whatsapp_and_default_older_responses() {
    for configured in [Some(true), Some(false), None] {
        let server = MockServer::start();
        let mut identity = json!({
            "id": Uuid::nil(), "organization_id": "org_example",
            "agent_handle": "example", "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z", "whatsapp_enabled": false
        });
        if let Some(value) = configured {
            identity["whatsapp_configured"] = json!(value);
        }
        let list = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/");
            then.status(200).json_body(json!([identity]));
        });
        let client = Inkbox::builder("test-only")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let summaries = client.identities().list().unwrap();
        assert_eq!(
            serde_json::to_value(&summaries[0]).unwrap()["whatsapp_configured"],
            json!(configured.unwrap_or(false))
        );
        list.assert();
    }
}

#[test]
fn group_metadata_and_quoted_animation_preserve_stable_ids() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-groups.json")).unwrap();
    let message: inkbox::WhatsAppMessage = serde_json::from_value(f["message"].clone()).unwrap();
    let conversation: inkbox::WhatsAppConversation =
        serde_json::from_value(f["conversation"].clone()).unwrap();
    assert!(message.is_group && conversation.is_group);
    assert_eq!(conversation.group_name.as_deref(), Some("Project garden"));
    assert!(message.remote_number.is_none() && message.recipients.is_empty());
    assert_eq!(
        message.sender_number.as_deref(),
        Some(message.local_number.as_str())
    );
    assert_eq!(message.unresolved_participant_count, 0);
    let blocked: inkbox::WhatsAppMessage =
        serde_json::from_value(f["blocked_inbound_message"].clone()).unwrap();
    assert_eq!(blocked.direction, inkbox::WhatsAppDirection::Inbound);
    assert!(blocked.is_blocked && blocked.sender_number.is_none());
    assert_eq!(blocked.unresolved_participant_count, 1);
    let direct: inkbox::WhatsAppMessage =
        serde_json::from_value(fixture()["message"].clone()).unwrap();
    assert!(!direct.is_group && direct.group_name.is_none());
    assert_eq!(direct.unresolved_participant_count, 0);
    let webhook: inkbox::webhooks::WhatsAppWebhookMessage =
        serde_json::from_value(f["message"].clone()).unwrap();
    assert!(webhook.is_group);
    assert_eq!(
        webhook.sender_number.as_deref(),
        Some(message.local_number.as_str())
    );
    let server = MockServer::start();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .header("Idempotency-Key", "group-quote")
            .json_body(f["send"].clone());
        then.status(201).json_body(json!({"message": f["message"]}));
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let options = WhatsAppSendOptions {
        conversation_id: Some(conversation.id),
        reply_to_message_id: Some(message.id),
        media_ids: Some(vec![Uuid::parse_str(
            f["send"]["media_ids"][0].as_str().unwrap(),
        )
        .unwrap()]),
        gif_playback: Some(true),
        text: Some("Here is the animation".into()),
        idempotency_key: Some("group-quote".into()),
        ..Default::default()
    };
    assert!(client.whatsapp().send(&options).unwrap().is_group);
    send.assert();
    let unexpected = server.mock(|when, then| {
        when.method(POST).path("/api/v1/whatsapp/messages");
        then.status(500);
    });
    let no_media = WhatsAppSendOptions {
        media_ids: None,
        ..options
    };
    assert!(matches!(
        client.whatsapp().send(&no_media),
        Err(inkbox::InkboxError::InvalidArgument(_))
    ));
    unexpected.assert_hits(0);
    send.assert_hits(1);
}

#[test]
fn native_agent_mention_is_typed_and_defaults_false() {
    let group: serde_json::Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-groups.json")).unwrap();
    let mut payload = group["message"].clone();
    let legacy: inkbox::whatsapp::WhatsAppMessage =
        serde_json::from_value(payload.clone()).unwrap();
    assert!(!legacy.agent_mentioned);
    payload["agent_mentioned"] = serde_json::json!(true);
    let message: inkbox::whatsapp::WhatsAppMessage =
        serde_json::from_value(payload.clone()).unwrap();
    assert!(message.agent_mentioned);
    let webhook: inkbox::webhooks::WhatsAppWebhookMessage =
        serde_json::from_value(payload.clone()).unwrap();
    assert!(webhook.agent_mentioned);
    payload["agent_mentioned"] = serde_json::json!("true");
    assert!(serde_json::from_value::<inkbox::whatsapp::WhatsAppMessage>(payload).is_err());
}

#[test]
fn structured_mentions_preserve_unknown_phone_numbers() {
    let group: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-groups.json")).unwrap();
    let mut payload = group["message"].clone();
    let legacy: inkbox::WhatsAppMessage = serde_json::from_value(payload.clone()).unwrap();
    assert!(legacy.mentions.is_empty());
    payload["mentions"] = json!([{"text":"@123456789","phone_number":null,"is_agent":false},
        {"text":"@15550000002","phone_number":"+15550000002","is_agent":true}]);
    let parsed: inkbox::WhatsAppMessage = serde_json::from_value(payload.clone()).unwrap();
    assert_eq!(parsed.mentions[0].text.as_deref(), Some("@123456789"));
    assert!(parsed.mentions[0].phone_number.is_none() && !parsed.mentions[0].is_agent);
    assert!(parsed.mentions[1].is_agent);
    let webhook: inkbox::webhooks::WhatsAppWebhookMessage =
        serde_json::from_value(payload).unwrap();
    assert_eq!(webhook.mentions.len(), 2);
}

#[test]
fn whatsapp_sender_access_preserves_receipt_admission() {
    let mut message = fixture()["message"].clone();
    for access in ["direct", "sponsored"] {
        message["sender_access"] = json!(access);
        let parsed: inkbox::WhatsAppMessage = serde_json::from_value(message.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(parsed.sender_access).unwrap(),
            json!(access)
        );
    }
    message.as_object_mut().unwrap().remove("sender_access");
    let parsed: inkbox::WhatsAppMessage = serde_json::from_value(message).unwrap();
    assert!(parsed.sender_access.is_none());
}

#[test]
fn onboarding_preserves_ownership_and_availability_without_sending() {
    let base: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/whatsapp-onboarding.json"
    ))
    .unwrap();
    let owner = Uuid::parse_str(base["agent_identity_id"].as_str().unwrap()).unwrap();
    for state in ["ready", "unavailable", "disabled"] {
        for identity in [None, Some(&owner)] {
            let server = MockServer::start();
            let mut raw = base.clone();
            raw["ready"] = json!(state == "ready");
            if state == "disabled" {
                raw["number"] = Value::Null;
                raw["message_link"] = Value::Null;
                raw["message_qr_png_data_url"] = Value::Null;
            }
            let get = server.mock(|when, then| {
                let when = when.method(GET).path("/api/v1/whatsapp/onboarding");
                if let Some(id) = identity {
                    when.query_param("agent_identity_id", id.to_string());
                } else {
                    when.matches(|request| match &request.query_params {
                        None => true,
                        Some(query) => query.is_empty(),
                    });
                }
                then.status(200).json_body(raw.clone());
            });
            let client = Inkbox::builder("test-only")
                .base_url(server.base_url())
                .build()
                .unwrap();
            let result: inkbox::WhatsAppOnboarding =
                client.whatsapp().get_onboarding(identity).unwrap();
            assert_eq!(serde_json::to_value(result).unwrap(), raw);
            get.assert();
        }
    }
}

#[test]
fn identity_onboarding_reads_its_own_fresh_details() {
    let raw: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/whatsapp-onboarding.json"
    ))
    .unwrap();
    let owner = raw["agent_identity_id"].as_str().unwrap();
    let server = MockServer::start();
    let identity_get = server.mock(|when, then| {
        when.method(GET).path("/api/v1/identities/my-agent");
        then.status(200).json_body(json!({"id":owner,"organization_id":"org_example","agent_handle":"my-agent","created_at":"2026-10-01T12:00:00Z","updated_at":"2026-10-01T12:00:00Z"}));
    });
    let onboarding = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/whatsapp/onboarding")
            .query_param("agent_identity_id", owner);
        then.status(200).json_body(raw.clone());
    });
    let client = Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = client
        .get_identity("my-agent")
        .unwrap()
        .get_whatsapp_onboarding()
        .unwrap();
    assert_eq!(serde_json::to_value(result).unwrap(), raw);
    identity_get.assert();
    onboarding.assert();
}

#[test]
fn whatsapp_null_sender_access_decodes_outbound_rest_and_webhooks() {
    let mut message = fixture()["message"].clone();
    message["direction"] = json!("outbound");
    message["sender_access"] = Value::Null;
    let parsed: inkbox::WhatsAppMessage = serde_json::from_value(message.clone()).unwrap();
    assert!(parsed.sender_access.is_none());
    for event in [
        "whatsapp.sent",
        "whatsapp.delivered",
        "whatsapp.delivery_failed",
    ] {
        let mut payload = fixture()["webhook"].clone();
        payload["event_type"] = json!(event);
        payload["data"]["message"] = message.clone();
        let parsed: WhatsAppWebhookPayload = serde_json::from_value(payload).unwrap();
        assert!(parsed.data.message.unwrap().sender_access.is_none());
    }
    message["sender_access"] = json!("unrecognized");
    assert!(serde_json::from_value::<inkbox::WhatsAppMessage>(message.clone()).is_err());
    assert!(serde_json::from_value::<inkbox::webhooks::WhatsAppWebhookMessage>(message).is_err());
}

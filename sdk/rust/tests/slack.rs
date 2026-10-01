use httpmock::prelude::*;
use httpmock::Method::PATCH;
use inkbox::{
    Inkbox, SlackActionStatus, SlackMessagesOptions, SlackPageOptions, SlackSendMessageOptions,
    SlackWebhookPayload,
};
use serde_json::{json, Value};
use uuid::Uuid;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/slack.json")).unwrap()
}
fn id(s: &str) -> Uuid {
    Uuid::parse_str(s).unwrap()
}

#[test]
fn all_operations_and_binary_download_match_the_wire() {
    let server = MockServer::start();
    let f = fixture();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let c = id(f["connection"]["id"].as_str().unwrap());
    let identity = id(f["connection"]["identity_id"].as_str().unwrap());
    let base = format!("/api/v1/slack/connections/{c}");
    let list = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/connections")
            .query_param("identity_id", identity.to_string());
        then.status(200)
            .json_body(json!({"connections":[f["connection"]],"installation_available":false}));
    });
    let response = client.slack().list_connections(identity).unwrap();
    assert!(!response.installation_available);
    assert_eq!(response.connections[0].id, c);
    list.assert();
    let save = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/slack/provisioning-workspaces")
            .json_body(
                json!({"access_token":"synthetic-access","refresh_token":"synthetic-refresh"}),
            );
        then.status(200)
            .json_body(f["provisioning_workspace"].clone());
    });
    let workspace = client
        .slack()
        .save_provisioning_workspace("synthetic-access", "synthetic-refresh")
        .unwrap();
    assert_eq!(
        workspace.id,
        id(f["provisioning_workspace"]["id"].as_str().unwrap())
    );
    save.assert();
    let saved = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/provisioning-workspaces");
        then.status(200)
            .json_body(json!({"workspaces": [f["provisioning_workspace"]]}));
    });
    assert_eq!(
        client.slack().list_provisioning_workspaces().unwrap()[0].id,
        workspace.id
    );
    saved.assert();
    let disconnect = server.mock(|when, then| {
        when.method(POST).path(format!("{base}/disconnect"));
        then.status(200).json_body(f["connection"].clone());
    });
    client.slack().disconnect(c).unwrap();
    disconnect.assert();
    let conversations = server.mock(|when, then| {
        when.method(GET)
            .path(format!("{base}/conversations"))
            .query_param("limit", "2")
            .query_param("cursor", "cur");
        then.status(200)
            .json_body(json!({"conversations":[{"id":"CEXAMPLE"}],"next_cursor":"next"}));
    });
    assert_eq!(
        client
            .slack()
            .list_conversations(
                c,
                &SlackPageOptions {
                    limit: Some(2),
                    cursor: Some("cur".into())
                }
            )
            .unwrap()
            .next_cursor
            .as_deref(),
        Some("next")
    );
    conversations.assert();
    let open = server.mock(|when, then| {
        when.method(POST)
            .path(format!("{base}/conversations"))
            .json_body(json!({"user_ids":["UALICE","UBOB"]}));
        then.status(200).json_body(json!({"id":"DEXAMPLE"}));
    });
    client
        .slack()
        .open_conversation(c, &["UALICE".into(), "UBOB".into()])
        .unwrap();
    open.assert();
    let conversation = server.mock(|when, then| {
        when.method(GET)
            .path(format!("{base}/conversations/CEXAMPLE"));
        then.status(200).json_body(json!({"id":"CEXAMPLE"}));
    });
    client.slack().get_conversation(c, "CEXAMPLE").unwrap();
    conversation.assert();
    let messages = server.mock(|when, then| {
        when.method(GET)
            .path(format!("{base}/conversations/CEXAMPLE/messages"))
            .query_param("limit", "15")
            .query_param("thread_ts", "1780000000.000001");
        then.status(200).json_body(
            json!({"messages":[{"ts":"1780000000.000001"}],"next_cursor":null,"has_more":false}),
        );
    });
    assert_eq!(
        client
            .slack()
            .list_messages(
                c,
                "CEXAMPLE",
                &SlackMessagesOptions {
                    thread_ts: Some("1780000000.000001".into()),
                    ..Default::default()
                }
            )
            .unwrap()
            .next_cursor,
        None
    );
    messages.assert();
    let send=server.mock(|when,then| { when.method(POST).path(format!("{base}/messages")).header("Idempotency-Key","operation:1").json_body(json!({"conversation_id":"CEXAMPLE","text":"Hello","thread_ts":"1780000000.000001"})); then.status(200).json_body(f["action"].clone()); });
    let action = client
        .slack()
        .send_message(
            c,
            &SlackSendMessageOptions {
                conversation_id: "CEXAMPLE".into(),
                text: "Hello".into(),
                idempotency_key: "operation:1".into(),
                thread_ts: Some("1780000000.000001".into()),
            },
        )
        .unwrap();
    assert_eq!(action.status, SlackActionStatus::Unknown);
    assert_eq!(action.retry_after, None);
    send.assert_hits(1);
    let get_action = server.mock(|when, then| {
        when.method(GET)
            .path(format!("{base}/actions/{}", action.id));
        then.status(200).json_body(f["action"].clone());
    });
    client.slack().get_action(c, action.id).unwrap();
    get_action.assert();
    let file = server.mock(|when, then| {
        when.method(GET).path(format!("{base}/files/FEXAMPLE"));
        then.status(200).json_body(f["file"].clone());
    });
    assert!(client.slack().get_file(c, "FEXAMPLE").unwrap().downloadable);
    file.assert();
    let bytes = server.mock(|when, then| {
        when.method(GET)
            .path(format!("{base}/files/FEXAMPLE/content"))
            .header("accept", "application/octet-stream");
        then.status(200).body([0, 255, 128, 1]);
    });
    assert_eq!(
        client.slack().download_file(c, "FEXAMPLE").unwrap(),
        vec![0, 255, 128, 1]
    );
    bytes.assert();
}

#[test]
fn send_rate_limit_hint_and_read_only_key_recovery() {
    let server = MockServer::start();
    let f = fixture();
    let c = id(f["connection"]["id"].as_str().unwrap());
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mut failed = f["action"].clone();
    failed["status"] = json!("failed");
    failed["error_code"] = json!("rate_limited");
    for delay in [Some(73), Some(0), None] {
        let mut response = failed.clone();
        response["retry_after"] = json!(delay);
        let mut send = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/slack/connections/{c}/messages"))
                .header("Idempotency-Key", "original:1");
            then.status(200).json_body(response);
        });
        let action = client
            .slack()
            .send_message(
                c,
                &SlackSendMessageOptions {
                    conversation_id: "CEXAMPLE".into(),
                    text: "Hello".into(),
                    idempotency_key: "original:1".into(),
                    thread_ts: None,
                },
            )
            .unwrap();
        assert_eq!(action.status, SlackActionStatus::Failed);
        assert_eq!(action.retry_after, delay);
        send.assert_hits(1);
        send.delete();
    }
    let mut lookup = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/slack/connections/{c}/actions/by-key"))
            .header("Idempotency-Key", "original:1");
        then.status(200).json_body(failed.clone());
    });
    let recovered = client.slack().get_action_by_key(c, "original:1").unwrap();
    assert_eq!(recovered.id, id(failed["id"].as_str().unwrap()));
    assert_eq!(recovered.retry_after, None);
    lookup.assert_hits(1);
    lookup.delete();
    let missing = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/slack/connections/{c}/actions/by-key"));
        then.status(404)
            .json_body(json!({"detail": "Slack action not found"}));
    });
    assert!(client.slack().get_action_by_key(c, "original:1").is_err());
    missing.assert_hits(1);
}

#[test]
fn incoming_subscriptions_use_event_selection_only() {
    let server = MockServer::start();
    let f = fixture();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = id(f["connection"]["identity_id"].as_str().unwrap());
    let sub = id(f["subscription"]["id"].as_str().unwrap());
    for event in [
        "slack.dm_received",
        "slack.group_dm_received",
        "slack.channel_message_received",
        "slack.mention_received",
        "slack.thread_reply_received",
    ] {
        let mut response = f["subscription"].clone();
        response["event_types"] = json!([event]);
        let mut create = server.mock(|when, then| {
            when.method(POST).path("/api/v1/webhooks/subscriptions").json_body(json!({
                "url": "https://example.com/hook", "event_types": [event], "agent_identity_id": identity
            }));
            then.status(201).json_body(response.clone());
        });
        let row = client
            .webhooks()
            .subscriptions()
            .create(
                "https://example.com/hook",
                &[event.into()],
                None,
                None,
                Some(identity),
                None,
                None,
            )
            .unwrap();
        assert_eq!(row.subscription.event_types, vec![event]);
        assert!(serde_json::to_value(row)
            .unwrap()
            .get("slack_filter")
            .is_none());
        create.assert();
        create.delete();
        let mut patch = server.mock(|when, then| {
            when.method(PATCH)
                .path(format!("/api/v1/webhooks/subscriptions/{sub}"))
                .json_body(json!({"event_types": [event]}));
            then.status(200).json_body(response);
        });
        client
            .webhooks()
            .subscriptions()
            .update(sub, None, Some(&[event.into()]), None, None)
            .unwrap();
        patch.assert();
        patch.delete();
    }
}

#[test]
fn errors_are_not_retried_and_event_vocabulary_deserializes() {
    let payloads: Vec<SlackWebhookPayload> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_webhook_events.json"
    ))
    .unwrap();
    assert_eq!(payloads.len(), 23);
    let raw: Vec<Value> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_webhook_events.json"
    ))
    .unwrap();
    for (parsed, original) in payloads.iter().zip(raw) {
        assert_eq!(serde_json::to_value(parsed).unwrap(), original);
    }
    for status in [409, 429, 503] {
        let server = MockServer::start();
        let client = Inkbox::builder("synthetic-test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let c = Uuid::nil();
        let error = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/slack/connections/{c}/messages"));
            then.status(status)
                .json_body(json!({"detail":"Unable to send"}));
        });
        assert!(client
            .slack()
            .send_message(
                c,
                &SlackSendMessageOptions {
                    conversation_id: "CEXAMPLE".into(),
                    text: "Hello".into(),
                    idempotency_key: "operation:1".into(),
                    thread_ts: None
                }
            )
            .is_err());
        error.assert_hits(1);
        assert!(client
            .slack()
            .send_message(
                c,
                &SlackSendMessageOptions {
                    conversation_id: "CEXAMPLE".into(),
                    text: "Hello".into(),
                    idempotency_key: "".into(),
                    thread_ts: None
                }
            )
            .is_err());
        error.assert_hits(1);
    }
}

#[test]
fn mixed_slack_events_preserve_identity_scope_and_context() {
    use inkbox::webhooks::{
        WebhookContextClassConfig, WebhookContextConfig, WebhookSubscriptionScope,
    };
    let server = MockServer::start();
    let f = fixture();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = id(f["connection"]["identity_id"].as_str().unwrap());
    let sub = id(f["subscription"]["id"].as_str().unwrap());
    let events = vec![
        "slack.mention_received".to_string(),
        "message.received".to_string(),
    ];
    let context = WebhookContextConfig {
        email: Some(WebhookContextClassConfig::Count { count: 1 }),
        ..Default::default()
    };
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/webhooks/subscriptions").json_body(json!({
            "url": "https://example.com/hook", "agent_identity_id": identity, "event_types": events,
            "context_config": {"email": {"mode": "count", "count": 1}}
        }));
        then.status(201).json_body(f["subscription"].clone());
    });
    client
        .webhooks()
        .subscriptions()
        .create(
            "https://example.com/hook",
            &events,
            None,
            None,
            Some(identity),
            Some(&context),
            None,
        )
        .unwrap();
    create.assert();
    for (auth_token, body) in [
        (None, json!({"event_types": events})),
        (
            Some(None),
            json!({"event_types": events, "auth_token": null}),
        ),
        (
            Some(Some("synthetic-token")),
            json!({"event_types": events, "auth_token": "synthetic-token"}),
        ),
    ] {
        let mut patch = server.mock(|when, then| {
            when.method(PATCH)
                .path(format!("/api/v1/webhooks/subscriptions/{sub}"))
                .query_param("scope", "identity")
                .json_body(body);
            then.status(200).json_body(f["subscription"].clone());
        });
        client
            .webhooks()
            .subscriptions()
            .update_with_scope(
                sub,
                None,
                Some(&events),
                None,
                auth_token,
                Some(WebhookSubscriptionScope::Identity),
            )
            .unwrap();
        patch.assert();
        patch.delete();
    }
}

#[test]
fn slack_conflicts_preserve_typed_error_without_repeating_writes() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let connection = id("22222222-2222-4222-8222-222222222222");
    let conflict = server.mock(|when, then| {
        when.method(POST);
        then.status(409).json_body(json!({"detail": {
            "error": "idempotency_key_reused",
            "message": "This key was already used for another request."
        }}));
    });
    let send = client.slack().send_message(
        connection,
        &SlackSendMessageOptions {
            conversation_id: "CEXAMPLE".into(),
            text: "Hello".into(),
            idempotency_key: "used-key".into(),
            thread_ts: None,
        },
    );
    let reaction = client.slack().add_reaction(
        connection,
        "CEXAMPLE",
        "1780000000.000001",
        "eyes",
        "used-key",
    );
    for error in [send.unwrap_err(), reaction.unwrap_err()] {
        assert!(matches!(
            error,
            inkbox::InkboxError::IdempotencyKeyReused {
                status_code: 409,
                ..
            }
        ));
    }
    conflict.assert_hits(2);
}

#[test]
fn context_preserves_direction_and_thread_selection() {
    for (thread_ts, window) in [
        (None, "messages_at_or_before_timestamp"),
        (Some("1780000000.000000"), "messages_at_or_after_timestamp"),
    ] {
        let server = MockServer::start();
        let client = Inkbox::builder("synthetic-test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let connection = id("22222222-2222-4222-8222-222222222222");
        let request = server.mock(|when, then| {
            let when = when
                .method(GET)
                .path(format!(
                    "/api/v1/slack/connections/{connection}/conversations/CEXAMPLE/messages/1780000000.000001/context"
                ))
                .query_param("limit", "5");
            if let Some(root) = thread_ts {
                when.query_param("thread_ts", root);
            }
            then.status(200).json_body(json!({
                "messages": [{"ts": "1780000000.000001", "text": "Selected message"}],
                "next_cursor": null, "has_more": false, "window": window, "complete": false
            }));
        });
        let context = client
            .slack()
            .message_context(
                connection,
                "CEXAMPLE",
                "1780000000.000001",
                &inkbox::SlackMessageContextOptions {
                    thread_ts: thread_ts.map(String::from),
                    limit: Some(5),
                },
            )
            .unwrap();
        assert_eq!(context.window, window);
        assert_eq!(context.messages[0]["ts"], "1780000000.000001");
        request.assert();
    }
}

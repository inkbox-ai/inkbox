use httpmock::prelude::*;
use httpmock::Method::PATCH;
use inkbox::{
    Inkbox, SlackActionStatus, SlackMessageKind, SlackMessagesOptions, SlackPageOptions,
    SlackSendMessageOptions, SlackWebhookFilter, SlackWebhookPayload,
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
    let invite = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/slack/invitations")
            .json_body(json!({"identity_id":identity,"expires_in_seconds":300}));
        then.status(201).json_body(f["invitation"].clone());
    });
    let inv = client
        .slack()
        .create_invitation(identity, Some(300))
        .unwrap();
    assert!(inv.invitation_url.unwrap().contains("#token="));
    invite.assert();
    let invites = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/invitations")
            .query_param("identity_id", identity.to_string());
        then.status(200).json_body(json!([f["invitation"]]));
    });
    assert_eq!(client.slack().list_invitations(identity).unwrap().len(), 1);
    invites.assert();
    let revoke = server.mock(|when, then| {
        when.method(POST).path(format!(
            "/api/v1/slack/invitations/{}/revoke",
            f["invitation"]["id"].as_str().unwrap()
        ));
        then.status(200).json_body(f["invitation"].clone());
    });
    client
        .slack()
        .revoke_invitation(id(f["invitation"]["id"].as_str().unwrap()))
        .unwrap();
    revoke.assert();
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
fn filters_roundtrip_and_patch_preserve_clear_replace() {
    let server = MockServer::start();
    let f = fixture();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = id(f["connection"]["identity_id"].as_str().unwrap());
    let sub = id(f["subscription"]["id"].as_str().unwrap());
    let filter = SlackWebhookFilter {
        message_kinds: Some(vec![SlackMessageKind::Mention, SlackMessageKind::Thread]),
        ..Default::default()
    };
    let create=server.mock(|when,then| { when.method(POST).path("/api/v1/webhooks/subscriptions").json_body(json!({"url":"https://example.com/hook","event_types":["slack.message_received"],"agent_identity_id":identity,"slack_filter":{"message_kinds":["mention","thread"]}})); then.status(201).json_body(f["subscription"].clone()); });
    let row = client
        .webhooks()
        .subscriptions()
        .create_with_slack_filter(
            "https://example.com/hook",
            &["slack.message_received".into()],
            None,
            None,
            Some(identity),
            None,
            None,
            Some(&filter),
        )
        .unwrap();
    assert_eq!(
        row.subscription.slack_filter.unwrap().message_kinds,
        filter.message_kinds
    );
    create.assert();
    for body in [
        json!({}),
        json!({"slack_filter":null}),
        json!({"slack_filter":{"message_kinds":["mention","thread"]}}),
    ] {
        let mut patch = server.mock(|when, then| {
            when.method(PATCH)
                .path(format!("/api/v1/webhooks/subscriptions/{sub}"))
                .json_body(body.clone());
            then.status(200).json_body(f["subscription"].clone());
        });
        let tri = if body.get("slack_filter").is_none() {
            None
        } else if body["slack_filter"].is_null() {
            Some(None)
        } else {
            Some(Some(&filter))
        };
        client
            .webhooks()
            .subscriptions()
            .update_with_slack_filter(sub, None, None, None, None, tri)
            .unwrap();
        patch.assert();
        patch.delete();
    }
    assert!(client
        .webhooks()
        .subscriptions()
        .create_with_slack_filter(
            "https://example.com/hook",
            &["text.received".into()],
            None,
            Some(identity),
            None,
            None,
            None,
            Some(&filter)
        )
        .is_err());
    assert!(client
        .webhooks()
        .subscriptions()
        .update_with_slack_filter(
            sub,
            None,
            None,
            None,
            None,
            Some(Some(&SlackWebhookFilter {
                message_kinds: Some(vec![]),
                ..Default::default()
            }))
        )
        .is_err());
}

#[test]
fn errors_are_not_retried_and_event_vocabulary_deserializes() {
    let payloads: Vec<SlackWebhookPayload> = serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_webhook_events.json"
    ))
    .unwrap();
    assert_eq!(payloads.len(), 19);
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

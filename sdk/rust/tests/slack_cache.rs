use httpmock::{Method, MockServer};
use inkbox::*;
use serde_json::Value;
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_cached_archive.json"
    ))
    .unwrap()
}
#[test]
fn installation_generation_is_optional_but_preserved() {
    let mut raw: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/slack.json")).unwrap();
    let old: SlackEnrichedConnection = serde_json::from_value(raw["connection"].clone()).unwrap();
    assert_eq!(old.generation, None);
    raw["connection"]["generation"] = serde_json::json!(3);
    let current: SlackEnrichedConnection =
        serde_json::from_value(raw["connection"].clone()).unwrap();
    assert_eq!(current.generation, Some(3));
    assert_eq!(current.id, current.connection.id);
    assert_eq!(serde_json::to_value(&current).unwrap(), raw["connection"]);
}
#[test]
fn enriched_connections_preserve_generation_without_changing_legacy_reads() {
    let mut connection: Value =
        serde_json::from_str::<Value>(include_str!("../../../tests/fixtures/slack.json")).unwrap()
            ["connection"]
            .clone();
    connection["generation"] = serde_json::json!(3);
    let identity = Uuid::parse_str(connection["identity_id"].as_str().unwrap()).unwrap();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mock = server.mock(|when, then| {
        when.method(Method::GET)
            .path("/api/v1/slack/connections")
            .header("x-api-key", "synthetic-test-key")
            .query_param("identity_id", identity.to_string())
            .matches(|request| request.query_params.as_ref().unwrap().len() == 1);
        then.status(200).json_body(serde_json::json!({
            "connections": [connection], "installation_available": true,
            "application_created": true, "setup": null, "provisioning_workspace": null
        }));
    });
    let legacy: SlackConnectionsResponse = client.slack().list_connections(identity).unwrap();
    let enriched: SlackEnrichedConnectionsResponse =
        client.slack().list_enriched_connections(identity).unwrap();
    assert_eq!(legacy.connections[0].id, enriched.connections[0].id);
    assert!(serde_json::to_value(&legacy.connections[0])
        .unwrap()
        .get("generation")
        .is_none());
    assert_eq!(enriched.connections[0].generation, Some(3));
    assert!(enriched.application_created);
    assert!(enriched.installation_available);
    mock.assert_hits(2);
}
#[test]
fn legacy_archive_defaults_ignore_new_response_fields_without_new_query_parameters() {
    let data = fixture();
    let id = Uuid::parse_str(data["connection_id"].as_str().unwrap()).unwrap();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mock = server.mock(|when, then| {
        when.method(Method::GET)
            .path(format!("/api/v1/slack/connections/{id}/archive/messages"))
            .query_param("limit", "50")
            .matches(|request| request.query_params.as_ref().unwrap().len() == 1);
        then.status(200).json_body(data["page"].clone());
    });
    let legacy: SlackArchiveMessagesResponse = client
        .slack()
        .list_archived_messages(id, &SlackArchiveMessagesOptions::default())
        .unwrap();
    let serialized = serde_json::to_value(&legacy).unwrap();
    assert!(serialized.get("included").is_none());
    assert!(serialized["messages"][0].get("reactions").is_none());
    assert_eq!(
        serialized["messages"][0]["text"],
        data["page"]["messages"][0]["text"]
    );
    let enriched = client
        .slack()
        .list_enriched_archived_messages(id, &SlackEnrichedArchiveMessagesOptions::default())
        .unwrap();
    assert_eq!(legacy.messages[0].id, enriched.messages[0].id);
    assert_eq!(enriched.messages[0].reply_count, Some(3));
    mock.assert_hits(2);
}
#[test]
fn cached_history_preserves_unknown_counts_partial_actors_and_exact_query() {
    let data = fixture();
    let id = Uuid::parse_str(data["connection_id"].as_str().unwrap()).unwrap();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mock = server.mock(|when, then| {
        when.method(Method::GET)
            .path(format!("/api/v1/slack/connections/{id}/archive/messages"))
            .query_param("roots_only", "true")
            .query_param("include", "conversation,sender,reactions,files")
            .query_param("limit", "25")
            .query_param("cursor", "previous")
            .query_param("conversation_id", "C123")
            .query_param("before_ts", "1700000001.000000")
            .query_param("after_ts", "1699999999.000000")
            .query_param("latest_per_conversation", "false")
            .matches(|request| request.query_params.as_ref().unwrap().len() == 8);
        then.status(200).json_body(data["page"].clone());
    });
    let page = client
        .slack()
        .list_enriched_archived_messages(
            id,
            &SlackEnrichedArchiveMessagesOptions {
                roots_only: Some(true),
                include: Some(vec![
                    SlackArchiveInclude::Conversation,
                    SlackArchiveInclude::Sender,
                    SlackArchiveInclude::Reactions,
                    SlackArchiveInclude::Files,
                ]),
                archive: SlackArchiveMessagesOptions {
                    limit: Some(25),
                    cursor: Some("previous".into()),
                    conversation_id: Some("C123".into()),
                    before_ts: Some("1700000001.000000".into()),
                    after_ts: Some("1699999999.000000".into()),
                    latest_per_conversation: Some(false),
                    ..Default::default()
                },
            },
        )
        .unwrap();
    let message = &page.messages[0];
    assert_eq!(message.reply_count, Some(3));
    let reactions = message.reactions.as_ref().unwrap();
    assert_eq!(reactions[0].count, None);
    assert_eq!(reactions[0].reacted, None);
    assert!(!reactions[0].users_complete);
    assert_eq!(reactions[1].count, Some(0));
    assert_eq!(reactions[1].reacted, Some(false));
    assert_eq!(
        message.blocks.as_ref().unwrap()[0]["block_id"],
        "keep_snake_case"
    );
    let serialized = serde_json::to_value(message).unwrap();
    assert_eq!(serialized["id"], data["page"]["messages"][0]["id"]);
    assert_eq!(serialized["blocks"], data["page"]["messages"][0]["blocks"]);
    assert!(serialized.get("message").is_none());
    let included = page.included.unwrap();
    assert_eq!(included.actors["U123"].id, "U123");
    assert_eq!(included.conversations["C123"].name, None);
    assert_eq!(
        included.emoji["celebrate"].alias_of.as_deref(),
        Some("party")
    );
    assert!(included.files["F123"].content_cached);
    mock.assert_hits(1);
}
#[test]
fn legacy_response_does_not_invent_counts() {
    let legacy: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_operations.json"
    ))
    .unwrap();
    let raw = legacy["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|case| case["name"] == "list_archived_messages")
        .unwrap()["response"]
        .clone();
    let page: SlackEnrichedArchiveMessagesResponse = serde_json::from_value(raw).unwrap();
    assert_eq!(page.next_cursor.as_deref(), Some("next"));
    assert_eq!(page.messages[0].text, "retained message");
    assert!(page.page_boundary.is_none());
    assert!(page.included.is_none());
    assert!(page.messages[0].reactions.is_none());
    assert!(page.messages[0].reactions_complete.is_none());
    assert!(page.messages[0].reply_count.is_none());
    assert!(page.messages[0].sender_access.is_none());
    assert!(page.messages[0].blocks.is_none());
    assert!(page.messages[0].attachments.is_none());
}
#[test]
fn emoji_search_and_media_use_one_authenticated_request_each() {
    let data = fixture();
    let id = Uuid::parse_str(data["connection_id"].as_str().unwrap()).unwrap();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mock = server.mock(|when, then| {
        when.method(Method::GET)
            .path(format!("/api/v1/slack/connections/{id}/emoji"))
            .query_param("q", "party +")
            .query_param("limit", "2")
            .query_param("cursor", "previous");
        then.status(200).json_body(data["emoji_page"].clone());
    });
    let page = client
        .slack()
        .list_cached_emoji(
            id,
            &SlackCachedEmojiOptions {
                q: Some("party +".into()),
                cursor: Some("previous".into()),
                limit: Some(2),
            },
        )
        .unwrap();
    assert_eq!(page.status, "pending");
    assert_eq!(page.next_cursor.as_deref(), Some("party"));
    assert_eq!(page.emoji[0].alias_of.as_deref(), Some("party"));
    mock.assert_hits(1);
    for (path, preview) in [
        ("cached-media/emoji/party%2B", false),
        ("files/F123/preview", true),
    ] {
        let mock = server.mock(|when, then| {
            when.method(Method::GET)
                .path(format!("/api/v1/slack/connections/{id}/{path}"))
                .header("x-api-key", "synthetic-test-key");
            then.status(200).body(vec![0u8, 255, 1]);
        });
        let bytes = if preview {
            client.slack().download_file_preview(id, "F123")
        } else {
            client
                .slack()
                .download_cached_media(id, SlackCachedMediaKind::Emoji, "party+")
        };
        assert_eq!(bytes.unwrap(), vec![0u8, 255, 1]);
        mock.assert_hits(1);
    }
}

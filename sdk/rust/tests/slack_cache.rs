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
    let old: SlackConnection = serde_json::from_value(raw["connection"].clone()).unwrap();
    assert_eq!(old.generation, None);
    raw["connection"]["generation"] = serde_json::json!(3);
    let current: SlackConnection = serde_json::from_value(raw["connection"].clone()).unwrap();
    assert_eq!(current.generation, Some(3));
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
            .query_param("cursor", "previous");
        then.status(200).json_body(data["page"].clone());
    });
    let page = client
        .slack()
        .list_archived_messages(
            id,
            &SlackArchiveMessagesOptions {
                roots_only: Some(true),
                include: Some(vec![
                    SlackArchiveInclude::Conversation,
                    SlackArchiveInclude::Sender,
                    SlackArchiveInclude::Reactions,
                    SlackArchiveInclude::Files,
                ]),
                limit: Some(25),
                cursor: Some("previous".into()),
                ..Default::default()
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
    let mut raw = fixture()["page"].clone();
    raw.as_object_mut().unwrap().remove("included");
    for key in [
        "reactions",
        "reactions_complete",
        "reply_count",
        "latest_reply",
    ] {
        raw["messages"][0].as_object_mut().unwrap().remove(key);
    }
    let page: SlackArchiveMessagesResponse = serde_json::from_value(raw).unwrap();
    assert!(page.included.is_none());
    assert!(page.messages[0].reactions.is_none());
    assert!(page.messages[0].reply_count.is_none());
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

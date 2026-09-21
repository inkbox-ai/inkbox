use httpmock::{Method, MockServer};
use inkbox::*;
use serde_json::{json, Value};
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_operations.json"
    ))
    .unwrap()
}
fn invoke(client: &Inkbox, name: &str, data: &Value) -> Value {
    let s = client.slack();
    let c = Uuid::parse_str(data["connection_id"].as_str().unwrap()).unwrap();
    let o = Uuid::parse_str(data["operation_id"].as_str().unwrap()).unwrap();
    let ts = data["message_ts"].as_str().unwrap();
    let page = SlackPageOptions {
        limit: Some(2),
        cursor: Some("opaque".into()),
    };
    macro_rules! v {
        ($value:expr) => {
            serde_json::to_value($value.unwrap()).unwrap()
        };
    }
    match name {
        "start_installation" => v!(s.start_installation(c, Some("T123"))),
        "start_installation_defaults" => v!(s.start_installation_with_return_url(c, None, None)),
        "start_installation_return_url" => v!(s.start_installation_with_return_url(
            c,
            Some("T123"),
            Some("https://example.com/console/slack/complete")
        )),
        "capabilities" => v!(s.capabilities(c)),
        "list_users" => v!(s.list_users(c, &page)),
        "get_user" => v!(s.get_user(c, "U123")),
        "list_members" => v!(s.list_members(c, "C123", &page)),
        "get_message" => v!(s.get_message(c, "C123", ts, Some("1234567890.000000"))),
        "message_context" => {
            v!(s.message_context(c, "C123", ts, &SlackMessageContextOptions::default()))
        }
        "get_permalink" => v!(s.get_permalink(c, "C123", ts)),
        "get_reactions" => v!(s.get_reactions(c, "C123", ts)),
        "list_pins" => v!(s.list_pins(c, "C123")),
        "get_operation" => v!(s.get_operation(c, o)),
        "add_reaction" => v!(s.add_reaction(c, "C123", ts, "eyes", "stable-key")),
        "remove_reaction" => v!(s.remove_reaction(c, "C123", ts, "eyes", "stable-key")),
        "add_pin" => v!(s.add_pin(c, "C123", ts, "stable-key")),
        "remove_pin" => v!(s.remove_pin(c, "C123", ts, "stable-key")),
        "update_message" => v!(s.update_message(c, "C123", ts, "edited", "stable-key")),
        "delete_message" => v!(s.delete_message(c, "C123", ts, "stable-key")),
        "join_conversation" => v!(s.join_conversation(c, "C123", "stable-key")),
        "leave_conversation" => v!(s.leave_conversation(c, "C123", "stable-key")),
        "set_processing_status" => v!(s.set_processing_status(
            c,
            "C123",
            ts,
            SlackProcessingStatus::Processing,
            "stable-key"
        )),
        "upload_file" => v!(s.upload_file(
            c,
            &SlackUploadFileOptions {
                conversation_id: "C123".into(),
                filename: "binary.dat".into(),
                content_base64: "AP8B".into(),
                idempotency_key: "stable-key".into(),
                title: None,
                initial_comment: None,
                thread_ts: Some(ts.into())
            }
        )),
        "get_archive_settings" => v!(s.get_archive_settings(c)),
        "update_archive_settings" => v!(s.update_archive_settings(
            c,
            &SlackArchiveSettingsOptions {
                capture_enabled: true,
                retention_days: None,
                conversation_ids: vec!["C123".into()]
            }
        )),
        "list_archived_messages" => v!(s.list_archived_messages(
            c,
            &SlackArchiveMessagesOptions {
                conversation_id: Some("C123".into()),
                thread_ts: Some(ts.into()),
                before_ts: Some("1234567891.000000".into()),
                after_ts: Some("1234567889.000000".into()),
                limit: Some(2),
                cursor: Some("opaque".into())
            }
        )),
        "search_archived_messages" => v!(s.search_archived_messages(
            c,
            "retained message",
            &SlackArchiveSearchOptions {
                conversation_id: Some("C123".into()),
                user_id: Some("U123".into()),
                before_ts: Some("1234567891.000000".into()),
                after_ts: Some("1234567889.000000".into()),
                limit: Some(2),
                cursor: Some("opaque".into())
            }
        )),
        "search_messages" => v!(s.search_messages(
            "retained message",
            &SlackSearchMessagesOptions {
                identity_id: Some(Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap()),
                connection_id: Some(c),
                conversation_id: Some("C123".into()),
                user_id: Some("U123".into()),
                before_ts: Some("1234567891.000000".into()),
                after_ts: Some("1234567889.000000".into()),
                limit: Some(2),
                cursor: Some("opaque".into()),
            }
        )),
        "search_messages_defaults" => v!(s.search_messages(
            "release + café & notes?",
            &SlackSearchMessagesOptions::default()
        )),
        "search_messages_continuation" => v!(s.search_messages(
            "retained message",
            &SlackSearchMessagesOptions {
                cursor: Some("opaque+/=".into()),
                ..Default::default()
            }
        )),
        "archive_backfill" => v!(s.archive_backfill(
            c,
            "C123",
            &SlackArchiveBackfillOptions {
                thread_ts: Some(ts.into()),
                restart: true
            }
        )),
        "list_archive_coverage" => v!(s.list_archive_coverage(
            c,
            &SlackPageOptions {
                limit: Some(2),
                cursor: Some(o.to_string())
            }
        )),
        "purge_archive" => v!(s.purge_archive(c)),
        _ => panic!("Unknown fixture case {name}"),
    }
}
#[test]
fn every_public_operation_matches_exact_wire_and_typed_responses() {
    let data = fixture();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    for case in data["cases"].as_array().unwrap() {
        let method = match case["method"].as_str().unwrap() {
            "POST" => Method::POST,
            "PATCH" => Method::PATCH,
            "DELETE" => Method::DELETE,
            _ => Method::GET,
        };
        let mut mock = server.mock(|when, then| {
            let mut when = when
                .method(method)
                .path(format!("/api/v1{}", case["path"].as_str().unwrap()));
            for (name, value) in case["query"].as_object().unwrap() {
                when = when.query_param(name, value.as_str().unwrap());
            }
            if case["name"] == "search_messages_defaults" {
                when = when.matches(|req| req.query_params.as_ref().unwrap().len() == 2);
            }
            if case["name"] == "search_messages_continuation" {
                when = when.matches(|req| req.query_params.as_ref().unwrap().len() == 3);
            }
            if let Some(key) = case["idempotency_key"].as_str() {
                when = when.header("Idempotency-Key", key);
            }
            if !case["body"].is_null() {
                when.json_body(case["body"].clone());
            }
            then.status(200).json_body(case["response"].clone());
        });
        let result = invoke(&client, case["name"].as_str().unwrap(), &data);
        assert_eq!(result, case["response"], "{}", case["name"]);
        mock.assert_hits(1);
        mock.delete();
    }
}
#[test]
fn uncertain_outcomes_and_http_errors_do_not_retry_and_keys_are_required() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::nil();
    let mock = server.mock(|when, then| {
        when.method(Method::DELETE).path(format!(
            "/api/v1/slack/connections/{id}/conversations/C123/messages/1234567890.000001"
        ));
        then.status(503).json_body(json!({"detail":"Unavailable"}));
    });
    assert!(client
        .slack()
        .delete_message(id, "C123", "1234567890.000001", "stable-key")
        .is_err());
    mock.assert_hits(1);
    assert!(client
        .slack()
        .delete_message(id, "C123", "1234567890.000001", "")
        .is_err());
    mock.assert_hits(1);
}

#[test]
fn identity_search_preserves_http_errors() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    for status in [403, 422, 429, 503] {
        let mut mock = server.mock(|when, then| {
            when.method(Method::GET).path("/api/v1/slack/search");
            then.status(status)
                .json_body(json!({"detail":{"code":"search_failed","message":"Search failed"}}));
        });
        assert!(client
            .slack()
            .search_messages("message", &SlackSearchMessagesOptions::default())
            .is_err());
        mock.assert_hits(1);
        mock.delete();
    }
}

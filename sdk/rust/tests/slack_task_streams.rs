use httpmock::{Method, MockServer};
use inkbox::*;
use serde_json::{json, Value};
use std::collections::HashMap;
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_task_streams.json"
    ))
    .unwrap()
}

#[test]
fn task_streams_match_exact_wire_without_replay() {
    let data = fixture();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let connection = Uuid::parse_str(data["connection_id"].as_str().unwrap()).unwrap();
    let stream = Uuid::parse_str(data["stream_id"].as_str().unwrap()).unwrap();
    for case in data["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let key = case["idempotency_key"].as_str().unwrap();
        let mut mock = server.mock(|when, then| {
            let when = when
                .method(if name == "get_by_key" {
                    Method::GET
                } else {
                    Method::POST
                })
                .path(format!("/api/v1{}", case["path"].as_str().unwrap()))
                .header("Idempotency-Key", key)
                .matches(|req| req.query_params.as_ref().map_or(true, |p| p.is_empty()));
            if case["body"].is_null() {
                when.matches(|req| req.body.as_ref().map_or(true, |body| body.is_empty()));
            } else {
                when.json_body(case["body"].clone());
            }
            then.status(200).json_body(case["response"].clone());
        });
        let chunks: Vec<SlackTaskChunk> = serde_json::from_value(
            case["body"]["chunks"]
                .as_array()
                .map_or(json!([]), |v| json!(v)),
        )
        .unwrap();
        let result = match name {
            "start_default" | "start_plan" => client.slack().start_stream(
                connection,
                "C123",
                &SlackStreamStartOptions {
                    thread_ts: data["thread_ts"].as_str().unwrap().into(),
                    recipient_user_id: "U123".into(),
                    recipient_team_id: "T123".into(),
                    chunks,
                    task_display_mode: if name == "start_plan" {
                        SlackTaskDisplayMode::Plan
                    } else {
                        SlackTaskDisplayMode::default()
                    },
                },
                key,
            ),
            "append" => client
                .slack()
                .append_stream(connection, "C123", stream, &chunks, key),
            "stop_empty" | "stop_final" => client
                .slack()
                .stop_stream(connection, "C123", stream, &chunks, key),
            _ => client.slack().get_operation_by_key(connection, key),
        }
        .unwrap();
        assert_eq!(result.id, stream);
        assert_eq!(result.thread_ts.as_deref(), data["thread_ts"].as_str());
        assert_eq!(
            serde_json::to_value(result.operation).unwrap(),
            case["response"]["operation"]
        );
        assert_eq!(
            serde_json::to_value(result.status).unwrap(),
            case["response"]["status"]
        );
        assert_eq!(
            serde_json::to_value(result.retry_after).unwrap(),
            case["response"]["retry_after"]
        );
        mock.assert_hits(1);
        mock.delete();
    }
}

#[test]
fn enriched_responses_preserve_older_payloads_and_new_fields() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::nil();
    for native in [None, Some("missing_scope")] {
        let mut response = json!({"connection_id": id, "scopes": [], "missing_scopes": [], "capabilities": {},
            "native_processing_status": "unknown", "max_upload_bytes": 100});
        if let Some(value) = native {
            response["native_task_streaming"] = json!(value);
        }
        let mut mock = server.mock(|when, then| {
            when.path(format!("/api/v1/slack/connections/{id}/capabilities"));
            then.json_body(response);
        });
        let result = client.slack().task_capabilities(id).unwrap();
        assert_eq!(result.connection_id, id);
        assert_eq!(
            result.native_task_streaming,
            if native.is_some() {
                SlackNativeProcessingStatus::MissingScope
            } else {
                SlackNativeProcessingStatus::Unknown
            }
        );
        mock.assert_hits(1);
        mock.delete();
    }
    let mut old = fixture()["cases"][0]["response"].clone();
    old.as_object_mut().unwrap().remove("thread_ts");
    old["operation"] = json!("message_update");
    let mock = server.mock(|when, then| {
        when.path(format!("/api/v1/slack/connections/{id}/operations/{id}"));
        then.json_body(old);
    });
    let result = client.slack().get_stream_operation(id, id).unwrap();
    assert!(result.thread_ts.is_none());
    assert_eq!(result.operation, SlackStreamOperationKind::MessageUpdate);
    mock.assert_hits(1);
}

#[test]
fn legacy_struct_literals_and_exhaustive_matches_still_compile() {
    let operation = SlackOperation {
        id: Uuid::nil(),
        connection_id: Uuid::nil(),
        operation: SlackOperationKind::MessageUpdate,
        status: SlackOperationStatus::Succeeded,
        conversation_id: "C123".into(),
        message_ts: None,
        file_id: None,
        error_code: None,
        retry_after: None,
        processing_status: None,
        agent_status: None,
    };
    let legacy_name = match operation.operation {
        SlackOperationKind::ReactionAdd => "reaction_add",
        SlackOperationKind::ReactionRemove => "reaction_remove",
        SlackOperationKind::PinAdd => "pin_add",
        SlackOperationKind::PinRemove => "pin_remove",
        SlackOperationKind::MessageUpdate => "message_update",
        SlackOperationKind::MessageDelete => "message_delete",
        SlackOperationKind::FileUpload => "file_upload",
        SlackOperationKind::ConversationJoin => "conversation_join",
        SlackOperationKind::ConversationLeave => "conversation_leave",
        SlackOperationKind::ProcessingStatus => "processing_status",
    };
    assert_eq!(legacy_name, "message_update");
    let capabilities = SlackCapabilitiesResponse {
        connection_id: Uuid::nil(),
        scopes: vec![],
        missing_scopes: vec![],
        capabilities: HashMap::new(),
        native_processing_status: SlackNativeProcessingStatus::Unknown,
        max_upload_bytes: 100,
    };
    assert_eq!(capabilities.max_upload_bytes, 100);
}

#[test]
fn invalid_key_never_dispatches_and_failed_mutation_is_not_retried() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::nil();
    let mock = server.mock(|when, then| {
        when.method(Method::POST).path(format!(
            "/api/v1/slack/connections/{id}/conversations/C123/streams/{id}/stop"
        ));
        then.status(503).json_body(json!({"detail": "Busy"}));
    });
    assert!(matches!(
        client.slack().get_operation_by_key(id, "bad key"),
        Err(InkboxError::InvalidArgument(_))
    ));
    assert!(client
        .slack()
        .stop_stream(id, "C123", id, &[], "stable-key")
        .is_err());
    mock.assert_hits(1);
}

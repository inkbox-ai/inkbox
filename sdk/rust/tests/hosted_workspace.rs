use httpmock::prelude::*;
use inkbox::{
    hosted_workspace::{ChatAnswer, ChatEvent, ChatPayload},
    Inkbox,
};
use serde_json::{json, Value};
#[test]
fn rename_preserves_title_and_idempotency_key() {
    let server = MockServer::start();
    let renamed = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/example-agent/hosting/chat/conversations/conversation")
            .header("Idempotency-Key", "rename-once")
            .json_body(json!({"title":"Inbox review"}));
        then.status(200).json_body(json!({"id":"conversation","title":"Inbox review","origin":"chat","history_completeness":"complete","capabilities":{"send_message":true,"cancel_turn":true,"approvals":true,"questions":true,"attachments":true,"tool_activity":true}}));
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = client
        .identities()
        .workspace("example-agent")
        .rename_conversation("conversation", "Inbox review", "rename-once")
        .unwrap();
    assert_eq!(result.title, "Inbox review");
    renamed.assert_hits(1);
}
#[test]
fn stream_reset_is_an_actionable_error_without_replay() {
    let server = MockServer::start();
    let reset = server.mock(|when, then| {
        when.method(GET);
        then.status(200).body(
            "event: stream.reset\ndata: {\"code\":\"event_cursor_expired\",\"status\":410}\n\n",
        );
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let workspace = client.identities().workspace("example-agent");
    let mut stream = workspace.stream_events("conversation", None).unwrap();
    match stream.next().unwrap().unwrap_err() {
        inkbox::InkboxError::Api {
            status_code,
            detail,
            ..
        } => {
            assert_eq!(status_code, 410);
            assert_eq!(detail.as_object().unwrap()["code"], "event_cursor_expired");
        }
        error => panic!("Unexpected error: {error}"),
    }
    assert!(stream.next().is_none());
    reset.assert_hits(1);
}
#[test]
fn shared_events_have_typed_payloads_and_stream_without_replay() {
    let data: Vec<ChatEvent> =
        serde_json::from_str(include_str!("../../../contracts/events-v1.json")).unwrap();
    for event in &data {
        event.payload().unwrap();
    }
    assert!(matches!(
        data[3].payload().unwrap(),
        ChatPayload::Interaction(_)
    ));
    let values: Vec<Value> =
        serde_json::from_str(include_str!("../../../contracts/events-v1.json")).unwrap();
    let body = values
        .iter()
        .map(|e| format!("data: {e}\n\n"))
        .collect::<String>();
    let server = MockServer::start();
    let stream = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example-agent/hosting/chat/conversations/conversation/events")
            .query_param("after", "resume");
        then.status(200)
            .header("Content-Type", "text/event-stream")
            .body(body);
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let workspace = client.identities().workspace("example-agent");
    let received = workspace
        .stream_events("conversation", Some("resume"))
        .unwrap()
        .collect::<inkbox::Result<Vec<_>>>()
        .unwrap();
    assert_eq!(received.len(), values.len());
    stream.assert_hits(1);
    let answer=server.mock(|when,then|{when.method(POST).path("/api/v1/identities/example-agent/hosting/chat/conversations/conversation/interactions/request/response").header("Idempotency-Key","answer-once").json_body(json!({"expected_version":3,"response":{"kind":"approval","decision":"deny"}}));then.status(202).json_body(json!({"status":"submitted"}));});
    workspace
        .respond(
            "conversation",
            "request",
            3,
            &ChatAnswer::Approval {
                decision: "deny".into(),
            },
            "answer-once",
        )
        .unwrap();
    answer.assert_hits(1);
}

#[test]
fn selected_model_is_sent_without_changing_default_requests() {
    use inkbox::hosted_workspace::ChatContent;
    let server = MockServer::start();
    let response = json!({"id":"turn","conversation_id":"conversation","status":"queued","terminal":false,"blocker":null});
    let selected = server.mock(|when, then| {
        when.method(POST)
            .json_body(json!({"content":[{"type":"text","text":"Hello"}],"model":"gpt-6.1-sol"}));
        then.status(202).json_body(response.clone());
    });
    let default = server.mock(|when, then| {
        when.method(POST)
            .json_body(json!({"content":[{"type":"text","text":"Hello"}]}));
        then.status(202).json_body(response.clone());
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let workspace = client.identities().workspace("example-agent");
    let content = [ChatContent::Text {
        text: "Hello".into(),
    }];
    workspace.send("conversation", &content, "default").unwrap();
    workspace
        .send_with_model("conversation", &content, "selected", Some("gpt-6.1-sol"))
        .unwrap();
    selected.assert_hits(1);
    default.assert_hits(1);
}

#[test]
fn permission_mode_is_saved_on_the_conversation() {
    use inkbox::hosted_workspace::ChatPermissionMode;
    let server = MockServer::start();
    let update = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/example-agent/hosting/chat/conversations/conversation")
            .header("Idempotency-Key", "mode-once")
            .json_body(json!({"permission_mode":"yolo"}));
        then.status(200).json_body(json!({"id":"conversation","title":"Inbox review","origin":"chat","permission_mode":"yolo","history_completeness":"complete","capabilities":{"send_message":true,"cancel_turn":true,"approvals":true,"questions":true,"attachments":true,"tool_activity":true}}));
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = client
        .identities()
        .workspace("example-agent")
        .set_permission_mode("conversation", ChatPermissionMode::Yolo, "mode-once")
        .unwrap();
    assert_eq!(result.permission_mode, ChatPermissionMode::Yolo);
    update.assert_hits(1);
}

#[test]
fn authoritative_operation_and_history_fixtures() {
    let wire: Value =
        serde_json::from_str(include_str!("../../../contracts/hosted-workspace-v1.json")).unwrap();
    let server = MockServer::start();
    let operation = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example/hosting/workspace/operations/operation");
        then.status(200).json_body(wire["operation"].clone());
    });
    let history = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example/hosting/workspace/schedules/schedule/occurrences");
        then.status(200).json_body(wire["schedule_history"].clone());
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let workspace = client.identities().workspace("example");
    assert_eq!(workspace.operation("operation").unwrap(), wire["operation"]);
    assert_eq!(
        workspace.schedule_history("schedule").unwrap(),
        wire["schedule_history"]
    );
    operation.assert_hits(1);
    history.assert_hits(1);
}

#[test]
fn message_phase_is_preserved_by_typed_payloads() {
    let events: Vec<inkbox::hosted_workspace::ChatEvent> =
        serde_json::from_str(include_str!("../../../contracts/events-v1.json")).unwrap();
    let inkbox::hosted_workspace::ChatPayload::Message(message) = events[0].payload().unwrap()
    else {
        panic!("expected message");
    };
    assert_eq!(message.phase.as_deref(), Some("commentary"));
}

#[test]
fn stream_headers_update_cookies_and_metadata_before_consumption_even_on_errors() {
    use std::sync::{Arc, Mutex};
    for status in [200, 403] {
        let server = MockServer::start();
        let mut stream = server.mock(|when, then| {
            when.method(GET).path(
                "/api/v1/identities/example-agent/hosting/chat/conversations/conversation/events",
            );
            then.status(status)
                .header("Set-Cookie", "stream_session=example; Path=/")
                .header(
                    "Inkbox-Notices",
                    r#"[{"code":"test_notice","level":"info","message":"Example notice"}]"#,
                )
                .body(if status == 200 {
                    ": heartbeat\n\n"
                } else {
                    r#"{"detail":"Denied"}"#
                });
        });
        let subsequent = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/example-agent/hosting/chat/conversations/conversation/events")
                .query_param("after", "next").header("Cookie", "stream_session=example");
            then.status(200).body(": done\n\n");
        });
        let observations = Arc::new(Mutex::new(Vec::new()));
        let observed = observations.clone();
        let client = Inkbox::builder("synthetic-key")
            .base_url(server.base_url())
            .response_observer(move |metadata| observed.lock().unwrap().push(metadata.clone()))
            .build()
            .unwrap();
        let scoped = client
            .with_response_metadata(|scoped| {
                let opened = scoped
                    .identities()
                    .workspace("example-agent")
                    .stream_events("conversation", None);
                assert_eq!(opened.is_ok(), status == 200);
                // Headers are observed without needing to iterate the body.
                assert_eq!(observations.lock().unwrap().len(), 1);
                Ok(())
            })
            .unwrap();
        assert_eq!(scoped.notices.unwrap()[0].code, "test_notice");
        stream.delete();
        let _ = client
            .identities()
            .workspace("example-agent")
            .stream_events("conversation", Some("next"))
            .unwrap();
        subsequent.assert_hits(1);
    }
}

#[test]
fn automatic_approval_metadata_is_optional_for_older_events() {
    let base = json!({"id":"request","kind":"approval","version":1,"status":"pending","expires_at":"2026-01-01T00:00:00Z","title":"Read file"});
    let old: inkbox::hosted_workspace::ChatInteraction =
        serde_json::from_value(base.clone()).unwrap();
    assert!(!old.auto_approve);
    let mut automatic = base;
    automatic["auto_approve"] = json!(true);
    let new: inkbox::hosted_workspace::ChatInteraction = serde_json::from_value(automatic).unwrap();
    assert!(new.auto_approve);
}

#[test]
fn conversation_origin_filter_preserves_cursor() {
    let server = MockServer::start();
    let filtered = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example-agent/hosting/chat/conversations")
            .query_param("origin", "chat")
            .query_param("limit", "2")
            .query_param("after", "cursor");
        then.status(200)
            .json_body(json!({"items":[],"next_cursor":null}));
    });
    let client = Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    client
        .identities()
        .workspace("example-agent")
        .conversations_filtered(Some("cursor"), 2, Some("chat"))
        .unwrap();
    filtered.assert_hits(1);
}

#[test]
fn schedule_control_wire_compatibility() {
    let fixtures: Value =
        serde_json::from_str(include_str!("../../../contracts/schedule-control-v1.json")).unwrap();
    for name in [
        "offline_pause",
        "offline_delete",
        "resume_pending",
        "legacy_receipt",
        "offline_page",
        "synchronized_page",
    ] {
        let wire = &fixtures[name];
        let server = MockServer::start();
        let response = server.mock(|_when, then| {
            then.status(200).json_body(wire.clone());
        });
        let client = Inkbox::builder("synthetic-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let workspace = client.identities().workspace("example-agent");
        let result = if name.ends_with("page") {
            workspace.schedules(None, 50)
        } else if name == "offline_delete" {
            workspace.delete_schedule(wire["schedule_id"].as_str().unwrap(), 1, "delete-once")
        } else {
            workspace.update_schedule(
                wire["schedule_id"].as_str().unwrap(),
                1,
                &json!({"enabled":name == "resume_pending"}),
                "update-once",
            )
        }
        .unwrap();
        assert_eq!(&result, wire, "{name}");
        response.assert_hits(1);
    }
}

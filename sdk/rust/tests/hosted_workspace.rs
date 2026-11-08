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

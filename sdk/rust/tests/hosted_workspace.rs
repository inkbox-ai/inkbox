use httpmock::prelude::*;
use inkbox::{
    hosted_workspace::{ChatAnswer, ChatEvent, ChatPayload},
    Inkbox,
};
use serde_json::{json, Value};
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

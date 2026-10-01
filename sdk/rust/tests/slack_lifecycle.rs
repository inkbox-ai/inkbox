use httpmock::prelude::*;
use inkbox::{
    Inkbox, SlackAppDeletionStatus, SlackAppDeletionsOptions, SlackHistoryMessagesOptions,
};
use serde_json::{json, Value};
use uuid::Uuid;

#[test]
fn lifecycle_and_history_preserve_pending_outcomes_and_scope() {
    let f: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/slack_lifecycle.json")).unwrap();
    let id = |key: &str| Uuid::parse_str(f["deletion"][key].as_str().unwrap()).unwrap();
    let identity = id("identity_id");
    let app = id("application_id");
    let job = id("id");
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let state = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/applications")
            .query_param("identity_id", identity.to_string());
        then.json_body(f["application_state"].clone());
    });
    assert_eq!(
        client
            .slack()
            .get_application(identity)
            .unwrap()
            .deletion
            .unwrap()
            .status,
        SlackAppDeletionStatus::Pending
    );
    state.assert();
    let delete = server.mock(|when, then| {
        when.method(DELETE)
            .path(format!("/api/v1/slack/applications/{app}"));
        then.status(202).json_body(f["deletion"].clone());
    });
    assert_eq!(
        client.slack().delete_application(app).unwrap().status,
        SlackAppDeletionStatus::Pending
    );
    delete.assert();
    let jobs = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/application-deletions")
            .query_param("cursor", job.to_string())
            .query_param("unresolved_only", "true")
            .query_param("limit", "2");
        then.json_body(f["deletions"].clone());
    });
    assert_eq!(
        client
            .slack()
            .list_application_deletions(&SlackAppDeletionsOptions {
                cursor: Some(job.to_string()),
                limit: Some(2),
                unresolved_only: true,
            })
            .unwrap()
            .next_cursor,
        Some(job)
    );
    jobs.assert();
    let retry = server.mock(|when, then| {
        when.method(POST)
            .path(format!("/api/v1/slack/application-deletions/{job}/retry"));
        then.status(202).json_body(f["deletion"].clone());
    });
    assert_eq!(
        client
            .slack()
            .retry_application_deletion(job)
            .unwrap()
            .status,
        SlackAppDeletionStatus::Pending
    );
    retry.assert();
    let mut manual_payload = f["deletion"].clone();
    manual_payload["app_id"] = Value::Null;
    manual_payload["status"] = json!("manually_confirmed");
    let manual = server.mock(|when, then| {
        when.method(POST)
            .path(format!(
                "/api/v1/slack/application-deletions/{job}/confirm-manual-removal"
            ))
            .json_body(json!({"confirmation": "I removed the unknown Slack app"}));
        then.status(202).json_body(manual_payload);
    });
    assert_eq!(
        client
            .slack()
            .confirm_manual_app_removal(job, "I removed the unknown Slack app")
            .unwrap()
            .status,
        SlackAppDeletionStatus::ManuallyConfirmed
    );
    manual.assert();
    let workspaces = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/history/workspaces")
            .query_param("identity_id", identity.to_string());
        then.json_body(f["workspaces"].clone());
    });
    assert!(client.slack().list_history_workspaces(identity).unwrap()[0]
        .live_connection_id
        .is_none());
    workspaces.assert();
    let history = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/history/messages")
            .query_param("identity_id", identity.to_string())
            .query_param("workspace_id", "TEXAMPLE")
            .query_param("q", "tea")
            .query_param("cursor", "previous")
            .query_param("thread_ts", "1700000000.000001")
            .query_param("conversation_id", "CEXAMPLE")
            .query_param("latest_per_conversation", "true");
        then.json_body(f["history"].clone());
    });
    let response = client
        .slack()
        .list_history_messages(
            identity,
            &SlackHistoryMessagesOptions {
                workspace_id: Some("TEXAMPLE".into()),
                q: Some("tea".into()),
                cursor: Some("previous".into()),
                conversation_id: Some("CEXAMPLE".into()),
                thread_ts: Some("1700000000.000001".into()),
                latest_per_conversation: Some(true),
                ..Default::default()
            },
        )
        .unwrap();
    assert!(response.messages.is_empty());
    assert_eq!(response.next_cursor.as_deref(), Some("next-page"));
    history.assert();
    let sources = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/slack/history/messages/{job}/sources"))
            .query_param("identity_id", identity.to_string());
        then.json_body(f["sources"].clone());
    });
    assert_eq!(
        client.slack().list_message_sources(identity, job).unwrap()[0].application_id,
        app
    );
    sources.assert();
    let empty: inkbox::SlackApplicationState =
        serde_json::from_value(json!({"application":null,"deletion":null})).unwrap();
    assert!(empty.application.is_none());
}

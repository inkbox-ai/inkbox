use httpmock::prelude::*;
use inkbox::contacts::types::Contact;
use inkbox::{
    Inkbox, SlackActorProfile, SlackConnectionsResponse, SlackSetupState, SlackWebhookPayload,
};
use serde_json::{json, Value};
use uuid::Uuid;
fn data() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_setup_profiles.json"
    ))
    .unwrap()
}
#[test]
fn setup_uses_one_post_and_old_connections_still_parse() {
    let data = data();
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = Uuid::parse_str(data["identity_id"].as_str().unwrap()).unwrap();
    let workspace = Uuid::parse_str(data["provisioning_workspace_id"].as_str().unwrap()).unwrap();
    let create = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/slack/applications/setup")
            .json_body(json!({"identity_id": identity, "provisioning_workspace_id": workspace}));
        then.status(202).json_body(data["setup"].clone());
    });
    let setup = client.slack().start_setup(identity, workspace).unwrap();
    assert_eq!(setup.status, SlackSetupState::Pending);
    assert_eq!(setup.retry_at.as_deref(), Some("2026-10-01T12:00:00Z"));
    create.assert();
    let mut old_response = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/connections")
            .query_param("identity_id", identity.to_string());
        then.status(200)
            .json_body(json!({"connections": [], "installation_available": true}));
    });
    let old: SlackConnectionsResponse = client.slack().list_connections(identity).unwrap();
    assert!(old.setup.is_none());
    assert!(!old.application_created);
    old_response.assert();
    old_response.delete();
    let current_response = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/connections")
            .query_param("identity_id", identity.to_string());
        then.status(200).json_body(json!({
            "connections": [], "installation_available": true,
            "setup": data["setup"], "application_created": true
        }));
    });
    let current = client.slack().list_connections(identity).unwrap();
    assert_eq!(current.setup.unwrap().status, SlackSetupState::Pending);
    assert!(current.application_created);
    current_response.assert();
}
#[test]
fn sender_enrichment_and_linked_contacts_remain_optional() {
    let mut data = data();
    let payload: SlackWebhookPayload = serde_json::from_value(data["webhook"].clone()).unwrap();
    let sender = payload.data.actor_profile.unwrap();
    assert_eq!(sender.is_bot, Some(false));
    assert_eq!(sender.tz_offset, Some(0));
    assert_eq!(
        sender.profile.unwrap().email.as_deref(),
        Some("person@example.com")
    );
    assert_eq!(
        payload.data.contact_id.unwrap().to_string(),
        data["contact"]["id"]
    );
    let minimal: SlackActorProfile = serde_json::from_value(json!({"id": "UEXAMPLE"})).unwrap();
    assert!(minimal.profile.is_none());
    let card: Contact = serde_json::from_value(data["contact"].clone()).unwrap();
    assert_eq!(
        card.slack_accounts[0].workspace_name.as_deref(),
        Some("Example workspace")
    );
    assert_eq!(card.slack_accounts[1].user_id, "USECOND");
    data["contact"]
        .as_object_mut()
        .unwrap()
        .remove("slack_accounts");
    let old: Contact = serde_json::from_value(data["contact"].clone()).unwrap();
    assert!(old.slack_accounts.is_empty());
    data["webhook"]["data"]
        .as_object_mut()
        .unwrap()
        .remove("actor_profile");
    data["webhook"]["data"]
        .as_object_mut()
        .unwrap()
        .remove("contact_id");
    let old: SlackWebhookPayload = serde_json::from_value(data["webhook"].clone()).unwrap();
    assert!(old.data.actor_profile.is_none() && old.data.contact_id.is_none());
}

#[test]
fn missing_credentials_and_workspace_metadata_parse() {
    let mut response = json!({"connections": [], "installation_available": false,
        "setup": {"status": "needs_credentials", "error_code": "credentials_required", "provisioning_workspace_id": null},
        "provisioning_workspace": null});
    let missing: SlackConnectionsResponse = serde_json::from_value(response.clone()).unwrap();
    assert_eq!(
        missing.setup.unwrap().status,
        SlackSetupState::NeedsCredentials
    );
    assert!(missing.provisioning_workspace.is_none());
    let fixture: Value =
        serde_json::from_str(include_str!("../../../tests/fixtures/slack.json")).unwrap();
    response["provisioning_workspace"] = fixture["provisioning_workspace"].clone();
    let saved: SlackConnectionsResponse = serde_json::from_value(response).unwrap();
    assert_eq!(
        saved.provisioning_workspace.unwrap().workspace_id,
        "TEXAMPLE"
    );
}

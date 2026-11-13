use inkbox::identities::{HostingUpdate, Unset};
use serde_json::json;

#[test]
fn shapes_keep_version_numeric_allocations_and_unavailable_choices() {
    use httpmock::prelude::*;
    let server = MockServer::start();
    let request = server.mock(|when, then| {
        when.method(GET).path("/api/v1/computers/shapes");
        then.status(200)
            .header("Content-Type", "application/json")
            .body(include_str!("../../../contracts/computer-shapes.json"));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let catalog = client.computers().shapes().unwrap();
    assert_eq!(catalog.version, 1);
    assert_eq!(catalog.items[1].memory_mib, 32768);
    assert!(!catalog.items[1].available);
    request.assert_hits(1);
    let update = HostingUpdate {
        expected_generation: 0,
        shape_id: Some(catalog.items[0].id.clone()),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(update).unwrap(),
        json!({"expected_generation":0,"shape_id":"v1-cpu1-ram4gb"})
    );
}

#[test]
fn persistent_default_model_survives_requests_and_responses() {
    let update = HostingUpdate {
        expected_generation: 1,
        default_model: Some("gpt-6-luna".into()),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(update).unwrap(),
        json!({"expected_generation":1,"default_model":"gpt-6-luna"})
    );
    let response: inkbox::identities::HostingConfiguration = serde_json::from_value(json!({
        "mode":"inkbox","identity_id":"identity","state":"ready","generation":2,"applied_generation":2,
        "default_model":"gpt-6-luna","instructions":"","trigger_events":[],"follow_defaults":true,"idle_timeout_seconds":600
    })).unwrap();
    assert_eq!(response.default_model, "gpt-6-luna");
}

#[test]
fn updates_preserve_empty_selection_and_distinguish_credits_from_omission() {
    let mut update = HostingUpdate {
        expected_generation: 2,
        trigger_events: Some(vec![]),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(&update).unwrap(),
        json!({"expected_generation":2,"trigger_events":[]})
    );
    update.credential_binding_id = Unset::Value(None);
    assert_eq!(
        serde_json::to_value(&update).unwrap(),
        json!({"expected_generation":2,"trigger_events":[],"credential_binding_id":null})
    );
    update.credential_binding_id = Unset::Value(Some("key".into()));
    assert_eq!(
        serde_json::to_value(&update).unwrap()["credential_binding_id"],
        "key"
    );
}

#[test]
fn templates_preserve_selected_defaults_and_nullable_metadata() {
    use httpmock::prelude::*;
    let server = MockServer::start();
    let request = server.mock(|when, then| {
        when.method(GET).path("/api/v1/computers/templates");
        then.status(200)
            .header("Content-Type", "application/json")
            .body(include_str!("../../../contracts/computer-templates.json"));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = client.computers().templates().unwrap();
    let selected = result.hosted_defaults.codex.unwrap();
    assert_eq!(selected.id, "codex-current");
    assert_eq!(selected.total_disk_bytes, 12000000000);
    assert!(result.hosted_defaults.hermes.is_none());
    assert!(result.items[0].software.os.is_none());
    request.assert_hits(1);
}

#[test]
fn authoritative_server_hosting_fixture() {
    let wire: serde_json::Value =
        serde_json::from_str(include_str!("../../../contracts/hosted-workspace-v1.json")).unwrap();
    let response: inkbox::identities::HostingConfiguration =
        serde_json::from_value(wire["hosting"].clone()).unwrap();
    assert_eq!(response.default_model, wire["hosting"]["default_model"]);
    let update = HostingUpdate {
        expected_generation: 1,
        default_model: Some("gpt-6-luna".into()),
        trigger_events: Some(vec![]),
        credential_binding_id: Unset::Value(None),
        ..Default::default()
    };
    assert_eq!(
        serde_json::to_value(update).unwrap(),
        wire["hosting_update"]
    );
}

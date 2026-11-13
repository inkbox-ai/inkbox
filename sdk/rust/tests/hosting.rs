use inkbox::identities::{HostingUpdate, Unset};
use serde_json::json;

#[test]
fn provider_capabilities_and_keys_preserve_provider_and_retry_identity() {
    use httpmock::prelude::*;
    use inkbox::computers::{ComputerHarness, HostingAdmission, ModelKeyInput, ModelProvider};
    let server = MockServer::start();
    let capability = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/computers/hosting/capabilities");
        then.status(200).json_body(
            serde_json::from_str::<serde_json::Value>(include_str!(
                "../../../contracts/hosting-capabilities.json"
            ))
            .unwrap(),
        );
    });
    let admission = server.mock(|when, then| {
        when.method(POST).path("/api/v1/computers/hosting/admission").json_body(json!({"harness":"claude_code","shape_id":"v1-cpu2-ram8gb","credential_binding_id":"key","default_model":"claude-sonnet-5-5"}));
        then.status(200).json_body(json!({"allowed":true}));
    });
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/computers/secret-bindings").header("Idempotency-Key","create-once")
            .json_body(json!({"provider":"anthropic","name":"Example","api_key":"synthetic-provider-key"}));
        then.status(201).json_body(json!({"id":"key","provider":"anthropic","name":"Example","display_suffix":"-key","version":1,"revoked":false}));
    });
    let rotate = server.mock(|when, then| {
        when.method(PUT).path("/api/v1/computers/secret-bindings/key").json_body(json!({"provider":"anthropic","name":"Example","api_key":"synthetic-provider-key","expected_version":1}));
        then.status(200).json_body(json!({"id":"key","version":2,"revoked":false}));
    });
    let revoke = server.mock(|when, then| {
        when.method(DELETE)
            .path("/api/v1/computers/secret-bindings/key");
        then.status(200)
            .json_body(json!({"id":"key","version":3,"revoked":true}));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let catalog = client.computers().hosting_capabilities().unwrap();
    assert!(matches!(
        catalog.items[0].harness,
        ComputerHarness::ClaudeCode
    ));
    assert!(!catalog.items[1].available);
    assert!(client
        .computers()
        .hosting_admission(&HostingAdmission {
            harness: ComputerHarness::ClaudeCode,
            tier: None,
            shape_id: Some("v1-cpu2-ram8gb".into()),
            credential_binding_id: Some("key".into()),
            default_model: Some("claude-sonnet-5-5".into())
        })
        .unwrap());
    let input = ModelKeyInput {
        provider: ModelProvider::Anthropic,
        name: "Example".into(),
        api_key: "synthetic-provider-key".into(),
    };
    assert!(matches!(
        client
            .computers()
            .create_model_key(&input, "create-once")
            .unwrap()
            .provider,
        ModelProvider::Anthropic
    ));
    assert_eq!(
        client
            .computers()
            .rotate_model_key("key", &input, 1)
            .unwrap()
            .version,
        2
    );
    assert!(client.computers().revoke_model_key("key").unwrap().revoked);
    for request in [capability, admission, create, rotate, revoke] {
        request.assert_hits(1);
    }
}

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

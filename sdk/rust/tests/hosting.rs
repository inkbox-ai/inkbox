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
        when.method(GET)
            .path("/api/v1/computers/templates")
            .query_param("include_all_harnesses", "true");
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

#[test]
fn hosting_url_and_ports_subresource() {
    use httpmock::prelude::*;
    use inkbox::identities::{HostingPortSetting, HostingPortsUpdate};
    let server = MockServer::start();
    let config = json!({
        "mode": "inkbox", "identity_id": "identity", "state": "running", "generation": 1,
        "applied_generation": 1, "instructions": "", "trigger_events": [], "follow_defaults": true,
        "credential_binding_id": null, "idle_timeout_seconds": 60, "last_error": null, "updated_at": null,
        "machine_id": null, "harness": null, "tier": null, "shape_id": null,
        "url": "https://agent.example.test", "delivery": "internal"
    });
    let view = json!({
        "url": "https://agent.example.test", "default_port": 3000, "version": 4,
        "ports": [
            {"port": 3000, "public": false, "url": "https://agent.example.test",
             "token_url": "https://agent.example.test?_token=t"},
            {"port": 8080, "public": true, "url": null, "token_url": null}
        ]
    });
    let get_hosting = server.mock(|when, then| {
        when.method(GET).path("/api/v1/identities/agent/hosting");
        then.status(200).json_body(config.clone());
    });
    let get_ports = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/agent/hosting/ports");
        then.status(200).json_body(view.clone());
    });
    let update = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/agent/hosting/ports")
            .json_body(json!({"version": 4, "default_port": null, "ports": [{"port": 8080, "public": true}]}));
        then.status(200).json_body(view.clone());
    });
    let rotate = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/identities/agent/hosting/ports/3000/token");
        then.status(200).json_body(view.clone());
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let ids = client.identities();
    let hosting = ids.get_hosting("agent").unwrap();
    assert_eq!(hosting.url.as_deref(), Some("https://agent.example.test"));
    assert_eq!(hosting.delivery, "internal");
    let ports = ids.get_hosting_ports("agent").unwrap();
    assert_eq!((ports.default_port, ports.version), (Some(3000), 4));
    assert!(ports.ports[0]
        .token_url
        .as_deref()
        .unwrap()
        .ends_with("?_token=t"));
    assert!(ports.ports[1].url.is_none() && ports.ports[1].token_url.is_none());
    ids.update_hosting_ports(
        "agent",
        &HostingPortsUpdate {
            version: ports.version,
            default_port: Unset::Value(None),
            ports: Some(vec![HostingPortSetting {
                port: 8080,
                public: true,
            }]),
        },
    )
    .unwrap();
    ids.rotate_hosting_port_token("agent", 3000).unwrap();
    get_hosting.assert();
    get_ports.assert();
    update.assert();
    rotate.assert();
    assert_eq!(
        serde_json::to_value(HostingPortsUpdate {
            version: 4,
            default_port: Unset::Omit,
            ports: None
        })
        .unwrap(),
        json!({"version": 4})
    );

    let mut legacy = config;
    legacy.as_object_mut().unwrap().remove("url");
    legacy.as_object_mut().unwrap().remove("delivery");
    let legacy: inkbox::identities::HostingConfiguration = serde_json::from_value(legacy).unwrap();
    assert!(legacy.url.is_none());
    assert_eq!(legacy.delivery, "tunnel");
}

#[test]
fn create_tunnel_for_existing_identity() {
    use httpmock::prelude::*;
    let server = MockServer::start();
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/identities/agent/tunnel");
        then.status(201).json_body(json!({
            "id": "00000000-0000-0000-0000-000000000001", "organization_id": "org_example",
            "tunnel_name": "agent", "agent_identity_id": "00000000-0000-0000-0000-000000000000",
            "tls_mode": "edge", "cert_pem": null, "cert_fingerprint_sha256": null,
            "cert_expires_at": null, "status": "active", "last_connected_at": null,
            "last_connected_ip_addr": null, "last_disconnected_at": null,
            "currently_connected": false, "public_host": "agent.example.test",
            "zone": "example.test", "metadata": {},
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
        }));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let tunnel = client.identities().create_tunnel("agent").unwrap();
    create.assert();
    assert_eq!(tunnel.tunnel_name, "agent");
    assert_eq!(tunnel.public_host, "agent.example.test");
}

#[test]
fn create_hosted_identity_sends_flag_and_has_no_tunnel() {
    use httpmock::prelude::*;
    let server = MockServer::start();
    let create = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/identities/")
            .json_body(json!({"agent_handle": "agent", "hosted": true}));
        then.status(201).json_body(json!({
            "id": "00000000-0000-0000-0000-000000000000", "organization_id": "org_example",
            "agent_handle": "agent", "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z", "tunnel": null
        }));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = client.create_hosted_identity("agent").unwrap();
    create.assert();
    assert!(identity.tunnel().is_none());
}

#[test]
fn create_hosted_sends_mailbox_options() {
    use httpmock::prelude::*;
    use inkbox::identities::IdentityMailboxCreateOptions;
    let server = MockServer::start();
    let create = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/identities/")
            .json_body(json!({
                "agent_handle": "agent", "hosted": true,
                "mailbox": {"email_local_part": "support"}
            }));
        then.status(201).json_body(json!({
            "id": "00000000-0000-0000-0000-000000000000", "organization_id": "org_example",
            "agent_handle": "agent", "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-01T00:00:00Z", "tunnel": null
        }));
    });
    let client = inkbox::Inkbox::builder("synthetic-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let mailbox = IdentityMailboxCreateOptions {
        email_local_part: Some("support".into()),
        ..Default::default()
    };
    let identity = client
        .create_hosted_identity_with("agent", None, Some(&mailbox), None, None)
        .unwrap();
    create.assert();
    assert!(identity.tunnel().is_none());
}

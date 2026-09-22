use httpmock::prelude::*;
use httpmock::Method::PATCH;
use serde_json::{json, Value};

use crate::companion::*;
use crate::Inkbox;

const ACTIVATION: &str = "b2222222-2222-4222-8222-222222222222";
const PATH: &str = "/api/v1/identities/example-agent/companion/activations/b2222222-2222-4222-8222-222222222222/messages";

fn fixture() -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../tests/fixtures/companion-v1.json"),
        )
        .unwrap(),
    )
    .unwrap()
}

#[test]
fn companion_config_reads_same_fields_for_agent_and_admin() {
    let fixture = fixture();
    for api_key in ["test-agent-key", "test-admin-key"] {
        for name in ["config", "config_without_resources"] {
            for enabled in [false, true] {
                let server = MockServer::start();
                let mut config = fixture[name].clone();
                config["enabled"] = json!(enabled);
                config["notices"] = fixture["pages"][0]["notices"].clone();
                let get = server.mock(|when, then| {
                    when.method(GET)
                        .path("/api/v1/identities/example-agent/companion")
                        .header("x-api-key", api_key);
                    then.status(200).json_body(config.clone());
                });
                let sdk = Inkbox::builder(api_key)
                    .base_url(server.base_url())
                    .build()
                    .unwrap();
                let result = sdk.companion().get("example-agent").unwrap();
                assert_eq!(serde_json::to_value(result).unwrap(), config);
                get.assert_hits(1);
            }
        }
    }
}

#[test]
fn companion_config_patch_only_enabled_without_resources() {
    for enabled in [None, Some(true), Some(false)] {
        let server = MockServer::start();
        let mut config = fixture()["config_without_resources"].clone();
        config["enabled"] = json!(enabled.unwrap_or(true));
        let body = enabled.map_or(json!({}), |value| json!({"enabled": value}));
        let update = server.mock(|when, then| {
            when.method(PATCH)
                .path("/api/v1/identities/example-agent/companion")
                .json_body(body)
                .matches(|request| request.query_params.as_ref().map_or(true, Vec::is_empty));
            then.status(200).json_body(config.clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let result = sdk
            .companion()
            .update("example-agent", &CompanionUpdateOptions { enabled })
            .unwrap();
        assert_eq!(result.enabled, enabled.unwrap_or(true));
        assert!(!result.readiness.mail.ready);
        assert!(!result.readiness.phone.ready);
        assert!(!result.readiness.imessage.ready);
        assert_eq!(
            result.readiness.mail.reasons[0],
            "bidirectional_allow_required"
        );
        update.assert_hits(1);
    }
}

#[test]
fn companion_paged_state_preserves_wire_shape() {
    let server = MockServer::start();
    let state = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example-agent/companion/conversations")
            .query_param("channel", "mail")
            .query_param("limit", "200")
            .query_param("offset", "10000");
        then.status(200).json_body(json!({"items": [], "total": 0}));
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    assert_eq!(
        sdk.companion()
            .conversations(
                "example-agent",
                &CompanionConversationOptions {
                    channel: Some(CompanionChannel::Mail),
                    limit: 200,
                    offset: 10000
                }
            )
            .unwrap()
            .total,
        0
    );
    state.assert();
}

#[test]
fn companion_complete_hydration_normalizes_uuid_case_deduplicates_and_revalidates() {
    for channel in ["mail", "phone", "imessage"] {
        let server = MockServer::start();
        let mut fixture = fixture();
        for page in fixture["pages"].as_array_mut().unwrap() {
            page["channel"] = json!(channel);
            page["reply_context"]["channel"] = json!(channel);
            if channel != "mail" {
                page["reply_context"]["reply_to_message_id"] = Value::Null;
                page["reply_context"]["to"] = Value::Null;
                page["reply_context"]["cc"] = Value::Null;
            }
        }
        let second = &mut fixture["pages"][1];
        for key in ["scope_id", "activation_id", "conversation_id"] {
            second[key] = json!(second[key].as_str().unwrap().to_uppercase());
        }
        for key in ["conversation_id", "reply_to_message_id"] {
            if let Some(value) = second["reply_context"][key].as_str() {
                second["reply_context"][key] = json!(value.to_uppercase());
            }
        }
        for entry in second["items"].as_array_mut().unwrap() {
            entry["id"] = json!(entry["id"].as_str().unwrap().to_uppercase());
        }
        fixture["pages"][0]["reply_context"]["conversation_id"] = second["conversation_id"].clone();
        let first = server.mock(|when, then| {
            when.method(GET).path(PATH).matches(|request| {
                !request
                    .query_params
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|(key, _)| key == "cursor")
            });
            then.status(200).json_body(fixture["pages"][0].clone());
        });
        let second = server.mock(|when, then| {
            when.method(GET)
                .path(PATH)
                .query_param("cursor", "opaque-page-2");
            then.status(200).json_body(fixture["pages"][1].clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let result = sdk
            .with_response_metadata(|scoped| {
                scoped.companion().load_initialization(
                    "example-agent",
                    &ACTIVATION.to_uppercase(),
                    &Default::default(),
                )
            })
            .unwrap();
        assert_eq!(result.data.entries.len(), 3);
        assert_eq!(
            result
                .data
                .entries
                .iter()
                .map(|entry| entry.sender_access)
                .collect::<Vec<_>>(),
            vec![
                Some(crate::SenderAccess::Sponsored),
                None,
                Some(crate::SenderAccess::Direct)
            ]
        );
        assert!(result.data.text.contains("\"sender_access\":\"sponsored\""));
        assert!(result.data.text.contains("\"sender_access\":\"direct\""));
        assert!(!result.data.text.contains("\"sender_access\":null"));
        assert_eq!(
            result
                .data
                .entries
                .iter()
                .filter(|entry| entry.is_trigger)
                .count(),
            1
        );
        assert_eq!(
            result
                .data
                .text
                .matches("Please join this conversation.")
                .count(),
            1
        );
        assert!(result.data.text.contains("\\nCan you review this?"));
        assert_eq!(result.data.entries[0].attachments.len(), 1);
        assert_eq!(result.data.notices, result.notices.unwrap());
        assert_eq!(result.data.notices[0].code, "future_history_notice");
        first.assert_hits(2);
        second.assert_hits(1);
    }
}

#[test]
fn companion_rejects_mixed_scopes_incomplete_snapshots_and_limits() {
    for mutation in [
        "scope",
        "activation",
        "reply",
        "audience",
        "conflict",
        "cursor",
        "incomplete",
        "no_trigger",
        "two_triggers",
        "bytes",
        "pages",
    ] {
        let server = MockServer::start();
        let mut fixture = fixture();
        let mut options = CompanionInitializationOptions::default();
        match mutation {
            "scope" => fixture["pages"][1]["scope_id"] = json!(ACTIVATION),
            "activation" => {
                fixture["pages"][1]["activation_id"] = fixture["pages"][1]["scope_id"].clone()
            }
            "reply" => fixture["pages"][1]["reply_context"]["conversation_id"] = json!(ACTIVATION),
            "audience" => {
                fixture["pages"][1]["reply_context"]["to"] = json!(["someone@example.com"])
            }
            "conflict" => {
                let entry = &mut fixture["pages"][1]["items"][0];
                entry["id"] = json!(entry["id"].as_str().unwrap().to_uppercase());
                entry["text"] = json!("different");
            }
            "cursor" => {
                fixture["pages"][1]["history_complete"] = json!(false);
                fixture["pages"][1]["next_cursor"] = json!("opaque-page-2");
            }
            "incomplete" => fixture["pages"][1]["history_complete"] = json!(false),
            "no_trigger" => {
                fixture["pages"][1]["items"].as_array_mut().unwrap().pop();
            }
            "two_triggers" => {
                fixture["pages"][0]["items"][0]["is_trigger"] = json!(true);
                fixture["pages"][0]["items"][0]["historical"] = json!(false);
            }
            "bytes" => options.max_bytes = 100,
            "pages" => options.max_pages = 1,
            _ => unreachable!(),
        }
        server.mock(|when, then| {
            when.method(GET).path(PATH).matches(|request| {
                !request
                    .query_params
                    .as_ref()
                    .unwrap()
                    .iter()
                    .any(|(key, _)| key == "cursor")
            });
            then.status(200).json_body(fixture["pages"][0].clone());
        });
        server.mock(|when, then| {
            when.method(GET)
                .path(PATH)
                .query_param("cursor", "opaque-page-2");
            then.status(200).json_body(fixture["pages"][1].clone());
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        assert!(
            sdk.companion()
                .load_initialization("example-agent", ACTIVATION, &options)
                .is_err(),
            "{mutation}"
        );
    }
}

#[test]
fn companion_revocation_preserves_error_and_old_webhook_literals() {
    let server = MockServer::start();
    server.mock(|when, then| {
        when.method(GET).path(PATH);
        then.status(403)
            .json_body(json!({"detail": "Activation unavailable"}));
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    assert!(matches!(
        sdk.companion()
            .load_initialization("example-agent", ACTIVATION, &Default::default()),
        Err(crate::InkboxError::Api {
            status_code: 403,
            ..
        })
    ));
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Legacy {
        id: String,
    }
    let legacy = Legacy {
        id: "evt_example".into(),
    };
    let enriched: WithCompanion<Legacy> = serde_json::from_value(json!({"id": legacy.id})).unwrap();
    assert!(enriched.companion.is_none());
    let enriched: WithCompanion<Legacy> = serde_json::from_value(json!({"id": "evt_example", "companion": {
        "scope_id": ACTIVATION, "conversation_id": ACTIVATION, "channel": "mail", "phase": "ordinary", "sequence": 1
    }})).unwrap();
    assert_eq!(enriched.companion.unwrap().phase, CompanionPhase::Ordinary);
}

#[test]
fn companion_sender_access_is_optional_and_rejects_unknown_values() {
    let mut value = fixture()["pages"][0]["items"][0].clone();
    value.as_object_mut().unwrap().remove("sender_access");
    let entry: CompanionHistoryEntry = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(entry.sender_access, None);
    assert!(serde_json::to_value(&entry)
        .unwrap()
        .get("sender_access")
        .is_none());
    for invalid in [json!("trusted"), json!("ordinary"), json!(true)] {
        value["sender_access"] = invalid;
        assert!(serde_json::from_value::<CompanionHistoryEntry>(value.clone()).is_err());
    }
}

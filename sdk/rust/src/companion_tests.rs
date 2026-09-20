use httpmock::prelude::*;
use httpmock::Method::PATCH;
use serde_json::{json, Value};

use crate::companion::*;
use crate::Inkbox;

const ACTIVATION: &str = "22222222-2222-4222-8222-222222222222";
const PATH: &str = "/api/v1/identities/example-agent/companion/activations/22222222-2222-4222-8222-222222222222/messages";

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
fn companion_config_patch_and_state_preserve_wire_shape() {
    let server = MockServer::start();
    let fixture = fixture();
    let get = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/example-agent/companion");
        then.status(200).json_body(fixture["config"].clone());
    });
    let update = server.mock(|when, then| {
        when.method(PATCH)
            .path("/api/v1/identities/example-agent/companion")
            .json_body(json!({"enabled": false}));
        then.status(200).json_body(fixture["config"].clone());
    });
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
    assert!(sdk
        .companion()
        .get("example-agent")
        .unwrap()
        .sponsor
        .is_none());
    sdk.companion()
        .update(
            "example-agent",
            &CompanionUpdateOptions {
                enabled: Some(false),
                ..Default::default()
            },
        )
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
    get.assert();
    update.assert();
    state.assert();
}

#[test]
fn companion_complete_hydration_deduplicates_preserves_notices_and_revalidates() {
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
                    ACTIVATION,
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
            "conflict" => fixture["pages"][1]["items"][0]["text"] = json!("different"),
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

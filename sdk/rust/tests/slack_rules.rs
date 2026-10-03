use httpmock::prelude::*;
use httpmock::Method::PATCH;
use inkbox::*;
use serde_json::json;
use uuid::Uuid;
const ID: &str = "11111111-1111-4111-8111-111111111111";
#[test]
fn slack_rules_discovery_and_import_wire_contract() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::parse_str(ID).unwrap();
    let rule = json!({"id":ID,"agent_identity_id":ID,"action":"allow","match_type":"exact_user","match_target":"TEXAMPLE:UEXAMPLE",
        "direction":"both","status":"active","created_at":"2026-10-02T00:00:00Z","updated_at":"2026-10-02T00:00:00Z","contact":null});
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/identities/project-agent/slack-contact-rules")
            .json_body(json!({"action":"allow","match_type":"exact_user","match_target":"TEXAMPLE:UEXAMPLE"}));
        then.status(200).json_body(rule.clone());
    });
    assert_eq!(
        client
            .slack()
            .contact_rules
            .create(
                "project-agent",
                &SlackContactRuleCreateOptions {
                    action: SlackRuleAction::Allow,
                    match_type: SlackRuleMatchType::ExactUser,
                    match_target: "TEXAMPLE:UEXAMPLE".into(),
                    direction: None,
                }
            )
            .unwrap()
            .id,
        id
    );
    create.assert();
    let update = server.mock(|when, then| {
        when.method(PATCH)
            .path(format!(
                "/api/v1/identities/project-agent/slack-contact-rules/{ID}"
            ))
            .json_body(json!({"action":"block","apply_to":"outbound"}));
        then.status(200).json_body(rule.clone());
    });
    client
        .slack()
        .contact_rules
        .update(
            "project-agent",
            id,
            &SlackContactRuleUpdateOptions {
                action: Some(SlackRuleAction::Block),
                apply_to: Some(contact_rules::ContactRuleApplyTo::Outbound),
                direction: None,
            },
        )
        .unwrap();
    update.assert();
    let list = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/slack/contact-rules")
            .query_param("agent_identity_id", ID)
            .query_param("direction", "inbound");
        then.status(200).json_body(json!([rule]));
    });
    assert_eq!(
        client
            .slack()
            .contact_rules
            .list_all(
                Some(id),
                &SlackContactRuleListOptions {
                    direction: Some(contact_rules::ContactRuleDirection::Inbound),
                    ..Default::default()
                }
            )
            .unwrap()
            .len(),
        1
    );
    list.assert();
    let discover = server.mock(|when, then| {
        when.method(GET)
            .path(format!("/api/v1/slack/connections/{ID}/workspaces"))
            .query_param("source", "enterprise")
            .query_param("limit", "20");
        then.status(200).json_body(
            json!({"workspaces":[],"next_cursor":null,"unavailable_reason":"missing_scope"}),
        );
    });
    assert_eq!(
        client
            .slack()
            .discover_workspaces(
                id,
                &SlackWorkspaceDiscoveryOptions {
                    source: SlackWorkspaceDiscoverySource::Enterprise,
                    ..Default::default()
                }
            )
            .unwrap()
            .unavailable_reason
            .as_deref(),
        Some("missing_scope")
    );
    discover.assert();
    let import = server.mock(|when, then| {
        when.method(POST)
            .path(format!("/api/v1/slack/connections/{ID}/contacts/import"))
            .json_body(json!({"conversation_id":"CEXAMPLE","cursor":"previous","limit":20}));
        then.status(200).json_body(
            json!({"imported_count":0,"skipped_count":2,"contact_ids":[],"next_cursor":"next"}),
        );
    });
    assert_eq!(
        client
            .slack()
            .import_contacts(
                id,
                &SlackContactImportOptions {
                    conversation_id: Some("CEXAMPLE".into()),
                    cursor: Some("previous".into()),
                    limit: Some(20),
                }
            )
            .unwrap()
            .next_cursor
            .as_deref(),
        Some("next")
    );
    import.assert();
}

#[test]
fn slack_rule_get_delete_and_future_discovery_source() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::parse_str(ID).unwrap();
    let rule = json!({"id":ID,"agent_identity_id":ID,"action":"allow","match_type":"exact_user","match_target":"TEXAMPLE:UEXAMPLE",
        "direction":"both","status":"active","created_at":"2026-10-02T00:00:00Z","updated_at":"2026-10-02T00:00:00Z","contact":null});
    let get = server.mock(|when, then| {
        when.method(GET).path(format!(
            "/api/v1/identities/project-agent/slack-contact-rules/{ID}"
        ));
        then.status(200).json_body(rule);
    });
    assert_eq!(
        client
            .slack()
            .contact_rules
            .get("project-agent", id)
            .unwrap()
            .id,
        id
    );
    get.assert();
    let delete = server.mock(|when, then| {
        when.method(DELETE).path(format!(
            "/api/v1/identities/project-agent/slack-contact-rules/{ID}"
        ));
        then.status(204);
    });
    client
        .slack()
        .contact_rules
        .delete("project-agent", id)
        .unwrap();
    delete.assert();
    let source: SlackDiscoveredWorkspace = serde_json::from_value(json!({"workspace_id":"TEXAMPLE","workspace_name":null,"source":"future_source","future_field":true})).unwrap();
    assert!(matches!(source.source, SlackWorkspaceSource::Unknown));
}

#[test]
fn slack_filter_modes_require_confirmed_raw_response_and_parse_directions() {
    for confirmed in [false, true] {
        let server = MockServer::start();
        let client = Inkbox::builder("synthetic")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let mut response = json!({"id":ID,"organization_id":"example-org","agent_handle":"project-agent","created_at":"2026-10-02T00:00:00Z","updated_at":"2026-10-02T00:00:00Z"});
        if confirmed {
            response["slack_filter_mode"] = json!("blacklist");
            response["slack_inbound_filter_mode"] = json!("whitelist");
            response["slack_outbound_filter_mode"] = json!("blacklist");
        }
        let update = server.mock(|when, then| {
            when.method(PATCH)
                .path("/api/v1/identities/project-agent")
                .json_body(json!({"slack_inbound_filter_mode":"whitelist"}));
            then.status(200).json_body(response);
        });
        let result = client.identities().update_filter_modes(
            "project-agent",
            &identities::IdentityFilterModeOptions {
                slack_inbound_filter_mode: Some(mail::types::FilterMode::Whitelist),
                ..Default::default()
            },
        );
        if confirmed {
            let saved = result.unwrap();
            assert_eq!(
                saved.slack_inbound_filter_mode,
                mail::types::FilterMode::Whitelist
            );
            assert_eq!(
                saved.slack_outbound_filter_mode,
                mail::types::FilterMode::Blacklist
            );
        } else {
            assert!(result.unwrap_err().to_string().contains("not confirmed"));
        }
        update.assert();
    }
}

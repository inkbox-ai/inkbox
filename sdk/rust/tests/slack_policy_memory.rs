use httpmock::{prelude::*, Method::PATCH};
use inkbox::companion::CompanionActivationPage;
use inkbox::mail::types::FilterMode;
use inkbox::{
    contacts::{ContactFactCitation, CorrespondenceItem},
    ContactRuleApplyTo, ContactRuleDirection, CreateSlackContactRuleOptions, Inkbox,
    ListSlackContactRulesOptions, SlackRuleAction, SlackRuleMatchType,
    UpdateSlackContactRuleOptions, UpdateSlackContactRuleSettings,
};
use serde_json::{json, Value};
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/slack_policy_memory.json"
    ))
    .unwrap()
}

#[test]
fn seven_policy_operations_match_wire() {
    let s = MockServer::start();
    let f = fixture();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(s.base_url())
        .build()
        .unwrap();
    let rules = client.slack().contact_rules();
    let base = "/api/v1/slack/identities/example-agent/contact-rules";
    let id = f["rule"]["id"].as_str().unwrap();
    let create = s.mock(|w, t| {
        w.method(POST).path(base).json_body(
            json!({"action":"allow","match_type":"exact_user","match_target":"TEXAMPLE:UEXAMPLE"}),
        );
        t.status(200).json_body(f["rule"].clone());
    });
    assert_eq!(
        rules
            .create(
                "@example-agent",
                &CreateSlackContactRuleOptions {
                    action: SlackRuleAction::Allow,
                    match_type: SlackRuleMatchType::ExactUser,
                    match_target: "TEXAMPLE:UEXAMPLE".into(),
                    direction: None
                }
            )
            .unwrap()
            .direction,
        ContactRuleDirection::Both
    );
    create.assert();
    let list = s.mock(|w, t| {
        w.method(GET)
            .path(base)
            .query_param("direction", "inbound")
            .query_param("offset", "0")
            .query_param("limit", "5");
        t.status(200).json_body(json!([f["rule"]]));
    });
    assert_eq!(
        rules
            .list(
                "example-agent",
                &ListSlackContactRulesOptions {
                    direction: Some(ContactRuleDirection::Inbound),
                    offset: Some(0),
                    limit: Some(5),
                    ..Default::default()
                }
            )
            .unwrap()
            .len(),
        1
    );
    list.assert();
    let get = s.mock(|w, t| {
        w.method(GET).path(format!("{base}/{id}"));
        t.status(200).json_body(f["rule"].clone());
    });
    rules.get("example-agent", id).unwrap();
    get.assert();
    let update = s.mock(|w, t| {
        w.method(PATCH)
            .path(format!("{base}/{id}"))
            .json_body(json!({"action":"block","apply_to":"outbound"}));
        t.status(200).json_body(f["rule"].clone());
    });
    rules
        .update(
            "example-agent",
            id,
            &UpdateSlackContactRuleOptions {
                action: Some(SlackRuleAction::Block),
                apply_to: Some(ContactRuleApplyTo::Outbound),
                ..Default::default()
            },
        )
        .unwrap();
    update.assert();
    let settings = s.mock(|w, t| {
        w.method(GET).path(format!("{base}/settings"));
        t.status(200).json_body(f["settings"].clone());
    });
    assert_eq!(
        rules
            .get_settings("example-agent")
            .unwrap()
            .outbound_filter_mode,
        FilterMode::Blacklist
    );
    settings.assert();
    let change = s.mock(|w, t| {
        w.method(PATCH)
            .path(format!("{base}/settings"))
            .json_body(json!({"inbound_filter_mode":"whitelist"}));
        t.status(200).json_body(f["settings"].clone());
    });
    rules
        .update_settings(
            "example-agent",
            &UpdateSlackContactRuleSettings {
                inbound_filter_mode: Some(FilterMode::Whitelist),
                ..Default::default()
            },
        )
        .unwrap();
    change.assert();
    let delete = s.mock(|w, t| {
        w.method(DELETE).path(format!("{base}/{id}"));
        t.status(204);
    });
    rules.delete("example-agent", id).unwrap();
    delete.assert();
    assert!(rules
        .update("example-agent", id, &Default::default())
        .is_err());
    assert!(rules
        .update_settings("example-agent", &Default::default())
        .is_err());
}
#[test]
fn native_slack_and_memory_refs_survive() {
    let f = fixture();
    let item: CorrespondenceItem = serde_json::from_value(f["correspondence"].clone()).unwrap();
    match item {
        CorrespondenceItem::Slack(m) => {
            assert_eq!(m.conversation_id, "CEXAMPLE");
            assert_eq!(m.media.unwrap().count, 1);
        }
        _ => panic!("Wrong channel"),
    }
    let citation: ContactFactCitation = serde_json::from_value(f["citation"].clone()).unwrap();
    assert_eq!(citation.source_type, "slack_message");
    let page: CompanionActivationPage = serde_json::from_value(f["activation"].clone()).unwrap();
    assert_eq!(
        page.reply_context.slack_conversation_id.as_deref(),
        Some("CEXAMPLE")
    );
    assert_eq!(
        page.reply_context.thread_ts.as_deref(),
        Some("1780000000.000001")
    );
    assert!(page.reply_context.connection_id.is_some());
}

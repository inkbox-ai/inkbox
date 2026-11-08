use inkbox::identities::{HostingUpdate, Unset};
use serde_json::json;

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

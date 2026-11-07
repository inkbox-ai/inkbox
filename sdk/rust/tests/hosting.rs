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

use inkbox::phone::{CallConnectionKind, CallConnectionStatus, CallConnectionTrigger, PhoneCall};
use inkbox::webhooks::WebhookPhoneCall;
use serde_json::{json, Value};

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/phone_call_connections.json"
    ))
    .unwrap()
}

#[test]
fn parses_connection_progress_and_legacy_projection() {
    let call: PhoneCall = serde_json::from_value(fixture()).unwrap();
    let connections = call.connections.unwrap();
    assert_eq!(connections[0].kind, CallConnectionKind::Handoff);
    assert_eq!(
        connections[0].trigger,
        CallConnectionTrigger::IncomingAction
    );
    assert_eq!(connections[1].trigger, CallConnectionTrigger::AgentTool);
    assert_eq!(connections[1].status, CallConnectionStatus::Failed);
    assert_eq!(
        connections[1].failure_code.as_deref(),
        Some("destination_rejected")
    );
    assert_eq!(connections[2].kind, CallConnectionKind::Conference);
    assert_eq!(connections[2].status, CallConnectionStatus::Connected);
    assert_eq!(
        connections[2].connected_at.as_deref(),
        Some("2026-10-09T12:02:03Z")
    );
    assert_eq!(
        connections[2].ended_at.as_deref(),
        Some("2026-10-09T12:02:30Z")
    );
    assert_eq!(connections[3].status, CallConnectionStatus::Requested);
    assert!(connections[3].dialing_at.is_none());
    assert_eq!(connections[4].status, CallConnectionStatus::Dialing);
    assert!(connections[4].connected_at.is_none());
    assert_eq!(call.forwardings.len(), 1);
    assert_eq!(
        call.forwardings[0].trigger,
        inkbox::phone::CallForwardingTrigger::IncomingAction
    );
}

#[test]
fn omitted_and_empty_connection_history_remain_distinct() {
    let mut wire = fixture();
    wire.as_object_mut().unwrap().remove("connections");
    let old: PhoneCall = serde_json::from_value(wire.clone()).unwrap();
    assert!(old.connections.is_none());
    wire["connections"] = json!([]);
    let new: PhoneCall = serde_json::from_value(wire).unwrap();
    assert!(new.connections.unwrap().is_empty());
    assert_eq!(new.forwardings.len(), 1);
}

#[test]
fn lifecycle_webhook_preserves_the_same_connection_contract() {
    let call: WebhookPhoneCall = serde_json::from_value(fixture()).unwrap();
    assert_eq!(
        call.connections.unwrap()[2].kind,
        CallConnectionKind::Conference
    );
    let mut old = fixture();
    old.as_object_mut().unwrap().remove("connections");
    let call: WebhookPhoneCall = serde_json::from_value(old).unwrap();
    assert!(call.connections.is_none());
}

#[test]
fn correspondence_keeps_canonical_connections_and_older_response_compatibility() {
    use inkbox::contacts::{CallCorrespondenceItem, CorrespondenceItem};
    let wire = fixture();
    let mut item = json!({
        "channel": "calls", "source_id": wire["id"], "identity_id": "55555555-5555-4555-8555-555555555555",
        "direction": "inbound", "occurred_at": wire["created_at"],
        "remote_phone_number": wire["remote_phone_number"], "connections": wire["connections"],
    });
    let parsed: CorrespondenceItem = serde_json::from_value(item.clone()).unwrap();
    let CorrespondenceItem::Calls(call) = parsed else {
        panic!("Expected call correspondence")
    };
    let connections = call.connections.unwrap();
    assert_eq!(connections.len(), 5);
    assert_eq!(connections[2].kind, CallConnectionKind::Conference);
    assert_eq!(connections[2].status, CallConnectionStatus::Connected);
    item["connections"] = json!([]);
    let empty: CallCorrespondenceItem = serde_json::from_value(item.clone()).unwrap();
    assert!(empty.connections.unwrap().is_empty());
    item.as_object_mut().unwrap().remove("connections");
    let old: CallCorrespondenceItem = serde_json::from_value(item).unwrap();
    assert!(old.connections.is_none());
}

#[test]
fn future_connection_values_are_preserved_without_known_classification() {
    let mut wire = fixture();
    wire["connections"][0]["kind"] = json!("future_kind");
    wire["connections"][0]["trigger"] = json!("future_trigger");
    wire["connections"][0]["status"] = json!("future_status");
    let call: PhoneCall = serde_json::from_value(wire.clone()).unwrap();
    let connection = &call.connections.as_ref().unwrap()[0];
    assert_eq!(
        connection.kind,
        CallConnectionKind::Unknown("future_kind".into())
    );
    assert_eq!(
        connection.trigger,
        CallConnectionTrigger::Unknown("future_trigger".into())
    );
    assert_eq!(
        connection.status,
        CallConnectionStatus::Unknown("future_status".into())
    );
    assert_ne!(connection.kind, CallConnectionKind::Handoff);
    assert_ne!(connection.status, CallConnectionStatus::Connected);
    let roundtrip = serde_json::to_value(connection).unwrap();
    for key in ["kind", "trigger", "status"] {
        assert_eq!(roundtrip[key], wire["connections"][0][key]);
    }
    let webhook: WebhookPhoneCall = serde_json::from_value(wire).unwrap();
    assert_eq!(webhook.connections.unwrap()[0].kind, connection.kind);
    assert!(serde_json::from_value::<CallConnectionKind>(json!(123)).is_err());
}

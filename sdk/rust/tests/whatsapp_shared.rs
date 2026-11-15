use httpmock::prelude::*;
use inkbox::Inkbox;
use serde_json::{json, Value};
use uuid::Uuid;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../../tests/fixtures/whatsapp-shared.json")).unwrap()
}
fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
    Inkbox::builder("test-only")
        .base_url(server.base_url())
        .build()
        .unwrap()
}
#[test]
fn connect_sends_exact_body_and_required_key_without_a_message() {
    let f = fixture();
    let server = MockServer::start();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let recipient = f["recipient_number"].as_str().unwrap();
    let connect = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/connect")
            .header("Idempotency-Key", "connect-1")
            .json_body(json!({"agent_identity_id": owner, "recipient_number": recipient}));
        then.status(201).json_body(f["connect"].clone());
    });
    let result = client(&server)
        .whatsapp()
        .connect(&owner, recipient, "connect-1")
        .unwrap();
    connect.assert();
    assert_eq!(result.assigned_number.as_deref(), Some("+15555550190"));
    assert!(result.awaiting_inbound && !result.already_connected);
    assert_eq!(result.assignment.status, "active");
    assert_eq!(result.assignment.remote_number, recipient);
    for (number, key) in [
        ("+15555550101,+15555550102", "k"),
        ("5555550101", "k"),
        (recipient, ""),
        (recipient, " "),
    ] {
        assert!(client(&server)
            .whatsapp()
            .connect(&owner, number, key)
            .is_err());
        assert!(client(&server)
            .whatsapp()
            .disconnect(&owner, number, key)
            .is_err());
    }
    connect.assert_hits(1);
}
#[test]
fn disconnect_list_and_router_preserve_wire_shapes() {
    let f = fixture();
    let server = MockServer::start();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let recipient = f["recipient_number"].as_str().unwrap();
    let released = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/disconnect")
            .header("Idempotency-Key", "d-1")
            .json_body(json!({"agent_identity_id": owner, "recipient_number": recipient}));
        then.status(200).json_body(f["disconnect"].clone());
    });
    let already = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/disconnect")
            .header("Idempotency-Key", "d-2");
        then.status(200)
            .json_body(f["already_disconnected"].clone());
    });
    let list = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/whatsapp/assignments")
            .query_param("agent_identity_id", owner.to_string());
        then.status(200).json_body(json!([f["assignment"]]));
    });
    let router = server.mock(|when, then| {
        when.method(GET).path("/api/v1/whatsapp/triage-number");
        then.status(200).json_body(f["triage"].clone());
    });
    let whatsapp = client(&server);
    let first = whatsapp
        .whatsapp()
        .disconnect(&owner, recipient, "d-1")
        .unwrap();
    assert_eq!(
        first.assignment_id.unwrap().to_string(),
        f["disconnect"]["assignment_id"].as_str().unwrap()
    );
    assert!(first.disconnected);
    let second = whatsapp
        .whatsapp()
        .disconnect(&owner, recipient, "d-2")
        .unwrap();
    assert!(second.assignment_id.is_none() && second.disconnected);
    let rows = whatsapp.whatsapp().list_connections(Some(&owner)).unwrap();
    assert_eq!(
        rows[0].id.to_string(),
        f["assignment"]["id"].as_str().unwrap()
    );
    let found = whatsapp.whatsapp().get_router().unwrap();
    assert_eq!(
        (found.number.as_str(), found.connect_command.as_str()),
        ("+15555550180", "connect @agent")
    );
    released.assert();
    already.assert();
    list.assert();
    router.assert();
}
#[test]
fn media_upload_forwards_optional_recipient_number() {
    let server = MockServer::start();
    let owner = Uuid::parse_str("10000000-0000-4000-8000-000000000001").unwrap();
    let media = json!({"id": "40000000-0000-4000-8000-000000000004", "filename": "a.png",
        "content_type": "image/png", "size": 3, "status": "ready", "url": null});
    let shared = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/media")
            .query_param("agent_identity_id", owner.to_string())
            .query_param("recipient_number", "+15555550101");
        then.status(201).json_body(media.clone());
    });
    let whatsapp = client(&server);
    whatsapp
        .whatsapp()
        .upload_media_for_recipient(
            b"png".to_vec(),
            "a.png",
            Some("image/png"),
            Some(&owner),
            Some("+15555550101"),
        )
        .unwrap();
    shared.assert();
    assert!(whatsapp
        .whatsapp()
        .upload_media_for_recipient(b"png".to_vec(), "a.png", None, Some(&owner), Some("nope"))
        .is_err());
    shared.assert_hits(1);
}
#[test]
fn reply_before_recipient_message_is_identifiable_and_keeps_its_key() {
    let f = fixture();
    let server = MockServer::start();
    let send = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/messages")
            .header("Idempotency-Key", "reply-1");
        then.status(409)
            .json_body(json!({"detail": f["awaiting_inbound_error"]}));
    });
    let error = client(&server)
        .whatsapp()
        .send(&inkbox::WhatsAppSendOptions {
            to: Some("+15555550101".into()),
            text: Some("Hello".into()),
            idempotency_key: Some("reply-1".into()),
            ..Default::default()
        })
        .unwrap_err();
    assert!(error.is_whatsapp_awaiting_inbound());
    assert_eq!(error.idempotency_key(), Some("reply-1"));
    send.assert_hits(1);
    let other = inkbox::InkboxError::InvalidArgument("x".into());
    assert!(!other.is_whatsapp_awaiting_inbound());
}

#[test]
fn assignment_delete_typing_and_all_read_use_current_wire() {
    let f = fixture();
    let server = MockServer::start();
    let id = Uuid::parse_str(f["assignment"]["id"].as_str().unwrap()).unwrap();
    let conv = Uuid::parse_str(f["connect"]["conversation_id"].as_str().unwrap()).unwrap();
    let owner = Uuid::parse_str(f["identity_id"].as_str().unwrap()).unwrap();
    let delete = server.mock(|when, then| {
        when.method(DELETE)
            .path(format!("/api/v1/whatsapp/assignments/{id}"));
        then.status(204);
    });
    let typing = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/typing")
            .query_param("agent_identity_id", owner.to_string())
            .json_body(json!({"conversation_id": conv}));
        then.json_body(json!({"status":"sent"}));
    });
    let read = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/whatsapp/mark-read")
            .query_param("agent_identity_id", owner.to_string())
            .json_body(json!({"conversation_id":conv}));
        then.json_body(json!({"conversation_id":conv,"updated_count":2,"read_receipts_sent":true}));
    });
    let c = client(&server);
    c.whatsapp().delete_assignment(&id).unwrap();
    c.whatsapp().send_typing(&conv, Some(&owner)).unwrap();
    assert!(
        c.whatsapp()
            .mark_read(&conv, None, Some(&owner))
            .unwrap()
            .read_receipts_sent
    );
    let mut hidden = f["connect"].clone();
    hidden["assigned_number"] = Value::Null;
    assert!(
        serde_json::from_value::<inkbox::WhatsAppConnectResult>(hidden)
            .unwrap()
            .assigned_number
            .is_none()
    );
    delete.assert();
    typing.assert();
    read.assert();
}

#[test]
fn whatsapp_identity_enablement_is_atomic_and_preserves_false() {
    let server = MockServer::start();
    let f = fixture();
    let data = json!({"id":f["identity_id"],"organization_id":"org_example","agent_handle":"agent",
        "created_at":f["assignment"]["created_at"],"updated_at":f["assignment"]["updated_at"]});
    let create = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/identities/")
            .json_body(json!({"agent_handle":"agent","whatsapp_enabled":true}));
        then.json_body(data.clone());
    });
    let update = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/agent")
            .json_body(json!({"whatsapp_enabled":false}));
        then.json_body(data.clone());
    });
    let c = client(&server);
    let identity = c.create_identity_with_whatsapp("agent", true).unwrap();
    identity.set_whatsapp_enabled(false).unwrap();
    create.assert();
    update.assert();
}

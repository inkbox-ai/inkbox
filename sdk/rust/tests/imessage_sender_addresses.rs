use httpmock::prelude::*;
use inkbox::imessage::IMessageReactionType;
use inkbox::webhooks::IMessageWebhookPayload;
use inkbox::{Inkbox, InkboxError};
use serde_json::{json, Value};
use uuid::Uuid;

fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/imessage_sender_addresses.json"
    ))
    .unwrap()
}

#[test]
fn sender_addresses_survive_resource_reads_and_webhook_deserialization() {
    let fixture = fixture();
    for sender in [fixture["sender"].as_str().unwrap(), "+15551234567"] {
        let mut message = fixture["message"].clone();
        message["remote_number"] = json!(sender);
        message["reactions"][0]["remote_number"] = json!(sender);
        let mut conversation = fixture["conversation"].clone();
        conversation["remote_number"] = json!(sender);
        conversation["participants"] = json!([sender]);
        let mut assignment = fixture["assignment"].clone();
        assignment["remote_number"] = json!(sender);
        let message_id = Uuid::parse_str(message["id"].as_str().unwrap()).unwrap();
        let conversation_id = Uuid::parse_str(conversation["id"].as_str().unwrap()).unwrap();
        let server = MockServer::start();
        let routes = [
            (format!("/messages/{message_id}"), message.clone()),
            ("/messages".into(), json!([message])),
            (
                format!("/conversations/{conversation_id}"),
                conversation.clone(),
            ),
            ("/conversations".into(), json!([conversation])),
            ("/assignments".into(), json!([assignment])),
        ];
        let mocks: Vec<_> = routes
            .into_iter()
            .map(|(path, response)| {
                server.mock(|when, then| {
                    when.method(GET).path(format!("/api/v1/imessage{path}"));
                    then.status(200).json_body(response);
                })
            })
            .collect();
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let resource = client.imessages();
        assert_eq!(
            resource
                .get(&message_id, None)
                .unwrap()
                .remote_number
                .as_deref(),
            Some(sender)
        );
        assert_eq!(
            resource
                .list(None, Some(&conversation_id), 50, 0, None, None)
                .unwrap()[0]
                .remote_number
                .as_deref(),
            Some(sender)
        );
        let row = resource.get_conversation(&conversation_id, None).unwrap();
        assert_eq!(row.remote_number.as_deref(), Some(sender));
        assert_eq!(row.participants, Some(vec![sender.into()]));
        let rows = resource.list_conversations(None, 50, 0, None).unwrap();
        assert_eq!(rows[0].remote_number.as_deref(), Some(sender));
        assert_eq!(rows[0].participants, Some(vec![sender.into()]));
        assert_eq!(
            resource.list_assignments(None, 50, 0).unwrap()[0].remote_number,
            sender
        );
        for mock in mocks {
            mock.assert_hits(1);
        }

        let mut webhook = fixture["webhook"].clone();
        webhook["data"]["message"]["remote_number"] = json!(sender);
        webhook["data"]["message"]["reactions"][0]["remote_number"] = json!(sender);
        let payload: IMessageWebhookPayload = serde_json::from_value(webhook).unwrap();
        let received = payload.data.message.unwrap();
        assert_eq!(received.remote_number.as_deref(), Some(sender));
        assert_eq!(received.reactions.unwrap()[0].remote_number, sender);
        assert!(received.sender_number.is_none());
        assert!(!received.is_group);
    }
}

#[test]
fn receive_only_errors_preserve_detail_without_retries() {
    let fixture = fixture();
    let server = MockServer::start();
    let error = server.mock(|when, then| {
        when.any_request();
        then.status(422)
            .json_body(json!({"detail": fixture["error"]}));
    });
    let client = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let conversation = Uuid::parse_str(fixture["conversation"]["id"].as_str().unwrap()).unwrap();
    let message = Uuid::parse_str(fixture["message"]["id"].as_str().unwrap()).unwrap();
    let reaction = Uuid::parse_str("50000000-0000-4000-8000-000000000005").unwrap();
    let resource = client.imessages();
    let results = [
        resource
            .send(None, Some(&conversation), Some("Hello"), None, None, None)
            .map(|_| ()),
        resource
            .send_reaction(&message, IMessageReactionType::Like, 0)
            .map(|_| ()),
        resource.remove_reaction(&reaction),
        resource.mark_conversation_read(&conversation).map(|_| ()),
        resource.send_typing(&conversation),
    ];
    for result in results {
        match result.unwrap_err() {
            InkboxError::Api {
                status_code,
                detail,
                ..
            } => {
                assert_eq!(status_code, 422);
                assert_eq!(detail.as_object(), Some(&fixture["error"]));
            }
            other => panic!("unexpected error: {other}"),
        }
    }
    error.assert_hits(5);
}

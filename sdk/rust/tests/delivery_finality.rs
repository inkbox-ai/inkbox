use inkbox::imessage::{IMessage, IMessageConversationSummary, IMessageRecipient};
use inkbox::phone::{TextConversationSummary, TextMessage, TextMessageRecipient};
use inkbox::webhooks::{
    IMessageRecipientWire, IMessageWebhookMessage, TextMessageRecipientWire, TextWebhookMessage,
};
use serde_json::{json, Value};

fn imessage() -> Value {
    json!({"id": "10000000-0000-0000-0000-000000000001", "conversation_id": "10000000-0000-0000-0000-000000000001",
        "direction": "outbound", "message_type": "message", "service": "sms", "status": "sent",
        "is_read": false, "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"})
}

fn text() -> Value {
    json!({"id": "10000000-0000-0000-0000-000000000001", "direction": "outbound",
        "local_phone_number": "+15557654321", "type": "sms", "origin": "user_initiated",
        "delivery_status": "blocked_spam_filter", "is_read": false,
        "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"})
}

#[test]
fn response_and_webhook_finality_preserve_absent_null_false_and_true() {
    for finality in [
        None,
        Some(Value::Null),
        Some(json!(false)),
        Some(json!(true)),
    ] {
        let mut message = imessage();
        let mut sms = text();
        let mut recipient = json!({"remote_number": "+15551234567"});
        let mut text_recipient = json!({"recipient_phone_number": "+15551234567", "delivery_status": "blocked_spam_filter"});
        let expected = finality.as_ref().and_then(Value::as_bool);
        if let Some(value) = finality {
            for row in [&mut message, &mut sms, &mut recipient, &mut text_recipient] {
                row["delivery_final"] = value.clone();
            }
        }
        assert_eq!(
            serde_json::from_value::<IMessage>(message.clone())
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<IMessageWebhookMessage>(message)
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<TextMessage>(sms.clone())
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<TextWebhookMessage>(sms)
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<IMessageRecipient>(recipient.clone())
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<IMessageRecipientWire>(recipient)
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<TextMessageRecipient>(text_recipient.clone())
                .unwrap()
                .delivery_final,
            expected
        );
        assert_eq!(
            serde_json::from_value::<TextMessageRecipientWire>(text_recipient)
                .unwrap()
                .delivery_final,
            expected
        );
    }
}

#[test]
fn summary_outbound_state_is_independent_of_latest_inbound_message() {
    for finality in [Value::Null, json!(false), json!(true)] {
        let mut row = json!({"id": "10000000-0000-0000-0000-000000000001", "latest_direction": "inbound",
            "latest_type": "sms", "latest_message_at": "2026-01-01T00:00:00Z", "unread_count": 1, "total_count": 2});
        let legacy: IMessageConversationSummary = serde_json::from_value(row.clone()).unwrap();
        assert!(legacy.latest_outbound_service.is_none());
        assert!(legacy.latest_outbound_status.is_none());
        assert!(legacy.latest_outbound_delivery_final.is_none());
        let legacy: TextConversationSummary = serde_json::from_value(row.clone()).unwrap();
        assert!(legacy.latest_outbound_service.is_none());
        assert!(legacy.latest_outbound_status.is_none());
        assert!(legacy.latest_outbound_delivery_final.is_none());
        row["latest_outbound_service"] = json!("rcs");
        row["latest_outbound_status"] = json!("sent");
        row["latest_outbound_delivery_final"] = finality.clone();
        let message: IMessageConversationSummary = serde_json::from_value(row.clone()).unwrap();
        assert_eq!(message.latest_direction.as_deref(), Some("inbound"));
        assert_eq!(message.latest_outbound_delivery_final, finality.as_bool());
        assert_eq!(
            serde_json::to_value(message).unwrap()["latest_outbound_service"],
            "rcs"
        );
        row["latest_outbound_service"] = json!("mms");
        row["latest_outbound_status"] = json!("delivery_unconfirmed");
        let sms: TextConversationSummary = serde_json::from_value(row).unwrap();
        assert_eq!(sms.latest_direction, "inbound");
        assert_eq!(sms.latest_outbound_service.as_deref(), Some("mms"));
        assert_eq!(sms.latest_outbound_delivery_final, finality.as_bool());
    }
}

#[test]
fn legacy_downgrade_is_not_inferred_from_service() {
    let mut row = imessage();
    assert!(serde_json::from_value::<IMessage>(row.clone())
        .unwrap()
        .was_downgraded
        .is_none());
    row["was_downgraded"] = json!(false);
    row["delivery_final"] = json!(false);
    row["recipients"] = json!([{"remote_number": "+15551234567", "delivery_final": true}]);
    let message: IMessage = serde_json::from_value(row.clone()).unwrap();
    assert_eq!(message.was_downgraded, Some(false));
    assert_eq!(message.delivery_final, Some(false));
    assert_eq!(message.recipients.unwrap()[0].delivery_final, Some(true));
    let webhook: IMessageWebhookMessage = serde_json::from_value(row).unwrap();
    assert_eq!(webhook.delivery_final, Some(false));
    assert_eq!(webhook.recipients.unwrap()[0].delivery_final, Some(true));
}

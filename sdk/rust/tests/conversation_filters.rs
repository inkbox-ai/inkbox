use httpmock::prelude::*;
use inkbox::{ConversationParticipantFilter, DateRangeFilter, Inkbox};
use serde_json::json;
use uuid::Uuid;

#[test]
fn participant_lists_are_repeated_query_parameters_in_every_channel() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let participants = ConversationParticipantFilter::Participants(vec![
        "guest@example.com".into(),
        "+14155550123".into(),
    ]);
    let mail = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/mail/mailboxes/agent@example.com/threads")
            .query_param("participants", "guest@example.com")
            .query_param("participants", "+14155550123");
        then.status(200)
            .json_body(json!({"items":[],"has_more":false}));
    });
    client
        .threads()
        .list_matching("agent@example.com", None, None, Some(&participants))
        .unwrap();
    mail.assert();
    let sms = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/phone/numbers/number/texts/conversations")
            .query_param("participants", "guest@example.com")
            .query_param("participants", "+14155550123");
        then.status(200).json_body(json!([]));
    });
    client
        .texts()
        .list_conversations_matching(
            "number",
            50,
            0,
            None,
            true,
            &DateRangeFilter::default(),
            Some(&participants),
        )
        .unwrap();
    sms.assert();
    let imessage = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/imessage/conversations")
            .query_param("participants", "guest@example.com")
            .query_param("participants", "+14155550123");
        then.status(200).json_body(json!([]));
    });
    client
        .imessages()
        .list_conversations_matching(
            None,
            50,
            0,
            None,
            &DateRangeFilter::default(),
            true,
            Some(&participants),
        )
        .unwrap();
    imessage.assert();
}

#[test]
fn contact_selector_and_empty_participants_are_unambiguous() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let id = Uuid::parse_str("aaaaaaaa-1111-4111-8111-111111111111").unwrap();
    let query = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/imessage/conversations")
            .query_param("contact_id", id.to_string());
        then.status(200).json_body(json!([]));
    });
    client
        .imessages()
        .list_conversations_matching(
            None,
            50,
            0,
            None,
            &DateRangeFilter::default(),
            false,
            Some(&ConversationParticipantFilter::ContactId(id)),
        )
        .unwrap();
    query.assert();
    assert!(client
        .imessages()
        .list_conversations_matching(
            None,
            50,
            0,
            None,
            &DateRangeFilter::default(),
            false,
            Some(&ConversationParticipantFilter::Participants(vec![]))
        )
        .is_err());
    query.assert_hits(1);
}

#[test]
fn whatsapp_selectors_preserve_scope_pagination_and_repeated_values() {
    let server = MockServer::start();
    let client = Inkbox::builder("synthetic-test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let identity = Uuid::parse_str("aaaaaaaa-1111-4111-8111-111111111111").unwrap();
    let options = inkbox::whatsapp::WhatsAppListOptions {
        agent_identity_id: Some(identity),
        limit: Some(12),
        offset: Some(7),
        ..Default::default()
    };
    for selector in [
        ConversationParticipantFilter::Participants(vec![
            "+14155550123".into(),
            "+14155550124".into(),
        ]),
        ConversationParticipantFilter::ContactId(identity),
    ] {
        let request = server.mock(|when, then| {
            let when = when
                .method(GET)
                .path("/api/v1/whatsapp/conversations")
                .query_param("agent_identity_id", identity.to_string())
                .query_param("limit", "12")
                .query_param("offset", "7");
            match &selector {
                ConversationParticipantFilter::Participants(values) => {
                    when.query_param("participants", &values[0])
                        .query_param("participants", &values[1]);
                }
                ConversationParticipantFilter::ContactId(id) => {
                    when.query_param("contact_id", id.to_string());
                }
            }
            then.status(200).json_body(json!([]));
        });
        client
            .whatsapp()
            .list_conversations_matching(&options, Some(&selector))
            .unwrap();
        request.assert();
    }
}

use inkbox::imessage::types::IMessageContactRule;
use inkbox::mail::types::MailIdentityContactRule;
use inkbox::phone::types::PhoneIdentityContactRule;
use serde_json::json;

#[test]
fn rule_contacts_accept_absent_null_and_populated_cards() {
    for channel in ["mail", "phone", "imessage"] {
        for shape in ["absent", "null", "card"] {
            let mut payload = json!({
                "id": "11111111-1111-4111-8111-111111111111",
                "agent_identity_id": "22222222-2222-4222-8222-222222222222",
                "action": "allow", "status": "active",
                "match_type": if channel == "mail" { "exact_email" } else { "exact_number" },
                "match_target": if channel == "mail" { "person@example.com" } else { "+14155550123" },
                "created_at": "2026-09-05T00:00:00Z", "updated_at": "2026-09-05T00:00:00Z"
            });
            if shape == "null" {
                payload["contact"] = json!(null);
            } else if shape == "card" {
                payload["contact"] = json!({
                    "id": "33333333-3333-4333-8333-333333333333", "preferred_name": "Person",
                    "emails": [{"value": "person@example.com", "is_primary": true}],
                    "created_at": "2026-09-05T00:00:00Z", "updated_at": "2026-09-05T00:00:00Z"
                });
            }
            let contact = match channel {
                "mail" => {
                    serde_json::from_value::<MailIdentityContactRule>(payload)
                        .unwrap()
                        .contact
                }
                "phone" => {
                    serde_json::from_value::<PhoneIdentityContactRule>(payload)
                        .unwrap()
                        .contact
                }
                _ => {
                    serde_json::from_value::<IMessageContactRule>(payload)
                        .unwrap()
                        .contact
                }
            };
            if shape == "card" {
                let card = contact.unwrap();
                assert_eq!(card.preferred_name.as_deref(), Some("Person"));
                assert_eq!(card.emails[0].value, "person@example.com");
            } else {
                assert!(contact.is_none());
            }
        }
    }
}

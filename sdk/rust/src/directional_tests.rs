use crate::{
    ContactRuleApplyTo, ContactRuleCreateOptions, ContactRuleDirection, ContactRuleListOptions,
    ContactRuleUpdateOptions, Inkbox, InkboxError,
};
use httpmock::prelude::*;
use serde_json::{json, Value};

const ID: &str = "11111111-1111-4111-8111-111111111111";

fn rule(match_type: &str, direction: Option<&str>) -> Value {
    let mut value = json!({
        "id": ID, "agent_identity_id": ID, "mailbox_id": ID, "phone_number_id": ID,
        "action": "allow", "match_type": match_type, "match_target": "x@example.com",
        "status": "active", "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
    });
    if let Some(direction) = direction {
        value["direction"] = json!(direction);
    }
    value
}

macro_rules! rule_resource_test {
    ($name:ident, $resource:ident, $base:literal, $org:literal, $action:expr, $match:expr, $wire:literal) => {
        #[test]
        #[allow(deprecated)]
        fn $name() {
            let server = MockServer::start();
            let create = server.mock(|when, then| {
                when.method(POST).path($base).json_body(json!({"action":"allow","match_type":$wire,"match_target":"x@example.com","direction":"outbound"}));
                then.status(201).json_body(rule($wire, Some("both")));
            });
            let legacy_shape = server.mock(|when, then| {
                when.method(POST).path($base).json_body(json!({"action":"allow","match_type":$wire,"match_target":"x@example.com"}));
                then.status(201).json_body(rule($wire, None));
            });
            let list = server.mock(|when, then| {
                when.method(GET).path($base).query_param("direction", "inbound").query_param("action", "allow").query_param("match_type", $wire).query_param("limit", "2").query_param("offset", "1");
                then.status(200).json_body(json!({"items":[rule($wire, Some("both")), rule($wire, Some("inbound"))]}));
            });
            let all = server.mock(|when, then| {
                when.method(GET).path($org).query_param("direction", "inbound");
                then.status(200).json_body(json!([rule($wire, Some("both"))]));
            });
            let get = server.mock(|when, then| {
                when.method(GET).path(format!("{}/{ID}", $base));
                then.status(200).json_body(rule($wire, Some("outbound")));
            });
            let patch = server.mock(|when, then| {
                when.method(httpmock::Method::PATCH).path(format!("{}/{ID}", $base)).json_body(json!({"direction":"inbound"}));
                then.status(200).json_body(rule($wire, Some("inbound")));
            });
            let split = server.mock(|when, then| {
                when.method(httpmock::Method::PATCH).path(format!("{}/{ID}", $base)).json_body(json!({"action":"allow","apply_to":"outbound"}));
                then.status(200).json_body(rule($wire, Some("outbound")));
            });
            let legacy_patch = server.mock(|when, then| {
                when.method(httpmock::Method::PATCH).path(format!("{}/{ID}", $base)).json_body(json!({"action":"allow"}));
                then.status(200).json_body(rule($wire, Some("both")));
            });
            let sdk = Inkbox::builder("test-key").base_url(server.base_url()).build().unwrap();
            let resource = sdk.$resource();
            let mut options = ContactRuleCreateOptions { action: $action, match_type: $match, match_target: "x@example.com".into(), direction: Some(ContactRuleDirection::Outbound) };
            let saved = resource.create_with_options("agent", &options).unwrap();
            assert_eq!(saved.id.to_string(), ID);
            assert_eq!(saved.direction, ContactRuleDirection::Both);
            options.direction = None;
            assert_eq!(resource.create_with_options("agent", &options).unwrap().direction, ContactRuleDirection::Both);
            let list_options = ContactRuleListOptions { direction: Some(ContactRuleDirection::Inbound), action: Some($action), match_type: Some($match), limit: Some(2), offset: Some(1) };
            assert_eq!(resource.list_with_options("agent", &list_options).unwrap().len(), 2);
            assert_eq!(resource.list_all_with_options(None, &list_options).unwrap().len(), 1);
            assert_eq!(resource.get_with_options("agent", ID).unwrap().direction, ContactRuleDirection::Outbound);
            assert_eq!(resource.update_with_options("agent", ID, &ContactRuleUpdateOptions { direction: Some(ContactRuleDirection::Inbound), ..Default::default() }).unwrap().direction, ContactRuleDirection::Inbound);
            resource.update_with_options("agent", ID, &ContactRuleUpdateOptions { action: Some($action), apply_to: Some(ContactRuleApplyTo::Outbound), ..Default::default() }).unwrap();
            resource.update("agent", ID, $action).unwrap();
            for options in [ContactRuleUpdateOptions::default(), ContactRuleUpdateOptions { action: None, direction: None, apply_to: Some(ContactRuleApplyTo::Inbound) }, ContactRuleUpdateOptions { action: Some($action), direction: Some(ContactRuleDirection::Both), apply_to: Some(ContactRuleApplyTo::Inbound) }] {
                assert!(matches!(resource.update_with_options("agent", ID, &options), Err(InkboxError::InvalidArgument(_))));
            }
            for mock in [create, legacy_shape, list, all, get, patch, split, legacy_patch] { mock.assert(); }
        }
    };
}

rule_resource_test!(
    mail_identity_rules,
    mail_identity_contact_rules,
    "/api/v1/identities/agent/mail-contact-rules",
    "/api/v1/mail/contact-rules",
    crate::mail::types::MailRuleAction::Allow,
    crate::mail::types::MailRuleMatchType::ExactEmail,
    "exact_email"
);
rule_resource_test!(
    mail_legacy_rules,
    mail_contact_rules,
    "/api/v1/mail/mailboxes/agent/contact-rules",
    "/api/v1/mail/contact-rules",
    crate::mail::types::MailRuleAction::Allow,
    crate::mail::types::MailRuleMatchType::ExactEmail,
    "exact_email"
);
rule_resource_test!(
    phone_identity_rules,
    phone_identity_contact_rules,
    "/api/v1/identities/agent/phone-contact-rules",
    "/api/v1/phone/contact-rules",
    crate::phone::types::PhoneRuleAction::Allow,
    crate::phone::types::PhoneRuleMatchType::ExactNumber,
    "exact_number"
);
rule_resource_test!(
    phone_legacy_rules,
    phone_contact_rules,
    "/api/v1/phone/numbers/agent/contact-rules",
    "/api/v1/phone/contact-rules",
    crate::phone::types::PhoneRuleAction::Allow,
    crate::phone::types::PhoneRuleMatchType::ExactNumber,
    "exact_number"
);
rule_resource_test!(
    imessage_rules,
    imessage_contact_rules,
    "/api/v1/imessage/identities/agent/contact-rules",
    "/api/v1/imessage/contact-rules",
    crate::imessage::types::IMessageRuleAction::Allow,
    crate::imessage::types::IMessageRuleMatchType::ExactNumber,
    "exact_number"
);

pub(crate) fn identity() -> Value {
    json!({"id": ID, "organization_id":"org_example", "agent_handle":"agent", "created_at":"2026-01-01T00:00:00Z", "updated_at":"2026-01-01T00:00:00Z", "mail_filter_mode":"whitelist", "phone_filter_mode":"whitelist"})
}

#[test]
fn identity_modes_fallback_and_updates_are_directional() {
    use crate::identities::{DirectionalAgentIdentityData, IdentityFilterModeOptions};
    use crate::mail::types::FilterMode::{Blacklist, Whitelist};
    let old: DirectionalAgentIdentityData = serde_json::from_value(identity()).unwrap();
    assert_eq!(
        (
            old.mail_inbound_filter_mode,
            old.mail_outbound_filter_mode,
            old.phone_inbound_filter_mode,
            old.phone_outbound_filter_mode
        ),
        (Whitelist, Whitelist, Whitelist, Whitelist)
    );
    let mut split = identity();
    split["mail_inbound_filter_mode"] = json!("blacklist");
    let server = MockServer::start();
    let get = server.mock(|when, then| {
        when.method(GET).path("/api/v1/identities/agent");
        then.status(200).json_body(identity());
    });
    let patch = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/agent")
            .json_body(
                json!({"mail_inbound_filter_mode":"blacklist", "phone_filter_mode":"whitelist"}),
            );
        then.status(200).json_body(split.clone());
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let agent = sdk.get_identity("agent").unwrap();
    let result = agent
        .update_filter_modes(&IdentityFilterModeOptions {
            mail_inbound_filter_mode: Some(Blacklist),
            phone_filter_mode: Some(Whitelist),
            ..Default::default()
        })
        .unwrap();
    assert_eq!(result.mail_inbound_filter_mode, Blacklist);
    assert_eq!(result.mail_outbound_filter_mode, Whitelist);
    assert_eq!(result.mail_filter_mode, Whitelist);
    for options in [
        IdentityFilterModeOptions {
            mail_filter_mode: Some(Whitelist),
            mail_inbound_filter_mode: Some(Blacklist),
            ..Default::default()
        },
        IdentityFilterModeOptions {
            imessage_filter_mode: Some(Whitelist),
            phone_outbound_filter_mode: Some(Blacklist),
            ..Default::default()
        },
        IdentityFilterModeOptions {
            imessage_filter_mode: Some(Whitelist),
            phone_filter_mode: Some(Blacklist),
            ..Default::default()
        },
    ] {
        assert!(matches!(
            agent.update_filter_modes(&options),
            Err(InkboxError::InvalidArgument(_))
        ));
    }
    get.assert();
    patch.assert();
}

#[test]
fn contact_access_preserves_receive_only_and_partial_requests() {
    use crate::contacts::*;
    let body = json!({"email":{"visible":true,"contactable":[],"inbound_contactable":["x@example.com"],"outbound_contactable":[]}, "phone":{"visible":false,"contactable":[]},"profile":true,"memories":false});
    let server = MockServer::start();
    let patch = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/agent/contacts/contact/access")
            .json_body(json!({"email":{"inbound_contactable":[]}}));
        then.status(200).json_body(body.clone());
    });
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/contacts/with-permissions").json_body(json!({"given_name":"Example","permissions":{"identity_id":ID,"email":{"inbound_contactable":[]}}}));
        then.status(201).json_body(json!({"id":ID,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}));
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let options = UpdateDirectionalContactAccess {
        email: Some(DirectionalContactChannelAccessUpdate {
            inbound_contactable: Some(vec![]),
            ..Default::default()
        }),
        ..Default::default()
    };
    let result = sdk
        .contacts()
        .access()
        .update_with_options("agent", "contact", &options)
        .unwrap();
    assert_eq!(result.email.inbound_contactable, ["x@example.com"]);
    assert!(result.email.contactable.is_empty());
    assert!(result.email.outbound_contactable.is_empty());
    assert!(result.phone.inbound_contactable.is_empty());
    sdk.contacts()
        .create_with_access_options(
            &CreateContactParams {
                given_name: Some("Example".into()),
                ..Default::default()
            },
            Some(&DirectionalContactCreatePermissions {
                identity_id: ID.parse().unwrap(),
                access: options,
            }),
        )
        .unwrap();
    for group in [
        DirectionalContactChannelAccessUpdate {
            contactable: Some(vec![]),
            inbound_contactable: Some(vec![]),
            ..Default::default()
        },
        DirectionalContactChannelAccessUpdate {
            visible: Some(false),
            outbound_contactable: Some(vec!["x@example.com".into()]),
            ..Default::default()
        },
    ] {
        assert!(matches!(
            sdk.contacts().access().update_with_options(
                "agent",
                "contact",
                &UpdateDirectionalContactAccess {
                    email: Some(group),
                    ..Default::default()
                }
            ),
            Err(InkboxError::InvalidArgument(_))
        ));
    }
    let old: DirectionalContactChannelAccess =
        serde_json::from_value(json!({"visible":true,"contactable":["x@example.com"]})).unwrap();
    assert_eq!(old.inbound_contactable, old.outbound_contactable);
    patch.assert();
    create.assert();
}

#[test]
fn duplicate_and_uncovered_side_errors_keep_their_variants() {
    let server = MockServer::start();
    let duplicate = server.mock(|when, then| {
        when.method(POST)
            .path("/api/v1/identities/agent/mail-contact-rules");
        then.status(409).json_body(
            json!({"detail":{"existing_rule_id":ID},"agent_support":"Support information"}),
        );
    });
    let uncovered = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path(format!("/api/v1/identities/agent/mail-contact-rules/{ID}"));
        then.status(422)
            .json_body(json!({"detail":"Rule does not cover that direction"}));
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let resource = sdk.mail_identity_contact_rules();
    let error = resource
        .create_with_options(
            "agent",
            &ContactRuleCreateOptions {
                action: crate::mail::types::MailRuleAction::Allow,
                match_type: crate::mail::types::MailRuleMatchType::ExactEmail,
                match_target: "x@example.com".into(),
                direction: None,
            },
        )
        .unwrap_err();
    assert!(
        matches!(&error, InkboxError::DuplicateContactRule { existing_rule_id, .. } if existing_rule_id.to_string() == ID)
    );
    assert_eq!(error.agent_support(), Some("Support information"));
    assert!(matches!(
        resource.update_with_options(
            "agent",
            ID,
            &ContactRuleUpdateOptions {
                action: Some(crate::mail::types::MailRuleAction::Allow),
                direction: None,
                apply_to: Some(ContactRuleApplyTo::Inbound)
            }
        ),
        Err(InkboxError::Api {
            status_code: 422,
            ..
        })
    ));
    duplicate.assert();
    uncovered.assert();
}

#[test]
fn directional_boolean_permissions_preserve_omission_and_creation() {
    use crate::contacts::*;
    use std::collections::HashMap;
    let server = MockServer::start();
    let response = json!({"emails":{"x@example.com":false},"phones":{},"profile":true,"memories":false,"inbound_emails":{"x@example.com":true},"outbound_emails":{"x@example.com":false}});
    let get = server.mock(|when, then| {
        when.method(GET)
            .path("/api/v1/identities/agent/contacts/contact/permissions");
        then.status(200).json_body(response.clone());
    });
    let patch = server.mock(|when, then| {
        when.method(httpmock::Method::PATCH)
            .path("/api/v1/identities/agent/contacts/contact/permissions")
            .json_body(json!({"inbound_emails":{"x@example.com":false}}));
        then.status(200).json_body(response.clone());
    });
    let create = server.mock(|when, then| {
        when.method(POST).path("/api/v1/contacts/with-permissions").json_body(json!({"permissions":{"identity_id":ID,"inbound_emails":{"x@example.com":false}}}));
        then.status(201).json_body(json!({"id":ID,"created_at":"2026-01-01T00:00:00Z","updated_at":"2026-01-01T00:00:00Z"}));
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let data = sdk
        .contacts()
        .permissions()
        .get_with_options("agent", "contact")
        .unwrap();
    assert!(data.inbound_emails["x@example.com"]);
    assert!(!data.outbound_emails["x@example.com"]);
    assert!(!data.emails["x@example.com"]);
    let mut options = UpdateDirectionalContactPermissions {
        inbound_emails: Some(HashMap::from([("x@example.com".into(), false)])),
        ..Default::default()
    };
    sdk.contacts()
        .permissions()
        .update_with_options("agent", "contact", &options)
        .unwrap();
    sdk.contacts()
        .create_with_permission_options(
            &CreateContactParams::default(),
            &DirectionalContactInitialPermissions {
                identity_id: ID.parse().unwrap(),
                permissions: options.clone(),
            },
        )
        .unwrap();
    options.permissions.emails = Some(HashMap::new());
    assert!(matches!(
        sdk.contacts()
            .permissions()
            .update_with_options("agent", "contact", &options),
        Err(InkboxError::InvalidArgument(_))
    ));
    let old: DirectionalContactPermissions = serde_json::from_value(
        json!({"emails":{"x@example.com":true},"phones":{},"profile":true,"memories":false}),
    )
    .unwrap();
    assert_eq!(old.inbound_emails, old.outbound_emails);
    for mock in [get, patch, create] {
        mock.assert();
    }
}

#[test]
fn pair_aware_policy_edits_and_preview_decoders_preserve_both_sides() {
    use crate::contacts::*;
    let server = MockServer::start();
    let policy = json!({"contact_id":ID,"identity_id":ID,"revision":4,"addresses":[{"kind":"email","value":"x@example.com","label":null,"action":"block","allowed":false,"inbound_action":"allow","outbound_action":"block","allowed_inbound":true,"allowed_outbound":false}],"effective_visibility":{"profile":true,"memories":false},"visibility":{"defaults":{"profile":"allow","memories":"block"},"identities":[]}});
    let put = server.mock(|when, then| {
        when.method(PUT).path("/api/v1/contacts/contact/communication-policy").json_body(json!({"expected_revision":3,"identity_id":ID,"addresses":[{"kind":"email","value":"x@example.com","action":"allow","direction":"both","expected_inbound_action":"allow","expected_outbound_action":"block"}]}));
        then.status(200).json_body(policy.clone());
    });
    let sdk = Inkbox::builder("test-key")
        .base_url(server.base_url())
        .build()
        .unwrap();
    let result = sdk
        .contacts()
        .communication_policy()
        .replace_with_options(
            "contact",
            &ReplaceDirectionalContactCommunicationPolicy {
                expected_revision: 3,
                identity_id: ID.parse().unwrap(),
                visibility: None,
                addresses: vec![DirectionalContactAddressUpdate {
                    kind: ContactAddressKind::Email,
                    value: "x@example.com".into(),
                    action: ContactDecision::Allow,
                    direction: Some(ContactRuleDirection::Both),
                    expected_action: None,
                    expected_inbound_action: Some(ContactDecision::Allow),
                    expected_outbound_action: Some(ContactDecision::Block),
                }],
            },
        )
        .unwrap();
    assert!(result.addresses[0].allowed_inbound);
    assert!(!result.addresses[0].allowed_outbound);
    assert_eq!(result.addresses[0].inbound_action, ContactDecision::Allow);
    let preview: DirectionalContactCommunicationPreview = serde_json::from_value(json!({"identity_id":ID,"contact":null,"email":false,"phone":false,"full_profile":true,"visibility":{"profile":true,"memories":false},"inbound_email":true,"outbound_email":false})).unwrap();
    assert_eq!(preview.inbound_email, Some(true));
    assert_eq!(preview.outbound_email, Some(false));
    assert_eq!(preview.inbound_phone, None);
    assert_eq!(preview.outbound_phone, None);
    let legacy_preview: DirectionalContactCommunicationPreview = serde_json::from_value(json!({"identity_id":ID,"contact":null,"email":true,"phone":true,"full_profile":true,"visibility":{"profile":true,"memories":false}})).unwrap();
    assert_eq!(legacy_preview.inbound_email, None);
    assert_eq!(legacy_preview.outbound_email, None);
    assert_eq!(legacy_preview.inbound_phone, None);
    assert_eq!(legacy_preview.outbound_phone, None);
    let effective: DirectionalContactPermissionEffective = serde_json::from_value(json!({"email":"none","phone":"no_identifiers","profile":true,"memories":false,"inbound_email":"all","outbound_email":"none"})).unwrap();
    assert_eq!(effective.inbound_email, IdentifierPermission::All);
    assert_eq!(effective.outbound_email, IdentifierPermission::None);
    put.assert();
}

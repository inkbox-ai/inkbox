//! Literal construction and positional calls supported before directional APIs.

use inkbox::{
    contacts::*,
    identities::*,
    imessage::types::{IMessageContactRule, IMessageRuleAction, IMessageRuleMatchType},
    mail::types::*,
    phone::types::{
        PhoneContactRule, PhoneIdentityContactRule, PhoneRuleAction, PhoneRuleMatchType,
    },
    Inkbox,
};
use uuid::Uuid;

#[test]
fn legacy_response_literals_remain_constructible() {
    let id = Uuid::nil();
    let mailbox = IdentityMailbox {
        signature_html: None,
        signature_text: None,
        signature_enabled: false,
        id,
        email_address: "x@example.com".into(),
        filter_mode: FilterMode::Whitelist,
        created_at: String::new(),
        updated_at: String::new(),
        sending_domain: "example.com".into(),
        agent_identity_id: None,
        filter_mode_change_notice: None,
    };
    let phone_number = IdentityPhoneNumber {
        id,
        number: "+15555550123".into(),
        r#type: "local".into(),
        status: "active".into(),
        sms_status: inkbox::phone::types::SmsStatus::Ready,
        incoming_call_action: "auto_reject".into(),
        client_websocket_url: None,
        incoming_call_webhook_url: None,
        forwarding_target_type: None,
        forwarding_phone_number: None,
        forwarding_sip_uri: None,
        filter_mode: FilterMode::Whitelist,
        created_at: String::new(),
        updated_at: String::new(),
        sms_error_code: None,
        sms_error_detail: None,
        sms_ready_at: None,
        state: None,
        country: "US".into(),
        agent_identity_id: None,
        filter_mode_change_notice: None,
    };
    let summary = AgentIdentitySummary {
        id,
        organization_id: "org_example".into(),
        agent_handle: "example".into(),
        display_name: None,
        description: None,
        email_address: None,
        created_at: String::new(),
        updated_at: String::new(),
        imessage_enabled: false,
        contact_sharing_enabled: true,
        imessage_filter_mode: FilterMode::Whitelist,
        mail_filter_mode: FilterMode::Whitelist,
        phone_filter_mode: FilterMode::Whitelist,
        signing_key_configured: false,
        signing_key_created_at: None,
        mailbox: Some(mailbox),
        phone_number: Some(phone_number),
        imessage_number: None,
        tunnel: None,
    };
    let _ = AgentIdentityData { summary };
    let _ = MailContactRule {
        id,
        mailbox_id: id,
        action: MailRuleAction::Allow,
        match_type: MailRuleMatchType::ExactEmail,
        match_target: "x@example.com".into(),
        status: ContactRuleStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let _ = MailIdentityContactRule {
        contact: None,
        id,
        agent_identity_id: id,
        action: MailRuleAction::Allow,
        match_type: MailRuleMatchType::ExactEmail,
        match_target: "x@example.com".into(),
        status: ContactRuleStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let _ = PhoneContactRule {
        id,
        phone_number_id: id,
        action: PhoneRuleAction::Allow,
        match_type: PhoneRuleMatchType::ExactNumber,
        match_target: "+15555550123".into(),
        status: inkbox::phone::types::ContactRuleStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let _ = PhoneIdentityContactRule {
        contact: None,
        id,
        agent_identity_id: id,
        action: PhoneRuleAction::Allow,
        match_type: PhoneRuleMatchType::ExactNumber,
        match_target: "+15555550123".into(),
        status: inkbox::phone::types::ContactRuleStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let _ = IMessageContactRule {
        contact: None,
        id,
        agent_identity_id: id,
        action: IMessageRuleAction::Allow,
        match_type: IMessageRuleMatchType::ExactNumber,
        match_target: "+15555550123".into(),
        status: inkbox::imessage::types::ContactRuleStatus::Active,
        created_at: String::new(),
        updated_at: String::new(),
    };
    let channel = ContactChannelAccess {
        visible: true,
        contactable: vec![],
    };
    let _ = ContactAccessSettings {
        email: channel.clone(),
        phone: channel,
        profile: true,
        memories: false,
    };
    let group = ContactChannelAccessUpdate {
        visible: None,
        contactable: Some(vec![]),
    };
    let _ = UpdateContactAccess {
        email: Some(group.clone()),
        phone: None,
        profile: None,
        memories: None,
    };
    let _ = ContactCreatePermissions {
        identity_id: id,
        emails: None,
        phones: None,
        profile: None,
        memories: None,
        email: Some(group),
        phone: None,
    };
    let _ = ContactAddressPermission {
        kind: ContactAddressKind::Email,
        value: "x@example.com".into(),
        label: None,
        action: ContactDecision::Allow,
        allowed: true,
    };
    let _ = ContactAddressUpdate {
        kind: ContactAddressKind::Email,
        value: "x@example.com".into(),
        action: ContactDecision::Allow,
        expected_action: ContactDecision::Inherit,
    };
    let _ = ContactPermissions {
        emails: Default::default(),
        phones: Default::default(),
        profile: true,
        memories: false,
    };
    let _ = inkbox::http::BinaryResponse {
        bytes: vec![],
        filename: None,
        content_type: None,
    };
    let _ = inkbox::InkboxError::DuplicateContactRule {
        status_code: 409,
        existing_rule_id: id,
        detail: Box::new(serde_json::Value::Null),
        agent_support: None,
    };
}

#[allow(dead_code, deprecated)]
fn legacy_positional_calls(client: &Inkbox, agent: &inkbox::AgentIdentity) -> inkbox::Result<()> {
    let mail = client.mail_contact_rules();
    mail.create(
        "x@example.com",
        MailRuleAction::Allow,
        MailRuleMatchType::ExactEmail,
        "y@example.com",
    )?;
    mail.update("x@example.com", "rule", MailRuleAction::Block)?;
    mail.list("x@example.com", None, None, None, None)?;
    mail.list_all(None, None, None, None, None)?;
    mail.get("x@example.com", "rule")?;
    let phone = client.phone_contact_rules();
    phone.create(
        "number",
        PhoneRuleAction::Allow,
        "+15555550123",
        PhoneRuleMatchType::ExactNumber,
    )?;
    phone.update("number", "rule", PhoneRuleAction::Block)?;
    phone.list("number", None, None, None, None)?;
    phone.list_all(None, None, None, None, None)?;
    phone.get("number", "rule")?;
    client.mail_identity_contact_rules().create(
        "agent",
        MailRuleAction::Allow,
        MailRuleMatchType::ExactEmail,
        "x@example.com",
    )?;
    client.phone_identity_contact_rules().create(
        "agent",
        PhoneRuleAction::Allow,
        "+15555550123",
        PhoneRuleMatchType::ExactNumber,
    )?;
    client.imessage_contact_rules().create(
        "agent",
        IMessageRuleAction::Allow,
        "+15555550123",
        IMessageRuleMatchType::ExactNumber,
    )?;
    agent.list_mail_contact_rules(None, None, None, None)?;
    agent.list_phone_contact_rules(None, None, None, None)?;
    client.identities().update(
        "agent",
        None,
        Unset::Omit,
        Unset::Omit,
        None,
        None,
        None,
        None,
    )?;
    client.contacts().access().get("agent", "contact")?;
    client
        .contacts()
        .access()
        .update("agent", "contact", &UpdateContactAccess::default())?;
    Ok(())
}

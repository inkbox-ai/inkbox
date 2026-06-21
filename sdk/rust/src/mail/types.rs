//! Structs/enums mirroring the Inkbox Mail API response models.
//!
//! Field names are already snake_case and match the wire JSON, so no rename is
//! needed. Timestamps arrive as ISO-8601 strings and are kept as `String`
//! (the Python parses them into `datetime`; we leave them as the raw wire
//! value per the porting contract). Enum string values match the Python
//! `StrEnum` `.value`s exactly.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

/// Whether a message was received by or sent from a mailbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MessageDirection {
    /// Email received from an external sender.
    Inbound,
    /// Email sent by the mailbox.
    Outbound,
}

/// Strategy for embedding the original message in a forward.
///
/// `Inline` renders the original body inline below a Gmail-style preamble; it
/// may not perfectly preserve inline images or complex layouts. `Wrapped`
/// attaches the original raw MIME as a single `message/rfc822` part —
/// semantically preserved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ForwardMode {
    Inline,
    Wrapped,
}

/// Contact-rule filter mode on a mailbox or phone number.
///
/// `Whitelist` delivers only contacts matching an `allow` rule; everything
/// else is blocked. `Blacklist` delivers everything except contacts matching a
/// `block` rule — this is the default.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FilterMode {
    Whitelist,
    Blacklist,
}

/// Logical folder a thread lives in.
///
/// `Blocked` is server-assigned; clients cannot move a thread into `Blocked`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ThreadFolder {
    Inbox,
    Spam,
    Blocked,
    Archive,
}

/// Whether a matching address is allowed through or blocked.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MailRuleAction {
    Allow,
    Block,
}

/// What a mail contact rule matches on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MailRuleMatchType {
    #[serde(rename = "exact_email")]
    ExactEmail,
    #[serde(rename = "domain")]
    Domain,
}

/// Whether a contact rule is currently enforced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactRuleStatus {
    Active,
    Paused,
}

/// Lifecycle status of a custom sending domain.
///
/// Only `Verified` rows are usable for sending; the remaining states are
/// transitional (`NotStarted`, `AwaitingOwnership`, `Pending`, `Verifying`),
/// recoverable error states (`DnsInvalid`, `Degraded`), in-flight admin
/// operations (`PendingDkimRotation`, `PendingDeletion`), or terminal
/// (`Failed`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SendingDomainStatus {
    NotStarted,
    AwaitingOwnership,
    Pending,
    DnsInvalid,
    Verifying,
    Verified,
    Failed,
    PendingDkimRotation,
    Degraded,
    PendingDeletion,
}

impl SendingDomainStatus {
    /// The exact wire string for this status, used when building query params.
    pub fn as_str(&self) -> &'static str {
        match self {
            SendingDomainStatus::NotStarted => "not_started",
            SendingDomainStatus::AwaitingOwnership => "awaiting_ownership",
            SendingDomainStatus::Pending => "pending",
            SendingDomainStatus::DnsInvalid => "dns_invalid",
            SendingDomainStatus::Verifying => "verifying",
            SendingDomainStatus::Verified => "verified",
            SendingDomainStatus::Failed => "failed",
            SendingDomainStatus::PendingDkimRotation => "pending_dkim_rotation",
            SendingDomainStatus::Degraded => "degraded",
            SendingDomainStatus::PendingDeletion => "pending_deletion",
        }
    }
}

impl MailRuleAction {
    /// The exact wire string for this action, used when building query params.
    pub fn as_str(&self) -> &'static str {
        match self {
            MailRuleAction::Allow => "allow",
            MailRuleAction::Block => "block",
        }
    }
}

impl MailRuleMatchType {
    /// The exact wire string for this match type, used when building query
    /// params.
    pub fn as_str(&self) -> &'static str {
        match self {
            MailRuleMatchType::ExactEmail => "exact_email",
            MailRuleMatchType::Domain => "domain",
        }
    }
}

impl ContactRuleStatus {
    /// The exact wire string for this status.
    pub fn as_str(&self) -> &'static str {
        match self {
            ContactRuleStatus::Active => "active",
            ContactRuleStatus::Paused => "paused",
        }
    }
}

impl FilterMode {
    /// The exact wire string for this filter mode.
    pub fn as_str(&self) -> &'static str {
        match self {
            FilterMode::Whitelist => "whitelist",
            FilterMode::Blacklist => "blacklist",
        }
    }
}

impl ThreadFolder {
    /// The exact wire string for this folder.
    pub fn as_str(&self) -> &'static str {
        match self {
            ThreadFolder::Inbox => "inbox",
            ThreadFolder::Spam => "spam",
            ThreadFolder::Blocked => "blocked",
            ThreadFolder::Archive => "archive",
        }
    }
}

impl ForwardMode {
    /// The exact wire string for this forward mode.
    pub fn as_str(&self) -> &'static str {
        match self {
            ForwardMode::Inline => "inline",
            ForwardMode::Wrapped => "wrapped",
        }
    }
}

/// Summary returned on PATCH when `filter_mode` actually changed.
///
/// Reports how many existing active rules are now redundant under the new mode
/// so the caller can prompt for cleanup. The blacklist <-> whitelist flip does
/// not touch the contact-rules table — redundant rules still evaluate
/// correctly, they just match the new default verdict.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterModeChangeNotice {
    /// The mode the resource was just flipped to.
    pub new_filter_mode: FilterMode,
    /// The action whose rules are now redundant — `"block"` under whitelist,
    /// `"allow"` under blacklist. Kept as a free-form string to tolerate new
    /// server values; match against [`MailRuleAction`] values.
    pub redundant_rule_action: String,
    /// Count of active rules whose action equals `redundant_rule_action`. `0`
    /// is a clean flip. Paused and deleted rules are not counted.
    pub redundant_rule_count: i64,
}

/// An Inkbox mailbox (an email address owned by your organisation).
///
/// `agent_identity_id` is the UUID of the owning agent identity, or `None` if
/// the mailbox is standalone (not tied to any agent).
///
/// `sending_domain` is the bare domain the mailbox sends from, derived from
/// `email_address` when the server omits it. Either the platform default or a
/// verified custom domain registered to your org.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mailbox {
    pub id: Uuid,
    pub email_address: String,
    /// Bare domain the mailbox sends from. Server may omit it, in which case
    /// it is derived from the local part of `email_address`.
    #[serde(default)]
    pub sending_domain: String,
    /// Defaults to `Blacklist` when the server omits the field.
    #[serde(default = "default_filter_mode")]
    pub filter_mode: FilterMode,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_mode_change_notice: Option<FilterModeChangeNotice>,
}

fn default_filter_mode() -> FilterMode {
    FilterMode::Blacklist
}

impl Mailbox {
    /// Backfill `sending_domain` from `email_address` when the server left it
    /// blank, mirroring the Python `_from_dict` partition on `"@"`.
    fn normalize(mut self) -> Self {
        if self.sending_domain.is_empty() {
            if let Some((_, domain)) = self.email_address.split_once('@') {
                self.sending_domain = domain.to_string();
            }
        }
        self
    }

    /// Deserialize a mailbox from a raw transport value, applying the
    /// `sending_domain` backfill.
    pub(crate) fn from_value(v: Value) -> crate::error::Result<Self> {
        let mailbox: Mailbox = serde_json::from_value(v)?;
        Ok(mailbox.normalize())
    }
}

/// A custom sending domain registered to your organisation.
///
/// Returned by `Inkbox::domains().list()`. Only `Verified` rows are usable for
/// sending mail.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Domain {
    /// Sending-domain row id (e.g. `"sending_domain_<uuid>"`).
    pub id: String,
    /// Bare registered domain (e.g. `"mail.acme.com"`).
    pub domain: String,
    /// Current lifecycle status.
    pub status: SendingDomainStatus,
    /// True if this is the org's default sending domain.
    pub is_default: bool,
    /// First time this domain reached `Verified`, or `None` if never verified.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verified_at: Option<String>,
}

/// Email message metadata.
///
/// Body content is excluded from list responses. Call
/// [`crate::mail::resources::messages::MessagesResource::get`] to retrieve the
/// full message with body.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub id: Uuid,
    pub mailbox_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thread_id: Option<Uuid>,
    pub message_id: String,
    pub from_address: String,
    pub to_addresses: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cc_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    pub direction: MessageDirection,
    pub status: String,
    pub is_read: bool,
    pub is_starred: bool,
    pub has_attachments: bool,
    pub created_at: String,
}

/// Full message including body content.
///
/// Carries the [`Message`] metadata plus the body and extended headers. The
/// Python models this as a subclass of `Message`; here the base fields are
/// flattened in so the wire shape is identical.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MessageDetail {
    #[serde(flatten)]
    pub message: Message,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_html: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bcc_addresses: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub in_reply_to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub attachment_metadata: Option<Vec<Value>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ses_message_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
}

/// A conversation thread grouping related messages.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Thread {
    pub id: Uuid,
    pub mailbox_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subject: Option<String>,
    /// Defaults to `Inbox` when the server omits the field.
    #[serde(default = "default_thread_folder")]
    pub folder: ThreadFolder,
    pub message_count: i64,
    pub last_message_at: String,
    pub created_at: String,
}

fn default_thread_folder() -> ThreadFolder {
    ThreadFolder::Inbox
}

/// Thread with all messages inlined, ordered oldest-first.
///
/// The Python models this as a subclass of `Thread`; the base fields are
/// flattened in so the wire shape is identical.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ThreadDetail {
    #[serde(flatten)]
    pub thread: Thread,
    #[serde(default)]
    pub messages: Vec<Message>,
}

/// An inbound/outbound allow/block rule scoped to a mailbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MailContactRule {
    pub id: Uuid,
    pub mailbox_id: Uuid,
    pub action: MailRuleAction,
    pub match_type: MailRuleMatchType,
    pub match_target: String,
    /// Defaults to `Active` when the server omits the field.
    #[serde(default = "default_contact_rule_status")]
    pub status: ContactRuleStatus,
    pub created_at: String,
    pub updated_at: String,
}

fn default_contact_rule_status() -> ContactRuleStatus {
    ContactRuleStatus::Active
}

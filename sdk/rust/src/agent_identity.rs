//! [`AgentIdentity`]: a domain object representing one agent identity.
//!
//! Returned by `Inkbox::create_identity()` / `Inkbox::get_identity()`. The
//! convenience methods (`send_email`, `place_call`, `send_text`, ...) are
//! scoped to this agent's assigned channels so callers never need to pass an
//! email address or phone number ID explicitly.
//!
//! Faithful port of `inkbox/agent_identity.py`. The Python object holds a
//! back-reference to the `Inkbox` client and delegates each convenience method
//! to the matching org-level resource, scoped to this identity's channels. In
//! Rust the back-reference is an [`Arc<crate::client::Inkbox>`] and the
//! delegation targets the client's resource accessors.
//!
//! ## Assumed `crate::client::Inkbox` accessors
//!
//! The `client` module is wired up by the orchestrator. This file assumes the
//! following accessors exist (names follow the Python `@property` names, or the
//! snake_case private attr where no public property exists):
//!
//! * `messages() -> &MessagesResource`
//! * `threads() -> &ThreadsResource`
//! * `calls() -> &CallsResource`  (transcripts folded in as `calls().transcripts(..)`)
//! * `texts() -> &TextsResource`
//! * `imessages() -> &IMessagesResource`
//! * `phone_numbers() -> &PhoneNumbersResource`  (Python property `phone_numbers`, attr `_numbers`)
//! * `identities() -> &IdentitiesResource`       (no Python property; attr `_ids_resource`)
//! * `credentials() -> Credentials` + `get_secret(..)` (per-identity vault access)
//!
//! Interior mutability uses `RefCell` so the convenience methods can take
//! `&self` while still refreshing the cached channels (`_data`, `_phone_number`)
//! exactly as the Python mutates instance attributes.

use std::cell::RefCell;
use std::sync::Arc;

use uuid::Uuid;

use crate::client::Inkbox;
use crate::credentials::Credentials;
use crate::error::{InkboxError, Result};
use crate::identities::types::{
    AgentIdentityData, IdentityAccess, IdentityMailbox, IdentityPhoneNumber,
};
use crate::imessage::types::{
    IMessage, IMessageAssignment, IMessageConversation, IMessageConversationSummary,
    IMessageMarkReadResult, IMessageMediaUpload, IMessageReaction, IMessageReactionType,
    IMessageSendStyle,
};
use crate::mail::types::{
    ContactRuleStatus as MailContactRuleStatus, FilterMode, ForwardMode, MailIdentityContactRule,
    MailRuleAction, MailRuleMatchType, Message, MessageDetail, MessageDirection, ThreadDetail,
};
use crate::phone::resources::texts::TextRecipients;
use crate::phone::types::{
    CallOrigin, ContactRuleStatus as PhoneContactRuleStatus, IncomingCallAction,
    IncomingCallActionConfig, PhoneCall, PhoneCallWithRateLimit, PhoneIdentityContactRule,
    PhoneRuleAction, PhoneRuleMatchType, PhoneTranscript, TextConversationSummary,
    TextConversationUpdateResult, TextMessage,
};
use crate::signing_keys::{SigningKey, SigningKeyStatus};
use crate::tunnels::types::Tunnel;
use crate::vault::resources::vault::UnlockedVault;
use crate::vault::totp::{TOTPCode, TOTPConfig};
use crate::vault::types::{DecryptedVaultSecret, SecretPayload, VaultSecret};

/// An agent identity with convenience methods for its assigned channels.
///
/// Obtain an instance via `inkbox.create_identity("support-bot")` or
/// `inkbox.get_identity("support-bot")`. If the identity has a mailbox you can
/// communicate directly:
///
/// ```ignore
/// identity.send_email(&["user@example.com".into()], "Hi", Some("Hello"), None, None, None, None, None)?;
/// for msg in identity.iter_emails(None, None)? { println!("{:?}", msg.subject); }
/// ```
pub struct AgentIdentity {
    /// Latest identity payload (handle, display name, channels). Mutated on
    /// `update` / `refresh`, mirroring the Python `self._data`.
    data: RefCell<AgentIdentityData>,
    /// Back-reference to the owning client.
    inkbox: Arc<Inkbox>,
    /// Cached mailbox channel (1:1 invariant for live identities).
    mailbox: RefCell<Option<IdentityMailbox>>,
    /// Cached phone-number channel, cleared on release and refreshed on provision.
    phone_number: RefCell<Option<IdentityPhoneNumber>>,
    /// Cached tunnel channel.
    tunnel: RefCell<Option<Tunnel>>,
}

impl AgentIdentity {
    /// Build a facade from an identity-create / identity-get payload and the
    /// owning client. Mirrors the Python `AgentIdentity.__init__`.
    pub fn new(data: AgentIdentityData, inkbox: Arc<Inkbox>) -> Self {
        let mailbox = data.mailbox.clone();
        let phone_number = data.phone_number.clone();
        let tunnel = data.tunnel.clone();
        Self {
            data: RefCell::new(data),
            inkbox,
            mailbox: RefCell::new(mailbox),
            phone_number: RefCell::new(phone_number),
            tunnel: RefCell::new(tunnel),
        }
    }

    // -----------------------------------------------------------------------
    // Identity properties
    // -----------------------------------------------------------------------

    /// This identity's agent handle.
    pub fn agent_handle(&self) -> String {
        self.data.borrow().summary.agent_handle.clone()
    }

    /// This identity's UUID.
    pub fn id(&self) -> Uuid {
        self.data.borrow().summary.id
    }

    /// Human-readable display name. Defaults server-side to `agent_handle` if unset.
    pub fn display_name(&self) -> Option<String> {
        self.data.borrow().summary.display_name.clone()
    }

    /// Free-form org-internal description, or `None` if unset.
    ///
    /// Never surfaces in outbound mail / call audio / public payloads.
    pub fn description(&self) -> Option<String> {
        self.data.borrow().summary.description.clone()
    }

    /// The email address assigned to this identity at creation time.
    ///
    /// Always trust this value — do not derive it from `agent_handle`.
    pub fn email_address(&self) -> Option<String> {
        self.data.borrow().summary.email_address.clone()
    }

    /// Whether this identity can be reached over the shared iMessage service.
    pub fn imessage_enabled(&self) -> bool {
        self.data.borrow().summary.imessage_enabled
    }

    /// Whitelist/blacklist mode for this identity's iMessage contact rules.
    pub fn imessage_filter_mode(&self) -> FilterMode {
        self.data.borrow().summary.imessage_filter_mode
    }

    /// Whitelist/blacklist mode for this identity's mail contact rules.
    pub fn mail_filter_mode(&self) -> FilterMode {
        self.data.borrow().summary.mail_filter_mode
    }

    /// Whitelist/blacklist mode for this identity's phone contact rules.
    pub fn phone_filter_mode(&self) -> FilterMode {
        self.data.borrow().summary.phone_filter_mode
    }

    /// Mailbox linked to this identity. Non-null for live identities (1:1 invariant).
    pub fn mailbox(&self) -> Option<IdentityMailbox> {
        self.mailbox.borrow().clone()
    }

    /// Phone number linked to this identity, if one is assigned.
    pub fn phone_number(&self) -> Option<IdentityPhoneNumber> {
        self.phone_number.borrow().clone()
    }

    /// Tunnel linked to this identity. Non-null for live identities (1:1 invariant).
    pub fn tunnel(&self) -> Option<Tunnel> {
        self.tunnel.borrow().clone()
    }

    // -----------------------------------------------------------------------
    // Channel management
    // -----------------------------------------------------------------------

    /// Provision a new phone number and link it to this identity.
    ///
    /// # Arguments
    /// * `r#type` - Number type to provision. Only `"local"` is supported.
    /// * `state` - US state abbreviation (e.g. `"NY"`) to request a number in
    ///   that state.
    ///
    /// # Returns
    /// The newly provisioned and linked phone number.
    pub fn provision_phone_number(
        &self,
        r#type: &str,
        state: Option<&str>,
    ) -> Result<IdentityPhoneNumber> {
        // Provision at the org level scoped to this handle, then refetch to pick
        // up the freshly-linked channel (mirrors the Python two-step).
        self.inkbox
            .phone_numbers()
            .provision(&self.agent_handle(), r#type, state)?;
        let data = self.inkbox.identities().get(&self.agent_handle())?;
        let phone = data.phone_number.clone();
        *self.phone_number.borrow_mut() = phone.clone();
        *self.data.borrow_mut() = data;
        phone.ok_or_else(|| {
            InkboxError::InvalidArgument("phone number missing after provision".into())
        })
    }

    /// Release this identity's phone number (vendor + local).
    pub fn release_phone_number(&self) -> Result<()> {
        self.require_phone()?;
        self.inkbox
            .identities()
            .release_phone_number(&self.agent_handle())?;
        *self.phone_number.borrow_mut() = None;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Identity access / visibility
    // -----------------------------------------------------------------------

    /// List who can see this identity. See
    /// [`IdentitiesResource::list_access`](crate::identities::IdentitiesResource::list_access).
    pub fn list_access(&self) -> Result<Vec<IdentityAccess>> {
        self.inkbox.identities().list_access(&self.agent_handle())
    }

    /// Grant visibility on this identity.
    ///
    /// # Arguments
    /// * `viewer_identity_id` - UUID of the viewer identity to grant, or `None`
    ///   to reset this identity to the org-wide wildcard (every active identity
    ///   in the org sees it).
    pub fn grant_access(&self, viewer_identity_id: Option<&str>) -> Result<IdentityAccess> {
        self.inkbox
            .identities()
            .grant_access(&self.agent_handle(), viewer_identity_id)
    }

    /// Revoke one viewer's visibility on this identity.
    ///
    /// # Arguments
    /// * `viewer_identity_id` - UUID of the viewer identity to drop (the viewer
    ///   identity's UUID, not an access-row id).
    pub fn revoke_access(&self, viewer_identity_id: &str) -> Result<()> {
        self.inkbox
            .identities()
            .revoke_access(&self.agent_handle(), viewer_identity_id)
    }

    // -----------------------------------------------------------------------
    // Mail helpers
    // -----------------------------------------------------------------------

    /// Send an email from this identity's mailbox.
    ///
    /// # Arguments
    /// * `to` - Primary recipient addresses (at least one required).
    /// * `subject` - Email subject line.
    /// * `body_text` / `body_html` - Plain-text / HTML body.
    /// * `cc` / `bcc` - Carbon-copy / blind carbon-copy recipients.
    /// * `in_reply_to_message_id` - RFC 5322 Message-ID to thread a reply.
    /// * `attachments` - File attachments (see
    ///   [`crate::mail::resources::Attachment`]).
    #[allow(clippy::too_many_arguments)]
    pub fn send_email(
        &self,
        to: &[String],
        subject: &str,
        body_text: Option<&str>,
        body_html: Option<&str>,
        cc: Option<&[String]>,
        bcc: Option<&[String]>,
        in_reply_to_message_id: Option<&str>,
        attachments: Option<&[crate::mail::resources::Attachment]>,
    ) -> Result<Message> {
        let email = self.require_mailbox()?;
        self.inkbox.messages().send(
            &email,
            to,
            subject,
            body_text,
            body_html,
            cc,
            bcc,
            in_reply_to_message_id,
            attachments,
        )
    }

    /// Reply to everyone on a stored message from this identity's mailbox.
    ///
    /// Recipients are resolved server-side from the source message.
    ///
    /// # Arguments
    /// * `message_id` - UUID of the message being replied to.
    /// * `subject` - Optional override; defaults to `"Re: " + original.subject`.
    /// * `body_text` / `body_html` - Optional reply body.
    /// * `attachments` - Optional file attachments.
    /// * `reply_to` - Optional Reply-To address.
    #[allow(clippy::too_many_arguments)]
    pub fn reply_all_email(
        &self,
        message_id: &str,
        subject: Option<&str>,
        body_text: Option<&str>,
        body_html: Option<&str>,
        attachments: Option<&[crate::mail::resources::Attachment]>,
        reply_to: Option<&str>,
    ) -> Result<Message> {
        let email = self.require_mailbox()?;
        self.inkbox.messages().reply_all(
            &email,
            message_id,
            subject,
            body_text,
            body_html,
            attachments,
            reply_to,
        )
    }

    /// Forward a stored message out from this identity's mailbox.
    ///
    /// # Arguments
    /// * `message_id` - UUID of the message being forwarded.
    /// * `to` / `cc` / `bcc` - Recipients (at least one required across all three).
    /// * `mode` - `Inline` (default) or `Wrapped`.
    /// * `subject` - Optional override; defaults to `"Fwd: " + original.subject`.
    /// * `body_text` / `body_html` - Optional caller note.
    /// * `additional_attachments` - Optional caller-authored attachments.
    /// * `include_original_attachments` - `inline` mode only; default `true`.
    /// * `reply_to` - Optional Reply-To address for the forward's envelope.
    #[allow(clippy::too_many_arguments)]
    pub fn forward_email(
        &self,
        message_id: &str,
        to: Option<&[String]>,
        cc: Option<&[String]>,
        bcc: Option<&[String]>,
        mode: ForwardMode,
        subject: Option<&str>,
        body_text: Option<&str>,
        body_html: Option<&str>,
        additional_attachments: Option<&[crate::mail::resources::Attachment]>,
        include_original_attachments: bool,
        reply_to: Option<&str>,
    ) -> Result<Message> {
        let email = self.require_mailbox()?;
        self.inkbox.messages().forward(
            &email,
            message_id,
            to,
            cc,
            bcc,
            mode,
            subject,
            body_text,
            body_html,
            additional_attachments,
            include_original_attachments,
            reply_to,
        )
    }

    /// Fetch all emails in this identity's inbox, newest first (pagination
    /// handled automatically). The Python returns a lazy iterator; the Rust
    /// resource collects every page into a `Vec`.
    ///
    /// # Arguments
    /// * `page_size` - Messages fetched per API call (1-100); `None` for 50.
    /// * `direction` - Filter by direction.
    pub fn iter_emails(
        &self,
        page_size: Option<i64>,
        direction: Option<MessageDirection>,
    ) -> Result<Vec<Message>> {
        let email = self.require_mailbox()?;
        self.inkbox.messages().list(&email, page_size, direction)
    }

    /// Fetch all unread emails in this identity's inbox, newest first.
    ///
    /// Fetches all messages and filters client-side (`is_read == false`),
    /// matching the Python generator.
    pub fn iter_unread_emails(
        &self,
        page_size: Option<i64>,
        direction: Option<MessageDirection>,
    ) -> Result<Vec<Message>> {
        let all = self.iter_emails(page_size, direction)?;
        Ok(all.into_iter().filter(|m| !m.is_read).collect())
    }

    /// Mark a list of messages as read.
    pub fn mark_emails_read(&self, message_ids: &[String]) -> Result<()> {
        let email = self.require_mailbox()?;
        for mid in message_ids {
            self.inkbox.messages().mark_read(&email, mid)?;
        }
        Ok(())
    }

    /// Get a single message with full body content.
    pub fn get_message(&self, message_id: &str) -> Result<MessageDetail> {
        let email = self.require_mailbox()?;
        self.inkbox.messages().get(&email, message_id)
    }

    /// Get a thread with all its messages inlined (oldest-first).
    pub fn get_thread(&self, thread_id: &str) -> Result<ThreadDetail> {
        let email = self.require_mailbox()?;
        self.inkbox.threads().get(&email, thread_id)
    }

    // -----------------------------------------------------------------------
    // Phone helpers
    // -----------------------------------------------------------------------

    /// Place an outbound call as this identity.
    ///
    /// For `dedicated_number` origination the call rides this identity's
    /// provisioned phone number (requires one). For `shared_imessage_number`
    /// it rides the shared line and is scoped by this identity's id instead.
    ///
    /// # Arguments
    /// * `to_number` - E.164 destination number.
    /// * `origination` - How to place the call (defaults to
    ///   [`CallOrigin::DedicatedNumber`]).
    /// * `client_websocket_url` - WebSocket URL (wss://) for audio bridging.
    pub fn place_call(
        &self,
        to_number: &str,
        origination: CallOrigin,
        client_websocket_url: Option<&str>,
    ) -> Result<PhoneCallWithRateLimit> {
        match origination {
            CallOrigin::DedicatedNumber => {
                // Dedicated origination needs this identity's own number.
                let number = self.require_phone()?;
                self.inkbox.calls().place(
                    to_number,
                    origination,
                    Some(&number),
                    None,
                    client_websocket_url,
                )
            }
            CallOrigin::SharedImessageNumber => {
                // Shared-line origination scopes by identity id, no from_number.
                let id = self.id().to_string();
                self.inkbox.calls().place(
                    to_number,
                    origination,
                    None,
                    Some(&id),
                    client_websocket_url,
                )
            }
        }
    }

    /// List calls made to/from this identity.
    ///
    /// Identity-scoped credentials never see contact-rule-blocked rows
    /// regardless of `is_blocked` (server-side access policy). Scopes by
    /// identity id — no phone number required (a shared-only identity can
    /// still have calls).
    ///
    /// # Arguments
    /// * `limit` - Maximum number of results (default 50).
    /// * `offset` - Pagination offset (default 0).
    /// * `is_blocked` - Tri-state filter (`None` for all).
    pub fn list_calls(
        &self,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<PhoneCall>> {
        let id = self.id().to_string();
        self.inkbox
            .calls()
            .list(Some(&id), limit, offset, is_blocked)
    }

    /// List transcript segments for a specific call.
    pub fn list_transcripts(&self, call_id: &str) -> Result<Vec<PhoneTranscript>> {
        self.inkbox.calls().transcripts(call_id)
    }

    /// Get this identity's inbound-call handling config.
    pub fn get_incoming_call_action(&self) -> Result<IncomingCallActionConfig> {
        self.inkbox
            .incoming_call_action()
            .get(Some(&self.id().to_string()))
    }

    /// Set this identity's inbound-call handling config.
    pub fn set_incoming_call_action(
        &self,
        incoming_call_action: IncomingCallAction,
        client_websocket_url: Option<&str>,
        incoming_call_webhook_url: Option<&str>,
    ) -> Result<IncomingCallActionConfig> {
        self.inkbox.incoming_call_action().set(
            incoming_call_action,
            Some(&self.id().to_string()),
            client_websocket_url,
            incoming_call_webhook_url,
        )
    }

    // -----------------------------------------------------------------------
    // Text message helpers
    // -----------------------------------------------------------------------

    /// Send an outbound SMS/MMS from this identity's phone number.
    ///
    /// # Arguments
    /// * `to` - E.164 destination number, or a list for a group send. Mutually
    ///   exclusive with `conversation_id`.
    /// * `conversation_id` - Existing conversation UUID to reply into.
    /// * `text` - Message body.
    /// * `media_urls` - MMS media URLs.
    pub fn send_text(
        &self,
        to: Option<TextRecipients>,
        conversation_id: Option<&str>,
        text: Option<&str>,
        media_urls: Option<&[String]>,
    ) -> Result<TextMessage> {
        let number_id = self.require_phone_id()?;
        self.inkbox
            .texts()
            .send(&number_id, to, conversation_id, text, media_urls)
    }

    /// List text messages for this identity's phone number.
    ///
    /// Identity-scoped credentials never see contact-rule-blocked rows
    /// regardless of `is_blocked`.
    ///
    /// # Arguments
    /// * `limit` / `offset` - Pagination (defaults 50 / 0).
    /// * `is_read` - Filter by read state (`None` for all).
    /// * `is_blocked` - Tri-state filter (`None` for all).
    pub fn list_texts(
        &self,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
    ) -> Result<Vec<TextMessage>> {
        let number_id = self.require_phone_id()?;
        self.inkbox
            .texts()
            .list(&number_id, limit, offset, is_read, is_blocked)
    }

    /// Get a single text message by ID.
    pub fn get_text(&self, text_id: &str) -> Result<TextMessage> {
        let number_id = self.require_phone_id()?;
        self.inkbox.texts().get(&number_id, text_id)
    }

    /// List text conversations.
    ///
    /// Identity-scoped credentials never see blocked rows in conversation
    /// summaries.
    ///
    /// # Arguments
    /// * `limit` / `offset` - Pagination (defaults 50 / 0).
    /// * `is_blocked` - Tri-state filter (`None` for all).
    /// * `include_groups` - Include group conversations (default `false`).
    pub fn list_text_conversations(
        &self,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
        include_groups: bool,
    ) -> Result<Vec<TextConversationSummary>> {
        let number_id = self.require_phone_id()?;
        self.inkbox.texts().list_conversations(
            &number_id,
            limit,
            offset,
            is_blocked,
            include_groups,
        )
    }

    /// Get all messages in a conversation.
    ///
    /// # Arguments
    /// * `remote_number` - E.164 one-to-one remote number, or conversation UUID.
    /// * `limit` / `offset` - Pagination (defaults 50 / 0).
    pub fn get_text_conversation(
        &self,
        remote_number: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TextMessage>> {
        let number_id = self.require_phone_id()?;
        self.inkbox
            .texts()
            .get_conversation(&number_id, remote_number, limit, offset)
    }

    /// Mark a single text message as read.
    pub fn mark_text_read(&self, text_id: &str) -> Result<TextMessage> {
        let number_id = self.require_phone_id()?;
        self.inkbox.texts().update(&number_id, text_id, Some(true))
    }

    /// Mark all messages in a conversation as read.
    ///
    /// # Arguments
    /// * `remote_number` - E.164 one-to-one remote number, or conversation UUID.
    ///
    /// # Returns
    /// [`TextConversationUpdateResult`] with `conversation_id`,
    /// `remote_phone_number`, `is_read`, and `updated_count`.
    pub fn mark_text_conversation_read(
        &self,
        remote_number: &str,
    ) -> Result<TextConversationUpdateResult> {
        let number_id = self.require_phone_id()?;
        self.inkbox
            .texts()
            .update_conversation(&number_id, remote_number, true)
    }

    // -----------------------------------------------------------------------
    // iMessage helpers
    // -----------------------------------------------------------------------

    /// Send an outbound iMessage as this identity.
    ///
    /// Sends only work toward recipients that triage has already connected to
    /// this identity over the shared iMessage service — there is no cold
    /// outreach.
    ///
    /// # Arguments
    /// * `to` - E.164 recipient number. Mutually exclusive with `conversation_id`.
    /// * `conversation_id` - Existing conversation UUID to reply into.
    /// * `text` - Message body.
    /// * `media_urls` - Media URLs (at most one).
    /// * `send_style` - Optional expressive send style.
    pub fn send_imessage(
        &self,
        to: Option<&str>,
        conversation_id: Option<&Uuid>,
        text: Option<&str>,
        media_urls: Option<&[String]>,
        send_style: Option<IMessageSendStyle>,
    ) -> Result<IMessage> {
        self.require_imessage()?;
        let id = self.id();
        self.inkbox
            .imessages()
            .send(to, conversation_id, text, media_urls, send_style, Some(&id))
    }

    /// List this identity's iMessages, newest first.
    ///
    /// Identity-scoped credentials never see contact-rule-blocked rows
    /// regardless of `is_blocked`.
    pub fn list_imessages(
        &self,
        conversation_id: Option<&Uuid>,
        limit: i64,
        offset: i64,
        is_read: Option<bool>,
        is_blocked: Option<bool>,
    ) -> Result<Vec<IMessage>> {
        self.require_imessage()?;
        let id = self.id();
        self.inkbox.imessages().list(
            Some(&id),
            conversation_id,
            limit,
            offset,
            is_read,
            is_blocked,
        )
    }

    /// List recipients actively connected to this identity, newest first.
    pub fn list_imessage_assignments(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<IMessageAssignment>> {
        self.require_imessage()?;
        let id = self.id();
        self.inkbox
            .imessages()
            .list_assignments(Some(&id), limit, offset)
    }

    /// List this identity's iMessage conversations.
    pub fn list_imessage_conversations(
        &self,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<IMessageConversationSummary>> {
        self.require_imessage()?;
        let id = self.id();
        self.inkbox
            .imessages()
            .list_conversations(Some(&id), limit, offset, is_blocked)
    }

    /// Get one of this identity's iMessage conversations by ID.
    pub fn get_imessage_conversation(
        &self,
        conversation_id: &Uuid,
    ) -> Result<IMessageConversation> {
        self.require_imessage()?;
        let id = self.id();
        self.inkbox
            .imessages()
            .get_conversation(conversation_id, Some(&id))
    }

    /// Send a tapback reaction to a message in one of this identity's
    /// conversations.
    ///
    /// # Arguments
    /// * `message_id` - UUID of the message being reacted to.
    /// * `reaction` - Tapback kind.
    /// * `part_index` - Part of a multi-part message to react to.
    pub fn send_imessage_reaction(
        &self,
        message_id: &Uuid,
        reaction: IMessageReactionType,
        part_index: i64,
    ) -> Result<IMessageReaction> {
        self.require_imessage()?;
        self.inkbox
            .imessages()
            .send_reaction(message_id, reaction, part_index)
    }

    /// Send a read receipt and mark a conversation's inbound messages read.
    pub fn mark_imessage_conversation_read(
        &self,
        conversation_id: &Uuid,
    ) -> Result<IMessageMarkReadResult> {
        self.require_imessage()?;
        self.inkbox
            .imessages()
            .mark_conversation_read(conversation_id)
    }

    /// Show a typing indicator to a conversation's recipient.
    pub fn send_imessage_typing(&self, conversation_id: &Uuid) -> Result<()> {
        self.require_imessage()?;
        self.inkbox.imessages().send_typing(conversation_id)
    }

    /// Upload media and get back a URL usable in `media_urls`.
    ///
    /// # Arguments
    /// * `content` - Raw file bytes (max 10 MiB).
    /// * `filename` - Original filename, used for type inference.
    /// * `content_type` - Optional MIME type.
    pub fn upload_imessage_media(
        &self,
        content: Vec<u8>,
        filename: &str,
        content_type: Option<&str>,
    ) -> Result<IMessageMediaUpload> {
        self.require_imessage()?;
        self.inkbox
            .imessages()
            .upload_media(content, filename, content_type)
    }

    // -----------------------------------------------------------------------
    // Mail contact rules (identity-keyed)
    // -----------------------------------------------------------------------

    /// List this identity's mail allow/block rules, newest first.
    pub fn list_mail_contact_rules(
        &self,
        action: Option<MailRuleAction>,
        match_type: Option<MailRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MailIdentityContactRule>> {
        self.inkbox.mail_identity_contact_rules().list(
            &self.agent_handle(),
            action,
            match_type,
            limit,
            offset,
        )
    }

    /// Get one of this identity's mail contact rules by id.
    pub fn get_mail_contact_rule(&self, rule_id: &str) -> Result<MailIdentityContactRule> {
        self.inkbox
            .mail_identity_contact_rules()
            .get(&self.agent_handle(), rule_id)
    }

    /// Create a mail allow/block rule for this identity.
    pub fn create_mail_contact_rule(
        &self,
        action: MailRuleAction,
        match_type: MailRuleMatchType,
        match_target: &str,
    ) -> Result<MailIdentityContactRule> {
        self.inkbox.mail_identity_contact_rules().create(
            &self.agent_handle(),
            action,
            match_type,
            match_target,
        )
    }

    /// Update a mail rule's `action` or `status` (admin-only). `None` arguments
    /// are left unchanged.
    pub fn update_mail_contact_rule(
        &self,
        rule_id: &str,
        action: Option<MailRuleAction>,
        status: Option<MailContactRuleStatus>,
    ) -> Result<MailIdentityContactRule> {
        self.inkbox.mail_identity_contact_rules().update(
            &self.agent_handle(),
            rule_id,
            action,
            status,
        )
    }

    /// Delete one of this identity's mail contact rules (admin-only).
    pub fn delete_mail_contact_rule(&self, rule_id: &str) -> Result<()> {
        self.inkbox
            .mail_identity_contact_rules()
            .delete(&self.agent_handle(), rule_id)
    }

    // -----------------------------------------------------------------------
    // Phone contact rules (identity-keyed)
    // -----------------------------------------------------------------------

    /// List this identity's phone allow/block rules, newest first.
    ///
    /// Returns `[]` for a phoneless identity; the server requires a phone only
    /// for create/get/update/delete, not for list.
    pub fn list_phone_contact_rules(
        &self,
        action: Option<PhoneRuleAction>,
        match_type: Option<PhoneRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<PhoneIdentityContactRule>> {
        self.inkbox.phone_identity_contact_rules().list(
            &self.agent_handle(),
            action,
            match_type,
            limit,
            offset,
        )
    }

    /// Get one of this identity's phone contact rules by id.
    ///
    /// Errors if this identity has no phone number.
    pub fn get_phone_contact_rule(&self, rule_id: &str) -> Result<PhoneIdentityContactRule> {
        self.require_phone()?;
        self.inkbox
            .phone_identity_contact_rules()
            .get(&self.agent_handle(), rule_id)
    }

    /// Create a phone allow/block rule for this identity.
    ///
    /// Errors if this identity has no phone number.
    pub fn create_phone_contact_rule(
        &self,
        action: PhoneRuleAction,
        match_target: &str,
        match_type: PhoneRuleMatchType,
    ) -> Result<PhoneIdentityContactRule> {
        self.require_phone()?;
        self.inkbox.phone_identity_contact_rules().create(
            &self.agent_handle(),
            action,
            match_target,
            match_type,
        )
    }

    /// Update a phone rule's `action` or `status` (admin-only). `None`
    /// arguments are left unchanged. Errors if this identity has no phone number.
    pub fn update_phone_contact_rule(
        &self,
        rule_id: &str,
        action: Option<PhoneRuleAction>,
        status: Option<PhoneContactRuleStatus>,
    ) -> Result<PhoneIdentityContactRule> {
        self.require_phone()?;
        self.inkbox.phone_identity_contact_rules().update(
            &self.agent_handle(),
            rule_id,
            action,
            status,
        )
    }

    /// Delete one of this identity's phone contact rules (admin-only).
    ///
    /// Errors if this identity has no phone number.
    pub fn delete_phone_contact_rule(&self, rule_id: &str) -> Result<()> {
        self.require_phone()?;
        self.inkbox
            .phone_identity_contact_rules()
            .delete(&self.agent_handle(), rule_id)
    }

    // -----------------------------------------------------------------------
    // Signing key (identity-keyed)
    // -----------------------------------------------------------------------

    /// Report whether this identity has a webhook signing key.
    pub fn get_signing_key_status(&self) -> Result<SigningKeyStatus> {
        self.inkbox.signing_keys().get_status(&self.agent_handle())
    }

    /// Create or rotate this identity's webhook signing key.
    ///
    /// The plaintext `signing_key` is returned **once** — store it securely, it
    /// cannot be retrieved again.
    pub fn create_signing_key(&self) -> Result<SigningKey> {
        self.inkbox
            .signing_keys()
            .create_or_rotate(&self.agent_handle())
    }

    // -----------------------------------------------------------------------
    // Identity management
    // -----------------------------------------------------------------------

    /// Update this identity's handle, display name, description, iMessage
    /// reachability, contact-rule filter modes, and/or status.
    ///
    /// Only provided fields are applied; omitted fields are left unchanged. For
    /// `display_name` and `description`, `Unset::Value(None)` clears the column;
    /// `Unset::Omit` leaves it untouched.
    ///
    /// # Arguments
    /// * `new_handle` - New agent handle.
    /// * `display_name` - New display name, or `Unset::Value(None)` to clear.
    /// * `description` - New description, or `Unset::Value(None)` to clear.
    /// * `imessage_enabled` - Toggle shared-iMessage reachability.
    /// * `imessage_filter_mode` - `"whitelist"` or `"blacklist"` (admin-only).
    /// * `mail_filter_mode` - `"whitelist"` or `"blacklist"` for this identity's
    ///   mail contact rules (admin-only).
    /// * `phone_filter_mode` - `"whitelist"` or `"blacklist"` for this identity's
    ///   phone contact rules (admin-only). Rejected with 422 when the identity
    ///   has no phone number.
    /// * `status` - `"active"` or `"paused"`. Call [`Self::delete`] to remove the
    ///   identity; `"deleted"` is rejected here.
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &self,
        new_handle: Option<&str>,
        display_name: crate::identities::types::Unset<String>,
        description: crate::identities::types::Unset<String>,
        imessage_enabled: Option<bool>,
        imessage_filter_mode: Option<&str>,
        mail_filter_mode: Option<&str>,
        phone_filter_mode: Option<&str>,
        status: Option<&str>,
    ) -> Result<()> {
        let result = self.inkbox.identities().update(
            &self.agent_handle(),
            new_handle,
            display_name,
            description,
            imessage_enabled,
            imessage_filter_mode,
            mail_filter_mode,
            phone_filter_mode,
            status,
        )?;

        // Rebuild `_data` from the returned summary, preserving the cached
        // channels (the update endpoint returns a summary without channels).
        let new_data = AgentIdentityData {
            summary: result,
            mailbox: self.mailbox.borrow().clone(),
            phone_number: self.phone_number.borrow().clone(),
            tunnel: self.tunnel.borrow().clone(),
        };
        *self.data.borrow_mut() = new_data;

        // A handle rename also renames the linked tunnel in the same
        // transaction; refresh to pick up the new tunnel_name / public_host.
        if new_handle.is_some() && self.tunnel.borrow().is_some() {
            self.refresh()?;
        }
        Ok(())
    }

    /// Re-fetch this identity from the API and update cached channels.
    pub fn refresh(&self) -> Result<()> {
        let data = self.inkbox.identities().get(&self.agent_handle())?;
        *self.mailbox.borrow_mut() = data.mailbox.clone();
        *self.phone_number.borrow_mut() = data.phone_number.clone();
        *self.tunnel.borrow_mut() = data.tunnel.clone();
        *self.data.borrow_mut() = data;
        Ok(())
    }

    /// Delete this identity.
    ///
    /// Cascades: flips the linked mailbox to `deleted`, force-finalizes the
    /// linked tunnel to `deleted`, revokes any identity-scoped API keys, and
    /// releases any linked phone number (vendor + local).
    pub fn delete(&self) -> Result<()> {
        self.inkbox.identities().delete(&self.agent_handle())
    }

    // -----------------------------------------------------------------------
    // Vault / credentials (identity-scoped)
    // -----------------------------------------------------------------------

    /// Identity-scoped credential access. The vault must be unlocked first via
    /// `inkbox.vault().unlock(...)`. Mirrors the Python `credentials` property
    /// (built from the unlocked vault's decrypted secrets).
    ///
    /// Unlike Python this is not cached on the facade — each call rebuilds the
    /// view from the current unlock snapshot, which is always consistent.
    pub fn credentials(&self) -> Result<Credentials> {
        let unlocked = self.require_vault_unlocked()?;
        Ok(Credentials::new(unlocked.secrets()))
    }

    /// Revoke this identity's access to a vault secret.
    pub fn revoke_credential_access(&self, secret_id: &str) -> Result<()> {
        self.inkbox
            .vault()
            .revoke_access(secret_id, &self.id().to_string())
    }

    /// Create a vault secret and grant this identity access to it. The vault
    /// must be unlocked first.
    ///
    /// Note: the new secret is not added to the in-memory unlock snapshot;
    /// re-unlock the vault to surface it in [`Self::credentials`].
    pub fn create_secret(
        &self,
        name: &str,
        payload: &SecretPayload,
        description: Option<&str>,
    ) -> Result<VaultSecret> {
        let mut unlocked = self.require_vault_unlocked()?;
        let secret = unlocked.create_secret(name, payload, description)?;
        self.inkbox
            .vault()
            .grant_access(&secret.id.to_string(), &self.id().to_string())?;
        Ok(secret)
    }

    /// Fetch and decrypt a vault secret this identity has access to.
    pub fn get_secret(&self, secret_id: &str) -> Result<DecryptedVaultSecret> {
        let unlocked = self.require_vault_unlocked()?;
        unlocked.get_secret(secret_id)
    }

    /// Add or replace TOTP on a login secret using a [`TOTPConfig`].
    pub fn set_totp(&self, secret_id: &str, totp: TOTPConfig) -> Result<VaultSecret> {
        let mut unlocked = self.require_vault_unlocked()?;
        unlocked.set_totp(secret_id, totp)
    }

    /// Add or replace TOTP on a login secret from an `otpauth://totp/...` URI.
    pub fn set_totp_uri(&self, secret_id: &str, uri: &str) -> Result<VaultSecret> {
        let mut unlocked = self.require_vault_unlocked()?;
        unlocked.set_totp_uri(secret_id, uri)
    }

    /// Remove TOTP from a login secret this identity has access to.
    pub fn remove_totp(&self, secret_id: &str) -> Result<VaultSecret> {
        let mut unlocked = self.require_vault_unlocked()?;
        unlocked.remove_totp(secret_id)
    }

    /// Generate the current TOTP code for a login secret.
    pub fn get_totp_code(&self, secret_id: &str) -> Result<TOTPCode> {
        let unlocked = self.require_vault_unlocked()?;
        unlocked.get_totp_code(secret_id)
    }

    /// Delete a vault secret this identity has access to.
    pub fn delete_secret(&self, secret_id: &str) -> Result<()> {
        let mut unlocked = self.require_vault_unlocked()?;
        unlocked.delete_secret(secret_id)
    }

    // -----------------------------------------------------------------------
    // Internal guards
    // -----------------------------------------------------------------------

    /// Return the unlocked vault snapshot or an error (mirrors
    /// `_require_vault_unlocked`).
    fn require_vault_unlocked(&self) -> Result<UnlockedVault> {
        self.inkbox.vault().unlocked().ok_or_else(|| {
            InkboxError::VaultKey(
                "Vault has not been unlocked. Call inkbox.vault().unlock(vault_key) first.".into(),
            )
        })
    }

    /// Return the mailbox email address or an error (mirrors `_require_mailbox`).
    fn require_mailbox(&self) -> Result<String> {
        match self.mailbox.borrow().as_ref() {
            Some(m) => Ok(m.email_address.clone()),
            None => Err(InkboxError::InvalidArgument(format!(
                "Identity '{}' has no mailbox — this should only be reachable on a deleted identity.",
                self.agent_handle()
            ))),
        }
    }

    /// Return the phone-number id (as string) or an error (mirrors `_require_phone`).
    fn require_phone_id(&self) -> Result<String> {
        Ok(self.require_phone_number()?.id.to_string())
    }

    /// Return the phone number's E.164 string or an error.
    fn require_phone(&self) -> Result<String> {
        Ok(self.require_phone_number()?.number)
    }

    /// Shared phone-presence guard returning a clone of the channel.
    fn require_phone_number(&self) -> Result<IdentityPhoneNumber> {
        match self.phone_number.borrow().as_ref() {
            Some(p) => Ok(p.clone()),
            None => Err(InkboxError::InvalidArgument(format!(
                "Identity '{}' has no phone number assigned. Call \
                 identity.provision_phone_number() first, or pass phone_number to create_identity().",
                self.agent_handle()
            ))),
        }
    }

    /// Error out when this identity is not iMessage-enabled (mirrors `_require_imessage`).
    fn require_imessage(&self) -> Result<()> {
        if !self.data.borrow().summary.imessage_enabled {
            return Err(InkboxError::InvalidArgument(format!(
                "Identity '{}' is not iMessage-enabled. Call \
                 identity.update(imessage_enabled=True) first, or pass \
                 imessage_enabled=True to create_identity().",
                self.agent_handle()
            )));
        }
        Ok(())
    }
}

impl std::fmt::Debug for AgentIdentity {
    /// Mirrors the Python `__repr__`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mailbox = self
            .mailbox
            .borrow()
            .as_ref()
            .map(|m| m.email_address.clone());
        let phone = self
            .phone_number
            .borrow()
            .as_ref()
            .map(|p| p.number.clone());
        f.debug_struct("AgentIdentity")
            .field("agent_handle", &self.agent_handle())
            .field("mailbox", &mailbox)
            .field("phone", &phone)
            .finish()
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use super::*;
    use crate::identities::types::AgentIdentityData;

    /// The fixture identity's UUID, shared by the scoping assertions below.
    const IDENTITY_ID: &str = "11111111-1111-1111-1111-111111111111";

    /// Build an identity (optionally with a phone number) backed by a client
    /// pointed at `base_url`.
    fn identity_at(base_url: &str, with_phone: bool) -> AgentIdentity {
        let mut payload = json!({
            "id": IDENTITY_ID,
            "organization_id": "org_x",
            "agent_handle": "support-bot",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
        });
        if with_phone {
            payload["phone_number"] = json!({
                "id": "44444444-4444-4444-4444-444444444444",
                "number": "+15550001111",
                "type": "local",
                "status": "active",
                "incoming_call_action": "auto_reject",
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-01T00:00:00+00:00",
            });
        }
        let data: AgentIdentityData = serde_json::from_value(payload).unwrap();
        let inkbox = Inkbox::builder("test-key")
            .base_url(base_url)
            .build()
            .unwrap();
        AgentIdentity::new(data, inkbox)
    }

    /// Build a phoneless identity backed by a client pointed at an unreachable
    /// localhost port, so any real request fails fast instead of hanging.
    fn phoneless_identity() -> AgentIdentity {
        identity_at("http://127.0.0.1:1", false)
    }

    /// A `PhoneCall` response payload for the delegator tests.
    fn call_json(origin: &str, local: serde_json::Value) -> serde_json::Value {
        json!({
            "id": "22222222-2222-2222-2222-222222222222",
            "local_phone_number": local,
            "remote_phone_number": "+15550002222",
            "direction": "outbound",
            "status": "initiated",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
            "is_blocked": false,
            "origin": origin
        })
    }

    #[test]
    fn list_phone_contact_rules_does_not_prethrow_without_phone() {
        let identity = phoneless_identity();
        // List must not prethrow the phone guard: with no server it surfaces a
        // transport error, never InvalidArgument("no phone number").
        if let Err(InkboxError::InvalidArgument(m)) =
            identity.list_phone_contact_rules(None, None, None, None)
        {
            panic!("list prethrew the phone guard: {m}");
        }
    }

    #[test]
    fn phone_rule_cgud_still_requires_phone_number() {
        let identity = phoneless_identity();
        let results = [
            identity.get_phone_contact_rule("rid").err(),
            identity
                .create_phone_contact_rule(
                    PhoneRuleAction::Block,
                    "+14155550199",
                    PhoneRuleMatchType::ExactNumber,
                )
                .err(),
            identity
                .update_phone_contact_rule("rid", Some(PhoneRuleAction::Block), None)
                .err(),
            identity.delete_phone_contact_rule("rid").err(),
        ];
        for res in results {
            match res {
                Some(InkboxError::InvalidArgument(m)) => {
                    assert!(m.contains("no phone number"), "unexpected message: {m}");
                }
                other => panic!("expected phone-required error, got {other:?}"),
            }
        }
    }

    #[test]
    fn place_call_dedicated_uses_identitys_own_number() {
        let server = MockServer::start();
        // Exact body: from_number is this identity's provisioned number, and
        // no agent_identity_id key rides along for dedicated origination.
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "dedicated_number",
                    "from_number": "+15550001111"
                }));
            then.status(200)
                .json_body(call_json("dedicated_number", json!("+15550001111")));
        });
        let identity = identity_at(&server.base_url(), true);
        let placed = identity
            .place_call("+15550002222", CallOrigin::DedicatedNumber, None)
            .unwrap();
        mock.assert();
        assert_eq!(placed.call.origin, CallOrigin::DedicatedNumber);
    }

    #[test]
    fn place_call_shared_scopes_by_identity_id_without_phone() {
        let server = MockServer::start();
        // Exact body: identity id in, from_number key never serialized. A
        // phoneless identity proves shared origination needs no number.
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "shared_imessage_number",
                    "agent_identity_id": IDENTITY_ID
                }));
            then.status(200)
                .json_body(call_json("shared_imessage_number", serde_json::Value::Null));
        });
        let identity = identity_at(&server.base_url(), false);
        let placed = identity
            .place_call("+15550002222", CallOrigin::SharedImessageNumber, None)
            .unwrap();
        mock.assert();
        assert_eq!(placed.call.origin, CallOrigin::SharedImessageNumber);
        assert_eq!(placed.call.local_phone_number, None);
    }

    #[test]
    fn place_call_forwards_client_websocket_url() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/phone/place-call")
                .json_body(json!({
                    "to_number": "+15550002222",
                    "origination": "shared_imessage_number",
                    "agent_identity_id": IDENTITY_ID,
                    "client_websocket_url": "wss://example.com/audio"
                }));
            then.status(200)
                .json_body(call_json("shared_imessage_number", serde_json::Value::Null));
        });
        let identity = identity_at(&server.base_url(), false);
        identity
            .place_call(
                "+15550002222",
                CallOrigin::SharedImessageNumber,
                Some("wss://example.com/audio"),
            )
            .unwrap();
        mock.assert();
    }

    #[test]
    fn list_calls_scopes_by_own_identity_id() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls")
                .query_param("agent_identity_id", IDENTITY_ID)
                .query_param("limit", "10")
                .query_param("offset", "2")
                .query_param("is_blocked", "false");
            then.status(200).json_body(json!([call_json(
                "dedicated_number",
                json!("+15550001111")
            )]));
        });
        let identity = identity_at(&server.base_url(), false);
        let calls = identity.list_calls(10, 2, Some(false)).unwrap();
        mock.assert();
        assert_eq!(calls.len(), 1);
    }

    #[test]
    fn list_transcripts_delegates_to_calls_resource() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/calls/22222222-2222-2222-2222-222222222222/transcripts");
            then.status(200).json_body(json!([{
                "id": "55555555-5555-5555-5555-555555555555",
                "call_id": "22222222-2222-2222-2222-222222222222",
                "seq": 0,
                "ts_ms": 0,
                "party": "remote",
                "text": "Hi",
                "created_at": "2026-06-01T00:00:02+00:00"
            }]));
        });
        let identity = identity_at(&server.base_url(), false);
        let segments = identity
            .list_transcripts("22222222-2222-2222-2222-222222222222")
            .unwrap();
        mock.assert();
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].text, "Hi");
    }

    #[test]
    fn get_incoming_call_action_scopes_by_own_identity_id() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/incoming-call-action")
                .query_param("agent_identity_id", IDENTITY_ID);
            then.status(200).json_body(json!({
                "agent_identity_id": IDENTITY_ID,
                "incoming_call_action": "auto_accept",
                "client_websocket_url": "wss://example.com/audio"
            }));
        });
        let identity = identity_at(&server.base_url(), false);
        let config = identity.get_incoming_call_action().unwrap();
        mock.assert();
        assert_eq!(config.incoming_call_action, IncomingCallAction::AutoAccept);
        assert_eq!(config.agent_identity_id.to_string(), IDENTITY_ID);
    }

    #[test]
    fn set_incoming_call_action_forwards_args_and_own_identity_id() {
        let server = MockServer::start();
        // Exact PUT body: action + this identity's id + both forwarded URLs.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/incoming-call-action")
                .json_body(json!({
                    "incoming_call_action": "webhook",
                    "agent_identity_id": IDENTITY_ID,
                    "client_websocket_url": "wss://example.com/audio",
                    "incoming_call_webhook_url": "https://example.com/route"
                }));
            then.status(200).json_body(json!({
                "agent_identity_id": IDENTITY_ID,
                "incoming_call_action": "webhook",
                "client_websocket_url": "wss://example.com/audio",
                "incoming_call_webhook_url": "https://example.com/route"
            }));
        });
        let identity = identity_at(&server.base_url(), false);
        let config = identity
            .set_incoming_call_action(
                IncomingCallAction::Webhook,
                Some("wss://example.com/audio"),
                Some("https://example.com/route"),
            )
            .unwrap();
        mock.assert();
        assert_eq!(config.incoming_call_action, IncomingCallAction::Webhook);
        assert_eq!(
            config.incoming_call_webhook_url.as_deref(),
            Some("https://example.com/route")
        );
    }
}

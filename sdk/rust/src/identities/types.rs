//! Structs/enums mirroring the Inkbox Identities API response models.
//!
//! Faithful port of `inkbox/identities/types.py`. Field names are already
//! snake_case and match the wire JSON, so no serde renames are needed on
//! structs. Timestamps arrive as ISO strings and are kept as `String` (the
//! contract forbids inventing chrono). Optional/absent fields are `Option<T>`
//! with `#[serde(default)]` so older server responses parse cleanly.
//!
//! The shared `FilterMode` / `FilterModeChangeNotice` come from
//! [`crate::mail::types`]; `SmsStatus` from [`crate::phone::types`]; `Tunnel`
//! and `TLSMode` from [`crate::tunnels::types`] (the tunnels domain is ported
//! separately).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use uuid::Uuid;

use crate::imessage::types::IdentityIMessageNumber;
use crate::mail::types::{FilterMode, FilterModeChangeNotice};
use crate::phone::types::SmsStatus;
use crate::tunnels::types::Tunnel;

// ---------------------------------------------------------------------------
// Sentinel ("field omitted" vs explicit `null").
//
// Python uses a single shared `_UNSET = object()` so that identity-based
// `is not _UNSET` checks line up across `client.py`, `agent_identity.py`, and
// `identities/resources/identities.py`. In Rust we model the same three-way
// distinction with the `Unset<T>` enum below (per the porting contract §6):
//
//   * `Unset::Omit`          -> the key is left out of the request body
//   * `Unset::Value(None)`   -> the key is sent as explicit JSON `null`
//   * `Unset::Value(Some(x))`-> the key is sent with value `x`
//
// `Option<Option<T>>` would also work; the named enum reads more clearly at
// the call sites that need to clear a column versus leave it untouched.
// ---------------------------------------------------------------------------

/// Three-state sentinel distinguishing "omit the field" from "send explicit
/// `null`" from "send a value", mirroring the Python `_UNSET` sentinel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Unset<T> {
    /// Omit the key from the request body entirely (defer to the server).
    Omit,
    /// Send the key. `None` becomes explicit JSON `null` (clears the column).
    Value(Option<T>),
}

// Not derived: `#[derive(Default)]` would add a spurious `T: Default` bound,
// but `Omit` needs none — keep the impl unconstrained over `T`.
#[allow(clippy::derivable_impls)]
impl<T> Default for Unset<T> {
    fn default() -> Self {
        Unset::Omit
    }
}

impl<T> Unset<T> {
    /// True when the field should be omitted from the wire body.
    pub fn is_omit(&self) -> bool {
        matches!(self, Unset::Omit)
    }
}

// ---------------------------------------------------------------------------
// Create-option structs (nested under identity creation).
// ---------------------------------------------------------------------------

/// Optional mailbox payload nested under identity creation.
///
/// # Fields
/// * `email_local_part` (`Option<String>`) - Optional requested local part to
///   use before the sending domain. On the platform domain the server forces
///   it to the agent handle, so this only matters on a custom sending domain.
/// * `sending_domain` (`Unset<String>`) - Optional sending-domain selector by
///   **bare domain name** (not an id). Leave as `Unset::Omit` to inherit the
///   org default; `Unset::Value(None)` forces the platform default; a verified
///   custom-domain name (e.g. `"mail.acme.com"`) binds to it.
#[derive(Debug, Clone)]
pub struct IdentityMailboxCreateOptions {
    pub email_local_part: Option<String>,
    pub sending_domain: Unset<String>,
}

impl Default for IdentityMailboxCreateOptions {
    fn default() -> Self {
        Self {
            email_local_part: None,
            sending_domain: Unset::Omit,
        }
    }
}

impl IdentityMailboxCreateOptions {
    /// Return a JSON object matching the API schema, omitting unset keys.
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        if let Some(local) = &self.email_local_part {
            body.insert("email_local_part".into(), Value::String(local.clone()));
        }
        // `sending_domain` is only emitted when not `Omit`; `Value(None)` sends null.
        if let Unset::Value(domain) = &self.sending_domain {
            body.insert(
                "sending_domain".into(),
                match domain {
                    Some(d) => Value::String(d.clone()),
                    None => Value::Null,
                },
            );
        }
        Value::Object(body)
    }
}

/// Optional nested tunnel spec for identity creation.
///
/// # Fields
/// * `tls_mode` (`Option<String>`) - `"edge"` (default) or `"passthrough"`.
///   Kept as a string to match the wire `.value`; the typed
///   [`crate::tunnels::types::TLSMode`] callers may pass `mode.as_str()`.
#[derive(Debug, Clone, Default)]
pub struct IdentityTunnelCreateOptions {
    pub tls_mode: Option<String>,
}

impl IdentityTunnelCreateOptions {
    /// Return a JSON object matching the API schema, omitting unset keys.
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        if let Some(mode) = &self.tls_mode {
            body.insert("tls_mode".into(), Value::String(mode.clone()));
        }
        Value::Object(body)
    }
}

/// Optional phone-number provisioning payload nested under identity creation.
///
/// # Fields
/// * `r#type` (`String`) - Type of phone number to provision. Only `"local"`
///   is supported; defaults to `"local"`.
/// * `state` (`Option<String>`) - Optional US state abbreviation filter for
///   local numbers.
/// * `incoming_call_action` (`String`) - How to handle inbound calls. Defaults
///   to `"auto_reject"`.
/// * `client_websocket_url` (`Option<String>`) - WebSocket URL for
///   `"auto_accept"` call handling.
/// * `incoming_call_webhook_url` (`Option<String>`) - Webhook URL for
///   `"webhook"` call handling.
#[derive(Debug, Clone)]
pub struct IdentityPhoneNumberCreateOptions {
    pub r#type: String,
    pub state: Option<String>,
    pub incoming_call_action: String,
    pub client_websocket_url: Option<String>,
    pub incoming_call_webhook_url: Option<String>,
}

impl Default for IdentityPhoneNumberCreateOptions {
    fn default() -> Self {
        Self {
            r#type: "local".to_string(),
            state: None,
            incoming_call_action: "auto_reject".to_string(),
            client_websocket_url: None,
            incoming_call_webhook_url: None,
        }
    }
}

impl IdentityPhoneNumberCreateOptions {
    /// Return a JSON object matching the API schema, validating the same
    /// invariants the Python `to_wire` raises `ValueError` for.
    pub fn to_wire(&self) -> crate::error::Result<Value> {
        // auto_accept needs a client websocket; webhook needs a webhook URL.
        if self.incoming_call_action == "auto_accept" && self.client_websocket_url.is_none() {
            return Err(crate::error::InkboxError::InvalidArgument(
                "client_websocket_url is required for auto_accept".into(),
            ));
        }
        if self.incoming_call_action == "webhook" && self.incoming_call_webhook_url.is_none() {
            return Err(crate::error::InkboxError::InvalidArgument(
                "incoming_call_webhook_url is required for webhook".into(),
            ));
        }

        let mut body = Map::new();
        body.insert("type".into(), Value::String(self.r#type.clone()));
        body.insert(
            "incoming_call_action".into(),
            Value::String(self.incoming_call_action.clone()),
        );
        if let Some(state) = &self.state {
            body.insert("state".into(), Value::String(state.clone()));
        }
        if let Some(url) = &self.client_websocket_url {
            body.insert("client_websocket_url".into(), Value::String(url.clone()));
        }
        if let Some(url) = &self.incoming_call_webhook_url {
            body.insert(
                "incoming_call_webhook_url".into(),
                Value::String(url.clone()),
            );
        }
        Ok(Value::Object(body))
    }
}

/// Vault secret selection on the wire: a single id, a list of ids, or one of
/// the literals `"*"` / `"all"`, mirroring the Python
/// `UUID | str | list[UUID | str] | Literal["*", "all"] | None`.
#[derive(Debug, Clone)]
pub enum VaultSecretIds {
    /// A single secret id (UUID or already-stringified id).
    One(String),
    /// An explicit list of secret ids.
    Many(Vec<String>),
    /// The `"*"` / `"all"` wildcard literals, passed through verbatim.
    Wildcard(String),
}

impl VaultSecretIds {
    /// Render to the JSON shape the server expects (`str` or `list[str]`),
    /// mirroring `vault_secret_ids_to_wire`.
    pub fn to_wire(&self) -> Value {
        match self {
            VaultSecretIds::One(s) => Value::String(s.clone()),
            VaultSecretIds::Wildcard(s) => Value::String(s.clone()),
            VaultSecretIds::Many(v) => Value::Array(v.iter().cloned().map(Value::String).collect()),
        }
    }
}

// ---------------------------------------------------------------------------
// Response models.
// ---------------------------------------------------------------------------

fn default_filter_mode_blacklist() -> FilterMode {
    FilterMode::Blacklist
}

/// Mailbox channel linked to an agent identity.
///
/// `agent_identity_id` mirrors the same field on [`crate::mail::types::Mailbox`];
/// on the embedded variant it is non-null for live customer mailboxes (1:1
/// invariant) and null only on deleted rows and system mailboxes.
///
/// `sending_domain` is the bare domain the mailbox sends from, derived from
/// `email_address` when the server omits it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityMailbox {
    pub id: Uuid,
    pub email_address: String,
    /// Defaults to `Blacklist` when the server omits the field.
    #[serde(default = "default_filter_mode_blacklist")]
    pub filter_mode: FilterMode,
    pub created_at: String,
    pub updated_at: String,
    /// Bare domain the mailbox sends from. Server may omit it, in which case it
    /// is derived from the local part of `email_address` (see [`Self::from_value`]).
    #[serde(default)]
    pub sending_domain: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_mode_change_notice: Option<FilterModeChangeNotice>,
}

impl IdentityMailbox {
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

    /// Deserialize from a raw transport value, applying the `sending_domain`
    /// backfill.
    pub(crate) fn from_value(v: Value) -> crate::error::Result<Self> {
        let mailbox: IdentityMailbox = serde_json::from_value(v)?;
        Ok(mailbox.normalize())
    }
}

fn default_sms_status_ready() -> SmsStatus {
    // Older server responses predate `sms_status`; default to READY, matching
    // the Python parser.
    SmsStatus::Ready
}

/// Phone number channel linked to an agent identity.
///
/// `agent_identity_id` mirrors the same field on
/// [`crate::phone::types::PhoneNumber`]; on the embedded variant it always
/// equals the owning identity's ID. SMS-readiness fields (`sms_status`,
/// `sms_error_code`, `sms_error_detail`, `sms_ready_at`) reflect 10DLC / TFV
/// provisioning progress.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityPhoneNumber {
    pub id: Uuid,
    pub number: String,
    pub r#type: String,
    pub status: String,
    /// Defaults to `ready` when absent (older server responses).
    #[serde(default = "default_sms_status_ready")]
    pub sms_status: SmsStatus,
    pub incoming_call_action: String,
    #[serde(default)]
    pub client_websocket_url: Option<String>,
    #[serde(default)]
    pub incoming_call_webhook_url: Option<String>,
    /// Defaults to `blacklist` when absent.
    #[serde(default = "default_filter_mode_blacklist")]
    pub filter_mode: FilterMode,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_error_detail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sms_ready_at: Option<String>,
    /// 2-letter US state abbreviation (e.g. `"NY"`); null if not set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter_mode_change_notice: Option<FilterModeChangeNotice>,
}

/// Lightweight agent identity returned by list endpoints.
///
/// `imessage_enabled` / `imessage_filter_mode` describe iMessage reachability
/// and filtering. Detailed identities may also carry an attached dedicated
/// number.
///
/// `mail_filter_mode` / `phone_filter_mode` are the whitelist/blacklist modes
/// for this identity's mail and phone contact rules. They live on the identity
/// (set via `identity.update(...)`); the same field on the mailbox /
/// phone-number objects is the deprecated legacy mirror.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentitySummary {
    pub id: Uuid,
    pub organization_id: String,
    pub agent_handle: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub email_address: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    /// Defaults to `false` when the server omits the field.
    #[serde(default)]
    pub imessage_enabled: bool,
    /// Defaults to `blacklist` when absent.
    #[serde(default = "default_filter_mode_blacklist")]
    pub imessage_filter_mode: FilterMode,
    /// Whitelist/blacklist mode for this identity's mail contact rules.
    /// Defaults to `blacklist` when absent.
    #[serde(default = "default_filter_mode_blacklist")]
    pub mail_filter_mode: FilterMode,
    /// Whitelist/blacklist mode for this identity's phone contact rules.
    /// Defaults to `blacklist` when absent.
    #[serde(default = "default_filter_mode_blacklist")]
    pub phone_filter_mode: FilterMode,
    /// Whether this identity has a webhook signing key configured. Status only,
    /// never the secret. Defaults to `false` when the server omits the field.
    #[serde(default)]
    pub signing_key_configured: bool,
    /// When the signing key was created, or `None` if none is configured.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signing_key_created_at: Option<String>,
}

/// Agent identity with linked communication channels and tunnel.
///
/// Returned by identity-create and identity-get endpoints. Users normally
/// interact with [`crate::AgentIdentity`] instead. The summary fields are
/// flattened so the wire shape is identical.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentIdentityData {
    #[serde(flatten)]
    pub summary: AgentIdentitySummary,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mailbox: Option<IdentityMailbox>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phone_number: Option<IdentityPhoneNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imessage_number: Option<IdentityIMessageNumber>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tunnel: Option<Tunnel>,
}

impl AgentIdentityData {
    /// Deserialize from a raw transport value, applying the embedded mailbox's
    /// `sending_domain` backfill (the nested `Tunnel` / `PhoneNumber` need no
    /// post-processing).
    pub(crate) fn from_value(v: Value) -> crate::error::Result<Self> {
        let mut data: AgentIdentityData = serde_json::from_value(v)?;
        if let Some(mailbox) = data.mailbox.take() {
            // Re-run the sending_domain backfill through the dedicated path.
            let mailbox = serde_json::to_value(mailbox)?;
            data.mailbox = Some(IdentityMailbox::from_value(mailbox)?);
        }
        Ok(data)
    }
}

/// A single identity-visibility grant on a target identity.
///
/// `viewer_identity_id=None` is the wildcard sentinel — every active identity
/// in the org can see the target. Otherwise it is a per-viewer grant naming
/// exactly one viewer identity.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IdentityAccess {
    pub id: Uuid,
    pub target_identity_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub viewer_identity_id: Option<Uuid>,
    pub created_at: String,
}

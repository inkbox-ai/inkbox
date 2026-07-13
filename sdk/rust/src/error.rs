//! Canonical error types for the Inkbox SDK.
//!
//! Mirrors `inkbox/exceptions.py`: a single [`InkboxError`] enum stands in for
//! the Python exception hierarchy (`InkboxError` base, `InkboxAPIError`, and
//! the structured 4xx/409/403 subclasses), plus the SDK-internal transport
//! and decoding failures that Python surfaces as `httpx`/`json` errors.

use serde_json::Value;
use uuid::Uuid;

/// Result alias used throughout the SDK.
pub type Result<T> = std::result::Result<T, InkboxError>;

/// Base error for all Inkbox SDK failures.
#[derive(Debug, thiserror::Error)]
pub enum InkboxError {
    /// The API returned a 4xx or 5xx response. Carries the HTTP status code
    /// and the parsed `detail` (a plain string, or a structured object for
    /// errors that ship machine-readable fields).
    #[error("HTTP {status_code}: {detail}")]
    Api {
        /// HTTP status code.
        status_code: u16,
        /// Error detail from the response body.
        detail: ApiErrorDetail,
    },

    /// 409 when creating a mail/phone/iMessage contact rule that duplicates an
    /// existing `(match_type, match_target)` pair on the same resource.
    #[error("HTTP {status_code}: duplicate contact rule (existing_rule_id={existing_rule_id})")]
    DuplicateContactRule {
        status_code: u16,
        /// UUID of the already-existing rule.
        existing_rule_id: Uuid,
        /// Full structured detail from the server. Boxed to keep `InkboxError`
        /// small (this variant is rare; `serde_json::Value` is ~72 bytes).
        detail: Box<Value>,
    },

    /// 409 when posting a contact-access grant that is redundant under the
    /// current access model (e.g. a per-identity grant atop an active wildcard).
    #[error("HTTP {status_code}: redundant contact access grant ({error})")]
    RedundantContactAccessGrant {
        status_code: u16,
        /// Discriminator string from the server (`"redundant_grant"`).
        error: String,
        /// Human-readable explanation from the server's `detail` field.
        detail_message: String,
        /// Full structured detail from the server. Boxed to keep `InkboxError`
        /// small (this variant is rare; `serde_json::Value` is ~72 bytes).
        detail: Box<Value>,
    },

    /// 403 when an SMS, call, or iMessage destination is blocked by an outbound
    /// contact rule on the sender (or the sender's `filter_mode` default).
    #[error("HTTP {status_code}: recipient blocked ({address})")]
    RecipientBlocked {
        status_code: u16,
        /// UUID of the rule that blocked the recipient, or `None` when the
        /// block came from the phone number's `filter_mode` default.
        matched_rule_id: Option<Uuid>,
        /// The blocked counterparty (E.164 phone number).
        address: String,
        /// Human-readable explanation from the server.
        reason: String,
        /// Full structured detail from the server. Boxed to keep `InkboxError`
        /// small (this variant is rare; `serde_json::Value` is ~72 bytes).
        detail: Box<Value>,
    },

    /// 402 when an outbound mail send would push the mailbox past its plan's
    /// storage cap. Raised by `messages().send()`, `reply_all()`, and
    /// `forward()`. Free space with `messages().delete()` /
    /// `threads().delete()`, or upgrade the plan at `upgrade_url`.
    #[error("HTTP {status_code}: storage limit exceeded ({message})")]
    StorageLimitExceeded {
        status_code: u16,
        /// Human-readable explanation from the server.
        message: String,
        /// Billing page where the plan can be upgraded.
        upgrade_url: String,
        /// The mailbox's storage cap in binary bytes, when supplied by the server.
        limit_bytes: Option<u64>,
        /// Full structured detail from the server. Boxed to keep `InkboxError`
        /// small (this variant is rare; `serde_json::Value` is ~72 bytes).
        detail: Box<Value>,
    },

    /// A vault key did not meet requirements, or a vault crypto operation failed.
    /// Mirrors `InkboxVaultKeyError`.
    #[error("vault key error: {0}")]
    VaultKey(String),

    /// A value supplied by the caller failed local validation (mirrors the
    /// `ValueError`/`TypeError` raised by the Python SDK before any request).
    #[error("invalid argument: {0}")]
    InvalidArgument(String),

    /// A tunnels-specific failure. See [`crate::tunnels::exceptions`].
    #[error("tunnel error: {0}")]
    Tunnel(String),

    /// Transport-level failure (connection, timeout, TLS) — Python's `httpx`
    /// errors.
    #[error("transport error: {0}")]
    Transport(#[from] reqwest::Error),

    /// Response body could not be decoded as the expected JSON shape.
    #[error("decode error: {0}")]
    Decode(#[from] serde_json::Error),
}

impl InkboxError {
    /// True iff this is the terminal "another client took over this tunnel"
    /// error surfaced by a tunnel client's `serve_forever`. Terminal by
    /// design: the client has stopped and will not reconnect. Lets callers
    /// tell a takeover apart from a transient, reconnectable tunnel error.
    pub fn is_tunnel_superseded(&self) -> bool {
        matches!(self, InkboxError::Tunnel(m) if m.starts_with("tunnel-superseded:"))
    }
}

/// The `detail` payload on an [`InkboxError::Api`]: either a human-readable
/// string or a structured object, matching the Python `str | dict` union.
#[derive(Debug, Clone)]
pub enum ApiErrorDetail {
    /// A plain human-readable message.
    Message(String),
    /// A structured object carrying machine-readable fields.
    Structured(Value),
}

impl std::fmt::Display for ApiErrorDetail {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ApiErrorDetail::Message(s) => f.write_str(s),
            ApiErrorDetail::Structured(v) => write!(f, "{v}"),
        }
    }
}

impl ApiErrorDetail {
    /// Borrow the structured object, if this detail is one.
    pub fn as_object(&self) -> Option<&Value> {
        match self {
            ApiErrorDetail::Structured(v) => Some(v),
            ApiErrorDetail::Message(_) => None,
        }
    }
}

//! Per-identity webhook signing key management.
//!
//! Faithful port of `inkbox/signing_keys.py`. Each agent identity has its own
//! signing key used to verify the webhooks (and WebSocket upgrades) for that
//! identity's mail / phone / iMessage traffic. Manage it via
//! [`SigningKeysResource::create_or_rotate`] / [`SigningKeysResource::get_status`]
//! (both keyed by `agent_handle`), or the `identity.create_signing_key()` /
//! `identity.get_signing_key_status()` convenience methods. The legacy
//! org-level calls are kept as deprecated bridges.
//!
//! The free [`verify_webhook`] function used by receivers to authenticate
//! inbound webhook requests is unchanged.

use std::collections::HashMap;
use std::sync::Arc;

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

type HmacSha256 = Hmac<Sha256>;

/// Deprecated org-level route. Per-identity routes use [`identity_path`].
const ORG_PATH: &str = "/signing-keys";

/// Per-identity signing-key route.
fn identity_path(agent_handle: &str) -> String {
    format!("/identities/{agent_handle}/signing-key")
}

/// A webhook signing key.
///
/// Returned once on creation/rotation -- store `signing_key` securely.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningKey {
    pub signing_key: String,
    // ISO 8601 timestamp string (Python parses to `datetime`; the contract
    // keeps ISO strings as `String`).
    pub created_at: String,
}

/// Status of an identity's webhook signing key.
///
/// `configured` is `true` once a key exists; `created_at` is when it was
/// created or last rotated (`None` when not configured). The timestamp is kept
/// as a raw ISO 8601 `String` per the porting contract.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningKeyStatus {
    #[serde(default)]
    pub configured: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
}

/// Verify that an incoming webhook request was sent by Inkbox.
///
/// Recomputes the HMAC-SHA256 over `"{request_id}.{timestamp}."` followed by
/// the raw body bytes, keyed by the signing secret (with any `whsec_` prefix
/// stripped), and compares it against the `sha256=`-prefixed
/// `X-Inkbox-Signature` header in constant time. Header lookups are
/// case-insensitive.
///
/// # Arguments
/// * `payload` - Raw request body bytes (do not parse/re-serialize).
/// * `headers` - Request headers (keys are lowercased internally).
/// * `secret` - Your signing key, with or without a `whsec_` prefix.
///
/// # Returns
/// `true` if the signature is valid, `false` otherwise.
pub fn verify_webhook(
    payload: &[u8],
    headers: &HashMap<String, String>,
    secret: &str,
) -> Result<bool> {
    // Lowercase header keys so lookups are case-insensitive.
    let h: HashMap<String, &str> = headers
        .iter()
        .map(|(k, v)| (k.to_lowercase(), v.as_str()))
        .collect();
    let signature = h.get("x-inkbox-signature").copied().unwrap_or("");
    let request_id = h.get("x-inkbox-request-id").copied().unwrap_or("");
    let timestamp = h.get("x-inkbox-timestamp").copied().unwrap_or("");

    // Signature must carry the `sha256=` scheme prefix.
    let received = match signature.strip_prefix("sha256=") {
        Some(rest) => rest,
        None => return Ok(false),
    };

    // Drop the optional `whsec_` prefix from the secret.
    let key = secret.strip_prefix("whsec_").unwrap_or(secret);

    // Signed payload: "{request_id}.{timestamp}." + raw body bytes.
    let mut mac =
        HmacSha256::new_from_slice(key.as_bytes()).expect("HMAC accepts keys of any length");
    mac.update(format!("{request_id}.{timestamp}.").as_bytes());
    mac.update(payload);
    let expected = hex::encode(mac.finalize().into_bytes());

    // Constant-time compare of the lowercase hex digests, matching Python's
    // `hmac.compare_digest`. Differing lengths short-circuit to `false`
    // (compare_digest never raises here, unlike TS `timingSafeEqual`).
    let expected_bytes = expected.as_bytes();
    let received_bytes = received.as_bytes();
    if expected_bytes.len() != received_bytes.len() {
        return Ok(false);
    }
    Ok(expected_bytes.ct_eq(received_bytes).into())
}

/// Webhook signing key management.
///
/// Rides the api-root transport (`{base}/api/v1`) so it can address both the
/// per-identity routes (`/identities/{handle}/signing-key`) and the deprecated
/// org-level route (`/signing-keys`).
pub struct SigningKeysResource {
    http: Arc<HttpTransport>,
}

impl SigningKeysResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Create or rotate an agent identity's webhook signing key.
    ///
    /// The first call mints a key; subsequent calls rotate (replace) it. The
    /// plaintext `signing_key` is returned **once** -- store it securely as it
    /// cannot be retrieved again.
    ///
    /// Use the returned key to verify `X-Inkbox-Signature` headers on incoming
    /// webhook requests for this identity.
    ///
    /// # Returns
    /// The newly created/rotated signing key with its creation timestamp.
    pub fn create_or_rotate(&self, agent_handle: &str) -> Result<SigningKey> {
        // POST an empty JSON object, matching `json={}`.
        let body = json!({});
        let data = self
            .http
            .post(&identity_path(agent_handle), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Report whether an agent identity has a webhook signing key configured.
    pub fn get_status(&self, agent_handle: &str) -> Result<SigningKeyStatus> {
        let data = self.http.get(&identity_path(agent_handle), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create or rotate the signing key via the deprecated org-level route.
    ///
    /// With an agent-scoped API key the server rotates that key's identity;
    /// with an admin key it returns 409 ([`crate::error::InkboxError::Api`])
    /// pointing at the per-identity route (Sunset 2026-08-31). Prefer
    /// [`Self::create_or_rotate`] or `identity.create_signing_key()`.
    #[deprecated(
        note = "Signing keys are now per agent identity. Use create_or_rotate(agent_handle) \
                or identity.create_signing_key()."
    )]
    pub fn create_or_rotate_org(&self) -> Result<SigningKey> {
        let body = json!({});
        let data = self.http.post(ORG_PATH, Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Report signing-key status via the deprecated org-level route.
    ///
    /// With an agent-scoped key it reports that identity's status; with an admin
    /// key it reports an org-aggregate status (`configured` true if any identity
    /// in the org has a key) (Sunset 2026-08-31). Prefer [`Self::get_status`] or
    /// `identity.get_signing_key_status()`.
    #[deprecated(
        note = "Signing keys are now per agent identity. Use get_status(agent_handle) \
                or identity.get_signing_key_status()."
    )]
    pub fn get_status_org(&self) -> Result<SigningKeyStatus> {
        let data = self.http.get(ORG_PATH, NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

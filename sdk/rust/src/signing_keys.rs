//! Org-level webhook signing key management, shared across all Inkbox clients.
//!
//! Faithful port of `inkbox/signing_keys.py`: the `SigningKey` row, the
//! `SigningKeysResource` create/rotate endpoint, and the free `verify_webhook`
//! function used by receivers to authenticate inbound webhook requests.

use std::collections::HashMap;
use std::sync::Arc;

use hmac::{Hmac, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use subtle::ConstantTimeEq;

use crate::error::Result;
use crate::http::HttpTransport;

type HmacSha256 = Hmac<Sha256>;

const PATH: &str = "/signing-keys";

/// Org-level webhook signing key.
///
/// Returned once on creation/rotation -- store `signing_key` securely.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SigningKey {
    pub signing_key: String,
    // ISO 8601 timestamp string (Python parses to `datetime`; the contract
    // keeps ISO strings as `String`).
    pub created_at: String,
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

/// Org-level webhook signing key resource.
pub struct SigningKeysResource {
    http: Arc<HttpTransport>,
}

impl SigningKeysResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Create or rotate the webhook signing key for your organisation.
    ///
    /// The first call creates a new key; subsequent calls rotate (replace) the
    /// existing key. The plaintext `signing_key` is returned **once** -- store
    /// it securely as it cannot be retrieved again.
    ///
    /// Use the returned key to verify `X-Inkbox-Signature` headers on incoming
    /// webhook requests.
    ///
    /// # Returns
    /// The newly created/rotated signing key with its creation timestamp.
    pub fn create_or_rotate(&self) -> Result<SigningKey> {
        // POST an empty JSON object, matching `json={}`.
        let body = serde_json::json!({});
        let data = self.http.post(PATH, Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

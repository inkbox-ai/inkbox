//! Types for the Vault API and client-side structured secret payloads.
//!
//! Port of `inkbox/vault/types.py`. Wire field names are already snake_case so
//! no serde renames are needed on structs. Enums carry per-variant renames to
//! reproduce each Python `.value` exactly. Timestamps arrive as ISO strings
//! and are kept as `String` (the contract forbids inventing chrono).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::str::FromStr;
use uuid::Uuid;

use crate::error::{InkboxError, Result};
use crate::vault::totp::TOTPConfig;

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/// Category of credential stored in a vault secret.
///
/// Used as a client-side hint for which form to render. The server does not
/// validate or enforce payload structure (it's opaque ciphertext).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultSecretType {
    /// Single API token.
    ApiKey,
    /// Access key + secret key pair.
    KeyPair,
    /// Username/password combination, optionally with URL.
    Login,
    /// SSH private key, optionally with public key/fingerprint.
    SshKey,
    /// Freeform encrypted catch-all.
    Other,
}

impl VaultSecretType {
    /// The wire string value (matching Python's `StrEnum` `.value`).
    pub fn as_str(&self) -> &'static str {
        match self {
            VaultSecretType::ApiKey => "api_key",
            VaultSecretType::KeyPair => "key_pair",
            VaultSecretType::Login => "login",
            VaultSecretType::SshKey => "ssh_key",
            VaultSecretType::Other => "other",
        }
    }
}

impl std::str::FromStr for VaultSecretType {
    type Err = InkboxError;

    /// Parse from a wire string, mirroring `VaultSecretType(value)`.
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "api_key" => Ok(VaultSecretType::ApiKey),
            "key_pair" => Ok(VaultSecretType::KeyPair),
            "login" => Ok(VaultSecretType::Login),
            "ssh_key" => Ok(VaultSecretType::SshKey),
            "other" => Ok(VaultSecretType::Other),
            other => Err(InkboxError::InvalidArgument(format!(
                "Unknown secret_type: {other:?}"
            ))),
        }
    }
}

/// Discriminator for vault key records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum VaultKeyType {
    /// A standard vault key issued to users or agents.
    Primary,
    /// A recovery code generated at vault initialization, for offline backup.
    Recovery,
}

impl VaultKeyType {
    /// The wire string value.
    pub fn as_str(&self) -> &'static str {
        match self {
            VaultKeyType::Primary => "primary",
            VaultKeyType::Recovery => "recovery",
        }
    }
}

// ---------------------------------------------------------------------------
// API response types
// ---------------------------------------------------------------------------

/// Vault metadata returned by the info endpoint.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInfo {
    pub id: Uuid,
    pub organization_id: String,
    pub created_at: String,
    pub updated_at: String,
    pub key_count: i64,
    pub secret_count: i64,
    pub recovery_key_count: i64,
}

/// Vault key metadata (no wrapped key material).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultKey {
    pub id: Uuid,
    pub key_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Vault secret metadata (no encrypted payload).
///
/// `access` carries the secret's inlined access rules (who can read it) on
/// list and single-secret reads, so callers don't need a per-secret
/// `get_access` round-trip. Empty when the response omits access rules.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSecret {
    pub id: Uuid,
    pub name: String,
    pub secret_type: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub access: Vec<AccessRule>,
}

/// Vault secret including the encrypted payload (base64).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultSecretDetail {
    pub id: Uuid,
    pub name: String,
    pub secret_type: String,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub access: Vec<AccessRule>,
    #[serde(default)]
    pub encrypted_payload: String,
}

/// A rule granting an identity access to a vault secret.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccessRule {
    pub id: Uuid,
    pub vault_secret_id: Uuid,
    pub identity_id: Uuid,
    pub created_at: String,
}

/// Result of vault initialization.
///
/// `recovery_codes` must be stored securely — they cannot be retrieved again.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultInitializeResult {
    pub vault_id: Uuid,
    pub vault_key_id: Uuid,
    pub recovery_key_count: i64,
    pub recovery_codes: Vec<String>,
}

// ---------------------------------------------------------------------------
// Client-side structured secret payloads
// ---------------------------------------------------------------------------

/// Structured payload for `login` secrets.
///
/// At least one of `username` or `email` should be provided.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LoginPayload {
    /// Login password.
    pub password: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// Optional TOTP configuration for two-factor authentication.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub totp: Option<TOTPConfig>,
    /// Optional free-form notes (the `AbstractSecretPayload` catch-all).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Structured payload for `ssh_key` secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SSHKeyPayload {
    /// The SSH private key (PEM or OpenSSH format).
    pub private_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub public_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub passphrase: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Structured payload for `api_key` secrets (single token).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct APIKeyPayload {
    /// The API key or token.
    pub api_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Structured payload for `key_pair` secrets (access key + secret key).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KeyPairPayload {
    /// The access key identifier.
    pub access_key: String,
    /// The secret key.
    pub secret_key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub endpoint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// Structured payload for `other` secrets.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OtherPayload {
    /// Any freeform content.
    pub data: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
}

/// The tagged union of structured secret payloads.
///
/// Mirrors Python's `AbstractSecretPayload` hierarchy where each subclass
/// carries a class-level `secret_type` discriminator. The discriminator is
/// *not* serialized into the payload JSON itself — it travels in the
/// `secret_type` field of the surrounding `VaultSecret`. Use
/// [`SecretPayload::secret_type`] to recover the discriminator and
/// [`SecretPayload::to_value`] / [`SecretPayload::from_value`] to (de)serialize
/// the inner payload dict (omitting `None`-valued fields, like Python).
#[derive(Debug, Clone)]
pub enum SecretPayload {
    Login(LoginPayload),
    SshKey(SSHKeyPayload),
    ApiKey(APIKeyPayload),
    KeyPair(KeyPairPayload),
    Other(OtherPayload),
}

/// Backwards-compatible alias matching Python's `SecretPayload = AbstractSecretPayload`.
pub type AbstractSecretPayload = SecretPayload;

impl SecretPayload {
    /// Return the `secret_type` from the payload's class-level discriminator.
    /// Mirrors `_infer_secret_type`.
    pub fn secret_type(&self) -> VaultSecretType {
        match self {
            SecretPayload::Login(_) => VaultSecretType::Login,
            SecretPayload::SshKey(_) => VaultSecretType::SshKey,
            SecretPayload::ApiKey(_) => VaultSecretType::ApiKey,
            SecretPayload::KeyPair(_) => VaultSecretType::KeyPair,
            SecretPayload::Other(_) => VaultSecretType::Other,
        }
    }

    /// Serialize to a JSON object, omitting `None`-valued fields (Python's
    /// `_to_dict`). `serde`'s `skip_serializing_if = "Option::is_none"` on each
    /// payload struct already drops absent optionals, matching `asdict()`
    /// filtered for `None`.
    pub fn to_value(&self) -> Result<Value> {
        let v = match self {
            SecretPayload::Login(p) => serde_json::to_value(p)?,
            SecretPayload::SshKey(p) => serde_json::to_value(p)?,
            SecretPayload::ApiKey(p) => serde_json::to_value(p)?,
            SecretPayload::KeyPair(p) => serde_json::to_value(p)?,
            SecretPayload::Other(p) => serde_json::to_value(p)?,
        };
        Ok(v)
    }

    /// Deserialize a raw payload dict into the correct payload variant, keyed by
    /// `secret_type`. Mirrors `_parse_payload`.
    pub fn from_value(secret_type: &str, raw: Value) -> Result<Self> {
        let ty = VaultSecretType::from_str(secret_type)?;
        let payload = match ty {
            VaultSecretType::Login => SecretPayload::Login(serde_json::from_value(raw)?),
            VaultSecretType::SshKey => SecretPayload::SshKey(serde_json::from_value(raw)?),
            VaultSecretType::ApiKey => SecretPayload::ApiKey(serde_json::from_value(raw)?),
            VaultSecretType::KeyPair => SecretPayload::KeyPair(serde_json::from_value(raw)?),
            VaultSecretType::Other => SecretPayload::Other(serde_json::from_value(raw)?),
        };
        Ok(payload)
    }
}

/// A vault secret with its payload decrypted into a structured type.
#[derive(Debug, Clone)]
pub struct DecryptedVaultSecret {
    pub id: Uuid,
    pub name: String,
    pub secret_type: String,
    pub created_at: String,
    pub updated_at: String,
    pub payload: SecretPayload,
    pub description: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{VaultSecret, VaultSecretDetail};

    fn secret_json() -> serde_json::Value {
        json!({
            "id": "cccc3333-0000-0000-0000-000000000001",
            "name": "Cloud Service",
            "description": null,
            "secret_type": "login",
            "created_at": "2026-03-18T12:00:00Z",
            "updated_at": "2026-03-18T12:00:00Z"
        })
    }

    #[test]
    fn vault_secret_defaults_missing_access_to_empty() {
        let secret: VaultSecret = serde_json::from_value(secret_json()).unwrap();
        assert!(secret.access.is_empty());
    }

    #[test]
    fn vault_secret_detail_parses_inlined_access() {
        let mut value = secret_json();
        let object = value.as_object_mut().unwrap();
        object.insert("encrypted_payload".into(), json!("abc123"));
        object.insert(
            "access".into(),
            json!([{
                "id": "dddd4444-0000-0000-0000-000000000001",
                "vault_secret_id": "cccc3333-0000-0000-0000-000000000001",
                "identity_id": "eeee5555-0000-0000-0000-000000000001",
                "created_at": "2026-03-18T12:00:00Z"
            }]),
        );

        let secret: VaultSecretDetail = serde_json::from_value(value).unwrap();
        assert_eq!(secret.encrypted_payload, "abc123");
        assert_eq!(secret.access.len(), 1);
    }
}

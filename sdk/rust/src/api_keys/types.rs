//! API-key response models, mirroring `inkbox/api_keys/types.py`.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle state of an API key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApiKeyStatus {
    /// Key is active and may authenticate.
    Active,
    /// Key has been revoked.
    Revoked,
}

/// Public representation of an API key (no secret material).
///
/// # Fields
/// - `id`: API key identifier in `ApiKey_<uuid4>` format.
/// - `organization_id`: Owning organization's Clerk ID.
/// - `created_by`: Creator identifier (Clerk user ID for humans, identity
///   UUID for agents).
/// - `creator_type`: `"human"` or `"agent"`.
/// - `scoped_identity_id`: UUID of the agent identity this key is scoped to,
///   or `None` for an admin (unscoped) key with full org-wide authority.
/// - `label`: Human-readable name for the key.
/// - `description`: Optional free-text description.
/// - `status`: Current lifecycle status (active or revoked).
/// - `last4`: Last 4 characters of the secret, for display.
/// - `display_prefix`: Truncated key ID prefix for display.
/// - `last_used_at`: Timestamp of last successful authentication, or `None`.
/// - `expires_at`: Expiration timestamp, or `None` for non-expiring keys.
/// - `revoked_at`: Revocation timestamp, or `None` if still active.
/// - `created_at`: Row creation timestamp.
/// - `updated_at`: Row last-modified timestamp.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKey {
    pub id: String,
    pub organization_id: String,
    pub created_by: String,
    pub creator_type: String,
    // Optional on the wire; absent or null → None.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scoped_identity_id: Option<Uuid>,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub status: ApiKeyStatus,
    pub last4: String,
    pub display_prefix: String,
    // ISO-8601 timestamp strings (Python parses with datetime.fromisoformat).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revoked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Result of [`crate::api_keys::resources::api_keys::ApiKeysResource::create`].
///
/// The `api_key` secret is shown ONCE — persist it immediately; it cannot
/// be retrieved later.
///
/// # Fields
/// - `api_key`: Full API key string (use as `X-API-Key`).
/// - `record`: Public metadata for the newly created key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CreatedApiKey {
    pub api_key: String,
    pub record: ApiKey,
}

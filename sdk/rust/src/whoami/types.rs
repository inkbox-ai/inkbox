//! Types for the `GET /api/whoami` endpoint, mirroring `inkbox/whoami/types.py`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::Result;

// Named constants for the `auth_subtype` values returned on API-key responses.
// The field itself is typed as a free-form `String` because the server may add
// more variants over time; these constants are the current set.
pub const AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED: &str = "api_key.admin_scoped";
pub const AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED: &str = "api_key.agent_scoped.claimed";
pub const AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED: &str = "api_key.agent_scoped.unclaimed";

/// Returned when the caller authenticates with an API key.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhoamiApiKeyResponse {
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_by: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub creator_type: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub key_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    // Timestamps arrive as epoch floats.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub created_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub expires_at: Option<f64>,
}

/// Returned when the caller authenticates with a JWT.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WhoamiJwtResponse {
    pub auth_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auth_subtype: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub organization_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_role: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub org_slug: Option<String>,
}

/// Discriminated union of the two `/api/whoami` shapes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum WhoamiResponse {
    /// `auth_type == "api_key"`.
    ApiKey(WhoamiApiKeyResponse),
    /// Any other `auth_type` (e.g. `"jwt"`).
    Jwt(WhoamiJwtResponse),
}

/// Dispatch to the correct variant based on `auth_type`.
pub fn parse_whoami(v: Value) -> Result<WhoamiResponse> {
    // Match Python's `_parse_whoami`: api_key → ApiKey variant, else Jwt.
    let is_api_key = v.get("auth_type").and_then(Value::as_str) == Some("api_key");
    if is_api_key {
        Ok(WhoamiResponse::ApiKey(serde_json::from_value(v)?))
    } else {
        Ok(WhoamiResponse::Jwt(serde_json::from_value(v)?))
    }
}

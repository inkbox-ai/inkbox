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
    // Timestamps arrive as ISO-8601 strings — the server serializes `datetime`
    // fields like everything else in the API (e.g. "2026-06-25T23:05:46Z").
    // Kept as the raw string; the helper also tolerates a legacy epoch number.
    #[serde(
        default,
        deserialize_with = "de_opt_timestamp",
        skip_serializing_if = "Option::is_none"
    )]
    pub created_at: Option<String>,
    #[serde(
        default,
        deserialize_with = "de_opt_timestamp",
        skip_serializing_if = "Option::is_none"
    )]
    pub last_used_at: Option<String>,
    #[serde(
        default,
        deserialize_with = "de_opt_timestamp",
        skip_serializing_if = "Option::is_none"
    )]
    pub expires_at: Option<String>,
}

/// Deserialize an optional timestamp that may arrive as an ISO-8601 string (the
/// server's actual format) or, defensively, a legacy epoch number — keeping the
/// raw value as a string either way. Avoids the hard serde failure an earlier
/// `Option<f64>` typing hit on the server's string timestamps.
fn de_opt_timestamp<'de, D>(de: D) -> std::result::Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    Ok(match Option::<Value>::deserialize(de)? {
        Some(Value::String(s)) => Some(s),
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    })
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn whoami_decodes_iso_string_timestamps() {
        // The server serializes datetime fields as ISO-8601 strings; the earlier
        // `Option<f64>` typing failed to decode these (the bug this guards).
        let payload = serde_json::json!({
            "auth_type": "api_key",
            "auth_subtype": "api_key.admin_scoped",
            "organization_id": "org_123",
            "created_at": "2026-06-25T23:05:46.406390Z",
            "last_used_at": "2026-06-25T23:10:00Z",
            "expires_at": null
        });
        match parse_whoami(payload).expect("decodes ISO timestamps") {
            WhoamiResponse::ApiKey(k) => {
                assert_eq!(k.created_at.as_deref(), Some("2026-06-25T23:05:46.406390Z"));
                assert_eq!(k.last_used_at.as_deref(), Some("2026-06-25T23:10:00Z"));
                assert_eq!(k.expires_at, None);
            }
            _ => panic!("expected ApiKey variant"),
        }
    }

    #[test]
    fn whoami_tolerates_numeric_timestamps() {
        let payload = serde_json::json!({ "auth_type": "api_key", "created_at": 1_750_000_000.5 });
        match parse_whoami(payload).expect("tolerates numeric timestamps") {
            WhoamiResponse::ApiKey(k) => assert_eq!(k.created_at.as_deref(), Some("1750000000.5")),
            _ => panic!("expected ApiKey variant"),
        }
    }
}

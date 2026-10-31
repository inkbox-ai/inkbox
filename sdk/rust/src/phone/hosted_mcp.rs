//! External connection configuration for Voice AI.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum McpAuth {
    None,
    Bearer {
        token: String,
    },
    Header {
        token: String,
        header_name: String,
        value_prefix: String,
    },
    #[serde(rename = "oauth")]
    OAuth(McpOAuthAuth),
}

#[derive(Clone, Default, Serialize)]
pub struct McpOAuthAuth {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issuer: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub scopes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub client_secret: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_endpoint_auth_method: Option<McpOAuthClientAuthMethod>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<McpOAuthProfile>,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthClientAuthMethod {
    None,
    ClientSecretBasic,
    ClientSecretPost,
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum McpOAuthProfile {
    Standard,
    OfflineConsent,
}

#[derive(Clone, Deserialize)]
pub struct HostedMcpAuthorization {
    pub id: Uuid,
    pub connection_id: Uuid,
    pub agent_identity_id: Uuid,
    pub status: String,
    pub expires_at: String,
    pub connect_url: Option<String>,
    pub config_version: Option<u32>,
    #[serde(default)]
    pub requested_scopes: Vec<String>,
    pub error_code: Option<String>,
}

impl std::fmt::Debug for McpAuth {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("McpAuth(..)")
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpTransport {
    StreamableHttp,
    Sse,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum McpContextMode {
    Selected,
    All,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct McpContextSelections {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode: Option<McpContextMode>,
    #[serde(default)]
    pub prompts: Vec<McpPromptSelection>,
    #[serde(default)]
    pub resources: Vec<String>,
    #[serde(default)]
    pub skills: Vec<McpSkillSelection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpPromptSelection {
    pub name: String,
    #[serde(default)]
    pub arguments: std::collections::HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpSkillSelection {
    pub uri: String,
    pub manifest_digest: String,
}

#[derive(Clone, Default, Serialize)]
pub struct HostedMcpCreate {
    pub label: String,
    pub url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<McpTransport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<McpAuth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<McpContextSelections>,
}

#[derive(Clone, Default, Serialize)]
pub struct HostedMcpUpdate {
    pub expected_version: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<McpTransport>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub auth: Option<McpAuth>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// `Some(None)` removes the tool restriction; `None` preserves it.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub allowed_tools: Option<Option<Vec<String>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub context: Option<McpContextSelections>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostedMcpAuthView {
    pub r#type: String,
    pub configured: bool,
    pub header_name: Option<String>,
    pub value_prefix: Option<String>,
    pub status: Option<String>,
    pub expires_at: Option<String>,
    #[serde(default)]
    pub refresh_supported: bool,
    #[serde(default)]
    pub requested_scopes: Vec<String>,
    #[serde(default)]
    pub granted_scopes: Vec<String>,
    pub error_code: Option<String>,
    pub issuer: Option<String>,
    pub callback_uri: Option<String>,
}

#[derive(Clone, Deserialize)]
pub struct HostedMcpConnection {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub label: String,
    pub url: String,
    pub transport: McpTransport,
    pub auth: HostedMcpAuthView,
    pub enabled: bool,
    pub allowed_tools: Option<Vec<String>>,
    pub context: McpContextSelections,
    pub config_version: u32,
    pub preparation_status: String,
    pub health_code: Option<String>,
    pub capabilities: std::collections::HashMap<String, bool>,
    pub catalog_version: Option<String>,
    pub catalog_fetched_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostedMcpCatalog {
    pub tools: Vec<Value>,
    pub prompts: Vec<Value>,
    pub resources: Vec<Value>,
    pub skills: Vec<Value>,
    pub next_cursor: Option<String>,
    pub config_version: u32,
    pub catalog_version: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostedMcpTestResult {
    pub success: bool,
    pub code: String,
    pub config_version: u32,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostedMcpActivity {
    pub id: Uuid,
    pub connection_label: String,
    pub tool_name: String,
    pub status: String,
    pub error_code: Option<String>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct HostedMcpActivityPage {
    pub items: Vec<HostedMcpActivity>,
    pub limit: u32,
    pub offset: u32,
    pub has_more: bool,
    pub incomplete: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn automatic_context_roundtrips_and_legacy_requests_omit_mode() {
        let context = McpContextSelections {
            mode: Some(McpContextMode::All),
            ..Default::default()
        };
        let wire = serde_json::to_value(&context).unwrap();
        assert_eq!(wire["mode"], "all");
        let parsed: McpContextSelections = serde_json::from_value(wire).unwrap();
        assert!(matches!(parsed.mode, Some(McpContextMode::All)));
        let legacy = serde_json::to_value(McpContextSelections::default()).unwrap();
        assert!(legacy.get("mode").is_none());
    }

    #[test]
    fn oauth_serialization_preserves_auth_method_and_hides_debug_secret() {
        let auth = McpAuth::OAuth(McpOAuthAuth {
            client_id: Some("client".into()),
            client_secret: Some("synthetic-secret".into()),
            token_endpoint_auth_method: Some(McpOAuthClientAuthMethod::ClientSecretBasic),
            scopes: vec!["read".into()],
            ..Default::default()
        });
        assert_eq!(
            serde_json::to_value(&auth).unwrap(),
            serde_json::json!({
                "type": "oauth", "client_id": "client", "client_secret": "synthetic-secret",
                "token_endpoint_auth_method": "client_secret_basic", "scopes": ["read"]
            })
        );
        assert!(!format!("{auth:?}").contains("synthetic-secret"));
        let view: HostedMcpAuthView =
            serde_json::from_value(serde_json::json!({"type": "future-auth", "configured": false}))
                .unwrap();
        assert_eq!(view.r#type, "future-auth");
    }

    #[test]
    fn patch_omission_does_not_remove_grants() {
        let patch = HostedMcpUpdate {
            expected_version: 1,
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(patch).unwrap(),
            serde_json::json!({"expected_version": 1})
        );
        let patch = HostedMcpUpdate {
            expected_version: 2,
            auth: Some(McpAuth::None),
            allowed_tools: Some(None),
            ..Default::default()
        };
        assert_eq!(
            serde_json::to_value(patch).unwrap(),
            serde_json::json!({"expected_version": 2, "auth": {"type": "none"}, "allowed_tools": null})
        );
        let auth = McpAuth::Header {
            token: "synthetic".into(),
            header_name: "X-Example-Key".into(),
            value_prefix: "Token ".into(),
        };
        assert!(!format!("{auth:?}").contains("synthetic"));
        assert_eq!(serde_json::to_value(auth).unwrap()["token"], "synthetic");
    }
}

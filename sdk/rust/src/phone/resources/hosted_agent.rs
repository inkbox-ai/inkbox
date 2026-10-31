//! Inkbox Voice AI configuration and organization-wide voice discovery.

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::hosted_mcp::*;
use crate::phone::types::{HostedAgentAuthorityMode, HostedAgentConfig, HostedAgentVoiceCatalog};
use uuid::Uuid;

pub struct HostedAgentConfigResource {
    http: Arc<HttpTransport>,
}

impl HostedAgentConfigResource {
    /// Request a browser connection URL requiring human approval.
    pub fn start_mcp_authorization(
        &self,
        id: Uuid,
        expected_version: u32,
        idempotency_key: &str,
    ) -> Result<HostedMcpAuthorization> {
        Ok(serde_json::from_value(self.http.post_with_headers(
            &format!("/hosted-agent-config/mcp-servers/{id}/oauth/authorizations"),
            Some(&serde_json::json!({"expected_version": expected_version})),
            &[],
            &[("Idempotency-Key", idempotency_key)],
        )?)?)
    }

    pub fn get_mcp_authorization(
        &self,
        id: Uuid,
        transaction_id: Uuid,
    ) -> Result<HostedMcpAuthorization> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/hosted-agent-config/mcp-servers/{id}/oauth/authorizations/{transaction_id}"),
            &[],
        )?)?)
    }

    pub fn cancel_mcp_authorization(&self, id: Uuid, transaction_id: Uuid) -> Result<()> {
        self.http.delete(&format!(
            "/hosted-agent-config/mcp-servers/{id}/oauth/authorizations/{transaction_id}"
        ))?;
        Ok(())
    }

    pub fn disconnect_mcp_server(
        &self,
        id: Uuid,
        expected_version: u32,
        idempotency_key: &str,
    ) -> Result<HostedMcpTestResult> {
        Ok(serde_json::from_value(self.http.post_with_headers(
            &format!("/hosted-agent-config/mcp-servers/{id}/oauth/disconnect"),
            Some(&serde_json::json!({"expected_version": expected_version})),
            &[],
            &[("Idempotency-Key", idempotency_key)],
        )?)?)
    }

    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    pub fn list_mcp_servers(
        &self,
        agent_identity_id: Option<Uuid>,
    ) -> Result<Vec<HostedMcpConnection>> {
        let params = agent_identity_id
            .map(|id| vec![("agent_identity_id", id.to_string())])
            .unwrap_or_default();
        let data = self.http.get("/hosted-agent-config/mcp-servers", &params)?;
        Ok(serde_json::from_value(data["connections"].clone())?)
    }

    pub fn create_mcp_server(
        &self,
        body: &HostedMcpCreate,
        idempotency_key: &str,
    ) -> Result<HostedMcpConnection> {
        let data = self.http.post_with_headers(
            "/hosted-agent-config/mcp-servers",
            Some(body),
            &[],
            &[("Idempotency-Key", idempotency_key)],
        )?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn get_mcp_server(&self, id: Uuid) -> Result<HostedMcpConnection> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/hosted-agent-config/mcp-servers/{id}"),
            &[],
        )?)?)
    }

    /// URL changes require replacement authentication or explicit `McpAuth::None`.
    pub fn update_mcp_server(
        &self,
        id: Uuid,
        body: &HostedMcpUpdate,
    ) -> Result<HostedMcpConnection> {
        Ok(serde_json::from_value(self.http.patch(
            &format!("/hosted-agent-config/mcp-servers/{id}"),
            body,
        )?)?)
    }

    pub fn delete_mcp_server(&self, id: Uuid) -> Result<()> {
        self.http
            .delete(&format!("/hosted-agent-config/mcp-servers/{id}"))?;
        Ok(())
    }

    pub fn test_mcp_server(&self, id: Uuid) -> Result<HostedMcpTestResult> {
        Ok(serde_json::from_value(self.http.post::<()>(
            &format!("/hosted-agent-config/mcp-servers/{id}/test"),
            None,
            &[],
        )?)?)
    }

    pub fn refresh_mcp_server(
        &self,
        id: Uuid,
        idempotency_key: &str,
    ) -> Result<HostedMcpTestResult> {
        Ok(serde_json::from_value(self.http.post_with_headers::<()>(
            &format!("/hosted-agent-config/mcp-servers/{id}/refresh"),
            None,
            &[],
            &[("Idempotency-Key", idempotency_key)],
        )?)?)
    }

    pub fn get_mcp_catalog(
        &self,
        id: Uuid,
        cursor: Option<&str>,
        limit: u32,
        skill_uri: Option<&str>,
    ) -> Result<HostedMcpCatalog> {
        let mut params = vec![("limit", limit.to_string())];
        if let Some(cursor) = cursor {
            params.push(("cursor", cursor.to_string()));
        }
        if let Some(uri) = skill_uri {
            params.push(("skill_uri", uri.to_string()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!("/hosted-agent-config/mcp-servers/{id}/catalog"),
            &params,
        )?)?)
    }

    pub fn get_mcp_activity(
        &self,
        call_id: Uuid,
        limit: u32,
        offset: u32,
    ) -> Result<HostedMcpActivityPage> {
        Ok(serde_json::from_value(self.http.get(
            &format!("/calls/{call_id}/mcp-activity"),
            &[("limit", limit.to_string()), ("offset", offset.to_string())],
        )?)?)
    }

    /// List the organization's voice catalog, including unavailable voices.
    ///
    /// This operation needs no identity selector. Use a voice's `id` with
    /// `set_config` when its `available` flag is true; previews are optional.
    ///
    /// ```no_run
    /// use inkbox::phone::{HostedAgentVoiceCatalog, HostedAgentVoiceOption};
    ///
    /// # fn main() -> inkbox::Result<()> {
    /// let inkbox = inkbox::Inkbox::from_env()?;
    /// let catalog: HostedAgentVoiceCatalog = inkbox.hosted_agent().list_voices()?;
    /// println!("Default voice: {}", catalog.default_voice);
    /// for voice in &catalog.voices {
    ///     let voice: &HostedAgentVoiceOption = voice;
    ///     println!("{}: {} (available: {})", voice.id, voice.name, voice.available);
    /// }
    /// # Ok(())
    /// # }
    /// ```
    pub fn list_voices(&self) -> Result<HostedAgentVoiceCatalog> {
        let data = self.http.get("/hosted-agent-voices", &[])?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get the Inkbox Voice AI config.
    ///
    /// Agent-scoped keys resolve their own identity; admin/JWT callers must
    /// pass `agent_identity_id` (the server returns 422 otherwise).
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    pub fn get_config(&self, agent_identity_id: Option<&str>) -> Result<HostedAgentConfig> {
        // Scope by identity only when explicitly supplied.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        let data = self.http.get("/hosted-agent-config", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Set the Inkbox Voice AI config.
    ///
    /// Full-replace PUT: every call replaces voice and instructions. The
    /// deprecated `model` argument remains accepted but is ignored.
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    /// * `voice` - Voice override; `None` for the server default.
    /// * `model` - Deprecated compatibility argument; accepted but ignored.
    /// * `instructions` - Per-identity steering prompt appended to the hosted
    ///   agent's system prompt; `None` for none.
    pub fn set_config(
        &self,
        agent_identity_id: Option<&str>,
        voice: Option<&str>,
        model: Option<&str>,
        instructions: Option<&str>,
    ) -> Result<HostedAgentConfig> {
        // Omitted (None) fields are equivalent to explicit nulls on this
        // full-replace PUT: the server resets them to its defaults.
        let mut body = Map::new();
        if let Some(id) = agent_identity_id {
            body.insert("agent_identity_id".into(), id.into());
        }
        if let Some(v) = voice {
            body.insert("voice".into(), v.into());
        }
        let _ = model;
        if let Some(i) = instructions {
            body.insert("instructions".into(), i.into());
        }
        let data = self.http.put("/hosted-agent-config", &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Set an identity's saved Voice AI authority.
    ///
    /// This privileged operation requires an admin API key. Incoming calls use
    /// this value, and outbound calls inherit it when they omit a per-call
    /// override.
    pub fn set_authority_mode(
        &self,
        agent_identity_id: &str,
        authority_mode: HostedAgentAuthorityMode,
    ) -> Result<HostedAgentConfig> {
        let mut body = Map::new();
        body.insert("agent_identity_id".into(), agent_identity_id.into());
        body.insert("authority_mode".into(), authority_mode.as_str().into());
        let data = self
            .http
            .put("/hosted-agent-config/authority-mode", &body)?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::phone::types::HostedAgentAuthorityMode;

    /// Client whose phone transport points at the mock server.
    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    /// A `HostedAgentConfig` response payload.
    fn config_json() -> serde_json::Value {
        json!({
            "agent_identity_id": "33333333-3333-3333-3333-333333333333",
            "voice": "warm-voice",
            "model": "fast-model",
            "effective_voice": "warm-voice",
            "effective_model": "fast-model",
            "instructions": "Always offer to text a summary after the call."
        })
    }

    #[test]
    fn oauth_operations_preserve_version_and_idempotency_headers() {
        let server = MockServer::start();
        let id = uuid::Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap();
        let base = format!("/api/v1/phone/hosted-agent-config/mcp-servers/{id}/oauth");
        let authorization = json!({"id": id, "connection_id": id, "agent_identity_id": id,
            "status": "pending", "expires_at": "2026-10-27T20:00:00Z", "requested_scopes": ["read"],
            "connect_url": "https://inkbox.ai/console/mcp-connections/oauth/connect"});
        let start = server.mock(|when, then| {
            when.method(POST)
                .path(format!("{base}/authorizations"))
                .header("Idempotency-Key", "connect")
                .json_body(json!({"expected_version": 2}));
            then.status(201).json_body(authorization.clone());
        });
        let status = server.mock(|when, then| {
            when.method(GET).path(format!("{base}/authorizations/{id}"));
            then.status(200).json_body(authorization);
        });
        let cancel = server.mock(|when, then| {
            when.method(DELETE)
                .path(format!("{base}/authorizations/{id}"));
            then.status(204);
        });
        let disconnect = server.mock(|when, then| {
            when.method(POST)
                .path(format!("{base}/disconnect"))
                .header("Idempotency-Key", "disconnect")
                .json_body(json!({"expected_version": 3}));
            then.status(200)
                .json_body(json!({"success": true, "code": "disconnected", "config_version": 3}));
        });
        let client = client(&server);
        let resource = client.hosted_agent();
        assert_eq!(
            resource
                .start_mcp_authorization(id, 2, "connect")
                .unwrap()
                .status,
            "pending"
        );
        assert_eq!(
            resource
                .get_mcp_authorization(id, id)
                .unwrap()
                .requested_scopes,
            ["read"]
        );
        resource.cancel_mcp_authorization(id, id).unwrap();
        assert!(
            resource
                .disconnect_mcp_server(id, 3, "disconnect")
                .unwrap()
                .success
        );
        for mock in [start, status, cancel, disconnect] {
            mock.assert_hits(1);
        }
    }

    #[test]
    fn list_voices_preserves_catalog_without_identity_query() {
        fn no_query_params(req: &HttpMockRequest) -> bool {
            req.query_params.clone().unwrap_or_default().is_empty()
        }
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/hosted-agent-voices")
                .header("x-api-key", "test-key")
                .matches(no_query_params);
            then.status(200).json_body(json!({
                "default_voice": "future-voice",
                "voices": [
                    {
                        "id": "future-voice", "name": "Future Voice",
                        "description": "A clear, conversational voice.", "available": true,
                        "preview_url": "https://example.com/voice-preview.mp3"
                    },
                    {
                        "id": "unavailable-voice", "name": "Unavailable Voice",
                        "description": "Not currently available.", "available": false,
                        "preview_url": null
                    },
                    {
                        "id": "no-preview", "name": "No Preview",
                        "description": "A voice without a preview.", "available": true
                    }
                ]
            }));
        });
        let catalog: crate::phone::HostedAgentVoiceCatalog =
            client(&server).hosted_agent().list_voices().unwrap();
        mock.assert();
        assert_eq!(catalog.default_voice, "future-voice");
        assert_eq!(catalog.voices.len(), 3);
        let first: &crate::phone::HostedAgentVoiceOption = &catalog.voices[0];
        assert_eq!(first.id, "future-voice");
        assert_eq!(first.name, "Future Voice");
        assert_eq!(first.description, "A clear, conversational voice.");
        assert!(first.available);
        assert_eq!(
            first.preview_url.as_deref(),
            Some("https://example.com/voice-preview.mp3")
        );
        assert_eq!(catalog.voices[1].id, "unavailable-voice");
        assert!(!catalog.voices[1].available);
        assert_eq!(catalog.voices[1].preview_url, None);
        assert_eq!(catalog.voices[2].preview_url, None);
    }

    #[test]
    fn list_voices_accepts_empty_catalog() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/phone/hosted-agent-voices");
            then.status(200).json_body(json!({
                "default_voice": "future-voice", "voices": []
            }));
        });
        let catalog = client(&server).hosted_agent().list_voices().unwrap();
        mock.assert();
        assert_eq!(catalog.default_voice, "future-voice");
        assert!(catalog.voices.is_empty());
    }

    #[test]
    fn list_voices_preserves_api_errors() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/phone/hosted-agent-voices");
            then.status(403)
                .json_body(json!({"detail": "Voice access is unavailable."}));
        });
        let error = client(&server).hosted_agent().list_voices().unwrap_err();
        mock.assert();
        match error {
            crate::InkboxError::Api {
                status_code,
                detail,
                ..
            } => {
                assert_eq!(status_code, 403);
                assert_eq!(detail.to_string(), "Voice access is unavailable.");
            }
            other => panic!("unexpected error: {other:?}"),
        }
    }

    #[test]
    fn get_config_scopes_by_identity_when_given() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/hosted-agent-config")
                .query_param("agent_identity_id", "33333333-3333-3333-3333-333333333333");
            then.status(200).json_body(config_json());
        });
        let config = client(&server)
            .hosted_agent()
            .get_config(Some("33333333-3333-3333-3333-333333333333"))
            .unwrap();
        mock.assert();
        assert_eq!(
            config.agent_identity_id.to_string(),
            "33333333-3333-3333-3333-333333333333"
        );
        assert_eq!(config.voice.as_deref(), Some("warm-voice"));
        assert_eq!(config.model.as_deref(), Some("fast-model"));
        assert_eq!(config.effective_voice, "warm-voice");
        assert_eq!(config.effective_model, "fast-model");
    }

    #[test]
    fn get_config_omits_identity_param_when_none() {
        // Custom matcher: agent-scoped keys send no query string at all.
        fn no_query_params(req: &HttpMockRequest) -> bool {
            req.query_params.clone().unwrap_or_default().is_empty()
        }
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/hosted-agent-config")
                .matches(no_query_params);
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "voice": null,
                "model": null,
                "effective_voice": "voice-default",
                "effective_model": "model-default",
                "instructions": null
            }));
        });
        let config = client(&server).hosted_agent().get_config(None).unwrap();
        mock.assert();
        // A never-configured identity comes back all-null.
        assert_eq!(config.voice, None);
        assert_eq!(config.model, None);
        assert_eq!(config.instructions, None);
    }

    #[test]
    fn set_config_accepts_but_omits_deprecated_model() {
        let server = MockServer::start();
        // Exact json_body match: full PUT body shape, no stray keys.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config")
                .json_body(json!({
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                    "voice": "warm-voice",
                    "instructions": "Always offer to text a summary after the call."
                }));
            then.status(200).json_body(config_json());
        });
        let config = client(&server)
            .hosted_agent()
            .set_config(
                Some("33333333-3333-3333-3333-333333333333"),
                Some("warm-voice"),
                Some("fast-model"),
                Some("Always offer to text a summary after the call."),
            )
            .unwrap();
        mock.assert();
        assert_eq!(config.voice.as_deref(), Some("warm-voice"));
    }

    #[test]
    fn set_config_empty_body_resets_to_server_defaults() {
        let server = MockServer::start();
        // Full-replace PUT: omitting everything nulls the columns server-side.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config")
                .json_body(json!({}));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "voice": null,
                "model": null,
                "effective_voice": "voice-default",
                "effective_model": "model-default",
                "instructions": null
            }));
        });
        let config = client(&server)
            .hosted_agent()
            .set_config(None, None, None, None)
            .unwrap();
        mock.assert();
        assert_eq!(config.voice, None);
    }

    #[test]
    fn set_config_partial_sends_only_set_fields() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config")
                .json_body(json!({"voice": "warm-voice"}));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "voice": "warm-voice",
                "model": null,
                "effective_voice": "warm-voice",
                "effective_model": "model-default",
                "instructions": null
            }));
        });
        let config = client(&server)
            .hosted_agent()
            .set_config(None, Some("warm-voice"), None, None)
            .unwrap();
        mock.assert();
        assert_eq!(config.voice.as_deref(), Some("warm-voice"));
        assert_eq!(config.model, None);
    }

    #[test]
    fn set_authority_mode_sends_exact_body() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config/authority-mode")
                .json_body(json!({
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                    "authority_mode": "yolo"
                }));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "voice": null,
                "model": null,
                "effective_voice": "voice-default",
                "effective_model": "model-default",
                "instructions": null,
                "authority_mode": "yolo"
            }));
        });

        let config = client(&server)
            .hosted_agent()
            .set_authority_mode(
                "33333333-3333-3333-3333-333333333333",
                HostedAgentAuthorityMode::Yolo,
            )
            .unwrap();

        mock.assert();
        assert_eq!(config.authority_mode, HostedAgentAuthorityMode::Yolo);
    }
}

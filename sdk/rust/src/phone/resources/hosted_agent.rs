//! Inkbox Voice AI configuration and organization-wide voice discovery.

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{HostedAgentAuthorityMode, HostedAgentConfig, HostedAgentVoiceCatalog};

pub struct HostedAgentConfigResource {
    http: Arc<HttpTransport>,
}

impl HostedAgentConfigResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
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
    fn custom_voice_catalog_entry_can_be_selected_without_rewriting() {
        let server = MockServer::start();
        let id = "custom_0123456789abcdef0123456789abcdef";
        let preview = format!("/api/v1/phone/hosted-agent-voices/{id}/preview");
        let catalog_mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/phone/hosted-agent-voices");
            then.status(200).json_body(json!({
                "default_voice": "standard-voice",
                "voices": [{"id": id, "name": "Custom Voice", "description": "Warm",
                            "available": true, "preview_url": preview}]
            }));
        });
        let config_mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config")
                .json_body(json!({"voice": id, "instructions": "Be brief."}));
            let mut response = config_json();
            response["voice"] = json!(id);
            response["effective_voice"] = json!(id);
            then.status(200).json_body(response);
        });
        let sdk = client(&server);
        let catalog = sdk.hosted_agent().list_voices().unwrap();
        let voice = &catalog.voices[0];
        assert_eq!(voice.preview_url.as_deref(), Some(preview.as_str()));
        let config = sdk
            .hosted_agent()
            .set_config(None, Some(&voice.id), None, Some("Be brief."))
            .unwrap();
        assert_eq!(config.voice.as_deref(), Some(id));
        assert_eq!(config.effective_voice, id);
        catalog_mock.assert();
        config_mock.assert();
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

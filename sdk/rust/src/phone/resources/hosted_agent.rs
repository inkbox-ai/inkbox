//! Identity-scoped hosted call agent config (get_config / set_config).

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::HostedAgentConfig;

pub struct HostedAgentConfigResource {
    http: Arc<HttpTransport>,
}

impl HostedAgentConfigResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Get the hosted call agent config.
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

    /// Set the hosted call agent config.
    ///
    /// Full-replace PUT: every call sets all three fields, and a field left
    /// `None` resets to the server default — there is no partial update.
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    /// * `voice` - Voice override; `None` for the server default.
    /// * `model` - Model override; `None` for the server default.
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
        if let Some(m) = model {
            body.insert("model".into(), m.into());
        }
        if let Some(i) = instructions {
            body.insert("instructions".into(), i.into());
        }
        let data = self.http.put("/hosted-agent-config", &body)?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;

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
            "instructions": "Always offer to text a summary after the call."
        })
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
    fn set_config_sends_full_body_when_all_args_given() {
        let server = MockServer::start();
        // Exact json_body match: full PUT body shape, no stray keys.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-agent-config")
                .json_body(json!({
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                    "voice": "warm-voice",
                    "model": "fast-model",
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
}

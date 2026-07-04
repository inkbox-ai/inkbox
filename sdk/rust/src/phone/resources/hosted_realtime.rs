//! Identity-scoped platform-hosted realtime voice config (get / set).

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::HostedRealtimeConfig;

pub struct HostedRealtimeResource {
    http: Arc<HttpTransport>,
}

impl HostedRealtimeResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Get the hosted realtime voice config.
    ///
    /// Agent-scoped keys resolve their own identity; admin/JWT callers must
    /// pass `agent_identity_id` (the server returns 422 otherwise).
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    pub fn get_config(&self, agent_identity_id: Option<&str>) -> Result<HostedRealtimeConfig> {
        // Scope by identity only when explicitly supplied.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        let data = self.http.get("/hosted-realtime-config", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Set the hosted realtime voice config.
    ///
    /// # Arguments
    /// * `enabled` - Whether the platform hosts the realtime voice agent for
    ///   this identity's inbound calls.
    /// * `voice` - Provider voice id; `None` for the server default.
    /// * `model` - Realtime model id; `None` for the server default.
    /// * `instructions` - Extra system instructions appended to the base prompt.
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    pub fn set_config(
        &self,
        enabled: bool,
        voice: Option<&str>,
        model: Option<&str>,
        instructions: Option<&str>,
        agent_identity_id: Option<&str>,
    ) -> Result<HostedRealtimeConfig> {
        // Always send `enabled`; include the rest only when provided.
        let mut body = Map::new();
        body.insert("enabled".into(), enabled.into());
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
        let data = self.http.put("/hosted-realtime-config", &body)?;
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

    /// A `HostedRealtimeConfig` response payload.
    fn config_json(enabled: bool) -> serde_json::Value {
        json!({
            "agent_identity_id": "33333333-3333-3333-3333-333333333333",
            "enabled": enabled,
            "voice": "warm",
            "model": "realtime-standard",
            "instructions": "Be concise."
        })
    }

    #[test]
    fn get_scopes_by_identity_when_given() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/hosted-realtime-config")
                .query_param("agent_identity_id", "33333333-3333-3333-3333-333333333333");
            then.status(200).json_body(config_json(true));
        });
        let config = client(&server)
            .hosted_realtime()
            .get_config(Some("33333333-3333-3333-3333-333333333333"))
            .unwrap();
        mock.assert();
        assert_eq!(
            config.agent_identity_id.to_string(),
            "33333333-3333-3333-3333-333333333333"
        );
        assert!(config.enabled);
        assert_eq!(config.voice.as_deref(), Some("warm"));
        assert_eq!(config.model.as_deref(), Some("realtime-standard"));
    }

    #[test]
    fn get_omits_identity_param_when_none() {
        // Custom matcher: agent-scoped keys send no query string at all.
        fn no_query_params(req: &HttpMockRequest) -> bool {
            req.query_params.clone().unwrap_or_default().is_empty()
        }
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/hosted-realtime-config")
                .matches(no_query_params);
            then.status(200).json_body(config_json(false));
        });
        let config = client(&server).hosted_realtime().get_config(None).unwrap();
        mock.assert();
        assert!(!config.enabled);
    }

    #[test]
    fn set_sends_full_body_when_all_args_given() {
        let server = MockServer::start();
        // Exact json_body match: full PUT body shape, no stray keys.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-realtime-config")
                .json_body(json!({
                    "enabled": true,
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                    "voice": "warm",
                    "model": "realtime-standard",
                    "instructions": "Be concise."
                }));
            then.status(200).json_body(config_json(true));
        });
        let config = client(&server)
            .hosted_realtime()
            .set_config(
                true,
                Some("warm"),
                Some("realtime-standard"),
                Some("Be concise."),
                Some("33333333-3333-3333-3333-333333333333"),
            )
            .unwrap();
        mock.assert();
        assert!(config.enabled);
    }

    #[test]
    fn set_omits_optional_keys_when_none() {
        let server = MockServer::start();
        // Exact body: only the `enabled` key rides the wire.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/hosted-realtime-config")
                .json_body(json!({"enabled": false}));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "enabled": false
            }));
        });
        let config = client(&server)
            .hosted_realtime()
            .set_config(false, None, None, None, None)
            .unwrap();
        mock.assert();
        assert!(!config.enabled);
        assert_eq!(config.voice, None);
    }
}

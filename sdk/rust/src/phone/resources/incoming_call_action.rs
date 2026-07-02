//! Identity-scoped incoming-call routing config (get / set).

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{IncomingCallAction, IncomingCallActionConfig};

pub struct IncomingCallActionResource {
    http: Arc<HttpTransport>,
}

impl IncomingCallActionResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Get the incoming-call routing config.
    ///
    /// Agent-scoped keys resolve their own identity; admin/JWT callers must
    /// pass `agent_identity_id` (the server returns 422 otherwise).
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    pub fn get(&self, agent_identity_id: Option<&str>) -> Result<IncomingCallActionConfig> {
        // Scope by identity only when explicitly supplied.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        let data = self.http.get("/incoming-call-action", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Set the incoming-call routing config.
    ///
    /// # Arguments
    /// * `incoming_call_action` - `auto_accept`, `auto_reject`, or `webhook`.
    /// * `agent_identity_id` - UUID (or string) of the agent identity. `None`
    ///   for agent-scoped keys; required under admin/JWT.
    /// * `client_websocket_url` - WebSocket URL (wss://) to bridge accepted
    ///   calls to.
    /// * `incoming_call_webhook_url` - HTTPS URL that decides call routing when
    ///   the action is `webhook`.
    pub fn set(
        &self,
        incoming_call_action: IncomingCallAction,
        agent_identity_id: Option<&str>,
        client_websocket_url: Option<&str>,
        incoming_call_webhook_url: Option<&str>,
    ) -> Result<IncomingCallActionConfig> {
        // Always send the action; include the rest only when provided.
        let mut body = Map::new();
        body.insert(
            "incoming_call_action".into(),
            incoming_call_action.as_str().into(),
        );
        if let Some(id) = agent_identity_id {
            body.insert("agent_identity_id".into(), id.into());
        }
        if let Some(url) = client_websocket_url {
            body.insert("client_websocket_url".into(), url.into());
        }
        if let Some(url) = incoming_call_webhook_url {
            body.insert("incoming_call_webhook_url".into(), url.into());
        }
        let data = self.http.put("/incoming-call-action", &body)?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::phone::types::IncomingCallAction;

    /// Client whose phone transport points at the mock server.
    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    /// An `IncomingCallActionConfig` response payload.
    fn config_json(action: &str) -> serde_json::Value {
        json!({
            "agent_identity_id": "33333333-3333-3333-3333-333333333333",
            "incoming_call_action": action,
            "client_websocket_url": "wss://example.com/audio",
            "incoming_call_webhook_url": null
        })
    }

    #[test]
    fn get_scopes_by_identity_when_given() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/phone/incoming-call-action")
                .query_param("agent_identity_id", "33333333-3333-3333-3333-333333333333");
            then.status(200).json_body(config_json("auto_accept"));
        });
        let config = client(&server)
            .incoming_call_action()
            .get(Some("33333333-3333-3333-3333-333333333333"))
            .unwrap();
        mock.assert();
        assert_eq!(
            config.agent_identity_id.to_string(),
            "33333333-3333-3333-3333-333333333333"
        );
        assert_eq!(config.incoming_call_action, IncomingCallAction::AutoAccept);
        assert_eq!(
            config.client_websocket_url.as_deref(),
            Some("wss://example.com/audio")
        );
        assert_eq!(config.incoming_call_webhook_url, None);
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
                .path("/api/v1/phone/incoming-call-action")
                .matches(no_query_params);
            then.status(200).json_body(config_json("auto_reject"));
        });
        let config = client(&server).incoming_call_action().get(None).unwrap();
        mock.assert();
        assert_eq!(config.incoming_call_action, IncomingCallAction::AutoReject);
    }

    #[test]
    fn set_sends_full_body_when_all_args_given() {
        let server = MockServer::start();
        // Exact json_body match: full PUT body shape, no stray keys.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/incoming-call-action")
                .json_body(json!({
                    "incoming_call_action": "webhook",
                    "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                    "client_websocket_url": "wss://example.com/audio",
                    "incoming_call_webhook_url": "https://example.com/route"
                }));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "incoming_call_action": "webhook",
                "client_websocket_url": "wss://example.com/audio",
                "incoming_call_webhook_url": "https://example.com/route"
            }));
        });
        let config = client(&server)
            .incoming_call_action()
            .set(
                IncomingCallAction::Webhook,
                Some("33333333-3333-3333-3333-333333333333"),
                Some("wss://example.com/audio"),
                Some("https://example.com/route"),
            )
            .unwrap();
        mock.assert();
        assert_eq!(config.incoming_call_action, IncomingCallAction::Webhook);
        assert_eq!(
            config.incoming_call_webhook_url.as_deref(),
            Some("https://example.com/route")
        );
    }

    #[test]
    fn set_omits_optional_keys_when_none() {
        let server = MockServer::start();
        // Exact body: only the action key rides the wire.
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/incoming-call-action")
                .json_body(json!({"incoming_call_action": "auto_reject"}));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "incoming_call_action": "auto_reject"
            }));
        });
        let config = client(&server)
            .incoming_call_action()
            .set(IncomingCallAction::AutoReject, None, None, None)
            .unwrap();
        mock.assert();
        assert_eq!(config.incoming_call_action, IncomingCallAction::AutoReject);
        assert_eq!(config.client_websocket_url, None);
    }
}

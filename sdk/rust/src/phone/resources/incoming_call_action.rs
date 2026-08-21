//! Identity-scoped incoming-call routing config (get / set).

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{ForwardingTargetType, IncomingCallAction, IncomingCallActionConfig};

/// Optional values for an incoming-call action update.
#[derive(Debug, Clone, Default)]
pub struct IncomingCallActionSetOptions {
    pub agent_identity_id: Option<String>,
    /// Outer `None` omits the key; `Some(None)` explicitly clears it.
    pub forwarding_target_type: Option<Option<ForwardingTargetType>>,
    pub forwarding_phone_number: Option<Option<String>>,
    pub forwarding_sip_uri: Option<Option<String>>,
    pub client_websocket_url: Option<String>,
    pub incoming_call_webhook_url: Option<String>,
}

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
    /// * `incoming_call_action` - `auto_accept`, `auto_reject`, `webhook`,
    ///   `hosted_agent`, or `forward`.
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
        self.set_with_options(
            incoming_call_action,
            IncomingCallActionSetOptions {
                agent_identity_id: agent_identity_id.map(str::to_owned),
                client_websocket_url: client_websocket_url.map(str::to_owned),
                incoming_call_webhook_url: incoming_call_webhook_url.map(str::to_owned),
                ..Default::default()
            },
        )
    }

    /// Set the action with forwarding fields and explicit-clear semantics.
    ///
    /// In `options.forwarding_*`, outer `None` omits a field and preserves its
    /// saved value. `Some(None)` sends JSON `null`; clear the target while
    /// switching away from `forward`. A phone target must be a complete E.164
    /// number. A SIP target must be a complete URI with a public DNS hostname.
    pub fn set_with_options(
        &self,
        incoming_call_action: IncomingCallAction,
        options: IncomingCallActionSetOptions,
    ) -> Result<IncomingCallActionConfig> {
        let mut body = Map::new();
        body.insert(
            "incoming_call_action".into(),
            incoming_call_action.as_str().into(),
        );
        if let Some(id) = options.agent_identity_id {
            body.insert("agent_identity_id".into(), id.into());
        }
        if let Some(url) = options.client_websocket_url {
            body.insert("client_websocket_url".into(), url.into());
        }
        if let Some(url) = options.incoming_call_webhook_url {
            body.insert("incoming_call_webhook_url".into(), url.into());
        }
        if let Some(value) = options.forwarding_target_type {
            body.insert(
                "forwarding_target_type".into(),
                value
                    .map(|target| Value::String(target.as_str().to_owned()))
                    .unwrap_or(Value::Null),
            );
        }
        if let Some(value) = options.forwarding_phone_number {
            body.insert(
                "forwarding_phone_number".into(),
                value.map(Value::String).unwrap_or(Value::Null),
            );
        }
        if let Some(value) = options.forwarding_sip_uri {
            body.insert(
                "forwarding_sip_uri".into(),
                value.map(Value::String).unwrap_or(Value::Null),
            );
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
    use crate::phone::types::{ForwardingTargetType, IncomingCallAction};

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

    #[test]
    fn set_with_options_distinguishes_omission_and_explicit_clear() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(PUT)
                .path("/api/v1/phone/incoming-call-action")
                .json_body(json!({
                    "incoming_call_action": "forward",
                    "forwarding_target_type": "sip",
                    "forwarding_phone_number": null,
                    "forwarding_sip_uri": "sip:+14155550100@voice.example.com"
                }));
            then.status(200).json_body(json!({
                "agent_identity_id": "33333333-3333-3333-3333-333333333333",
                "incoming_call_action": "forward",
                "forwarding_target_type": "sip",
                "forwarding_phone_number": null,
                "forwarding_sip_uri": "sip:+14155550100@voice.example.com"
            }));
        });

        let config = client(&server)
            .incoming_call_action()
            .set_with_options(
                IncomingCallAction::Forward,
                super::IncomingCallActionSetOptions {
                    forwarding_target_type: Some(Some(ForwardingTargetType::Sip)),
                    forwarding_phone_number: Some(None),
                    forwarding_sip_uri: Some(Some(
                        "sip:+14155550100@voice.example.com".to_string(),
                    )),
                    ..Default::default()
                },
            )
            .unwrap();
        mock.assert();
        assert_eq!(
            config.forwarding_target_type,
            Some(ForwardingTargetType::Sip)
        );
    }
}

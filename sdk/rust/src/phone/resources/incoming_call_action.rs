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

//! Identity-scoped call operations: list, get, transcripts, place.

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{CallOrigin, PhoneCall, PhoneCallWithRateLimit, PhoneTranscript};

pub struct CallsResource {
    http: Arc<HttpTransport>,
}

impl CallsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List calls, newest first.
    ///
    /// Identity-scoped API keys resolve their own identity and never see
    /// contact-rule-blocked rows regardless of `is_blocked` (filtered
    /// server-side). Admin/JWT callers must pass `agent_identity_id` (the
    /// server returns 422 otherwise).
    ///
    /// # Arguments
    /// * `agent_identity_id` - UUID (or string) of the agent identity to scope
    ///   to. `None` for agent-scoped keys; required under admin/JWT.
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    /// * `is_blocked` - Tri-state filter: `Some(true)` for only blocked,
    ///   `Some(false)` for only non-blocked, `None` for all.
    pub fn list(
        &self,
        agent_identity_id: Option<&str>,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<PhoneCall>> {
        // Always send limit + offset; scope by identity + filter only when set.
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        let data = self.http.get("/calls", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a single call by ID.
    ///
    /// # Arguments
    /// * `call_id` - UUID (or string) of the call.
    pub fn get(&self, call_id: &str) -> Result<PhoneCall> {
        let data = self
            .http
            .get(&format!("/calls/{call_id}"), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List all transcript segments for a call, ordered by sequence number.
    ///
    /// # Arguments
    /// * `call_id` - UUID (or string) of the call.
    pub fn transcripts(&self, call_id: &str) -> Result<Vec<PhoneTranscript>> {
        let data = self.http.get(
            &format!("/calls/{call_id}/transcripts"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Place an outbound call.
    ///
    /// The server enforces the conditional requirements: `from_number` is
    /// required for `dedicated_number`, `agent_identity_id` for
    /// `shared_imessage_number`. Omissions surface as a server 422.
    ///
    /// # Arguments
    /// * `to_number` - E.164 number to call.
    /// * `origination` - Where the call originates (defaults to
    ///   [`CallOrigin::DedicatedNumber`]).
    /// * `from_number` - E.164 number to call from (dedicated origination).
    /// * `agent_identity_id` - UUID of the placing identity (shared origination).
    /// * `client_websocket_url` - WebSocket URL (wss://) for audio bridging.
    ///
    /// # Returns
    /// The created call record with current rate limit info.
    pub fn place(
        &self,
        to_number: &str,
        origination: CallOrigin,
        from_number: Option<&str>,
        agent_identity_id: Option<&str>,
        client_websocket_url: Option<&str>,
    ) -> Result<PhoneCallWithRateLimit> {
        // Always send origination; include the rest only when provided.
        let mut body = Map::new();
        body.insert("to_number".into(), to_number.into());
        body.insert("origination".into(), origination.as_str().into());
        if let Some(n) = from_number {
            body.insert("from_number".into(), n.into());
        }
        if let Some(id) = agent_identity_id {
            body.insert("agent_identity_id".into(), id.into());
        }
        if let Some(url) = client_websocket_url {
            body.insert("client_websocket_url".into(), url.into());
        }
        let data = self
            .http
            .post("/place-call", Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

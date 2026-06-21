//! Call operations: list, get, place.

use std::sync::Arc;

use serde_json::Map;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{PhoneCall, PhoneCallWithRateLimit};

pub struct CallsResource {
    http: Arc<HttpTransport>,
}

impl CallsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List calls for a phone number, newest first.
    ///
    /// Identity-scoped API keys never see contact-rule-blocked rows regardless
    /// of `is_blocked` — the server filters them at the access-policy layer.
    ///
    /// # Arguments
    /// * `phone_number_id` - UUID (or string) of the phone number.
    /// * `limit` - Max results to return (1-200).
    /// * `offset` - Pagination offset.
    /// * `is_blocked` - Tri-state filter: `Some(true)` for only blocked,
    ///   `Some(false)` for only non-blocked, `None` for all.
    pub fn list(
        &self,
        phone_number_id: &str,
        limit: i64,
        offset: i64,
        is_blocked: Option<bool>,
    ) -> Result<Vec<PhoneCall>> {
        // Always send limit + offset; append is_blocked only when set.
        let mut params: Vec<(&str, String)> =
            vec![("limit", limit.to_string()), ("offset", offset.to_string())];
        if let Some(b) = is_blocked {
            params.push(("is_blocked", b.to_string()));
        }
        let data = self
            .http
            .get(&format!("/numbers/{phone_number_id}/calls"), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a single call by ID.
    ///
    /// # Arguments
    /// * `phone_number_id` - UUID (or string) of the phone number.
    /// * `call_id` - UUID (or string) of the call.
    pub fn get(&self, phone_number_id: &str, call_id: &str) -> Result<PhoneCall> {
        let data = self.http.get(
            &format!("/numbers/{phone_number_id}/calls/{call_id}"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Place an outbound call.
    ///
    /// # Arguments
    /// * `from_number` - E.164 number to call from. Must belong to your org and
    ///   be active.
    /// * `to_number` - E.164 number to call.
    /// * `client_websocket_url` - WebSocket URL (wss://) for audio bridging.
    ///
    /// # Returns
    /// The created call record with current rate limit info.
    pub fn place(
        &self,
        from_number: &str,
        to_number: &str,
        client_websocket_url: Option<&str>,
    ) -> Result<PhoneCallWithRateLimit> {
        // Build the body conditionally, omitting client_websocket_url when None.
        let mut body = Map::new();
        body.insert("from_number".into(), from_number.into());
        body.insert("to_number".into(), to_number.into());
        if let Some(url) = client_websocket_url {
            body.insert("client_websocket_url".into(), url.into());
        }
        let data = self
            .http
            .post("/place-call", Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

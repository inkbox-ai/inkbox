//! Phone number CRUD, provisioning, release, and transcript search.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{FilterMode, PhoneNumber, PhoneTranscript};

const BASE: &str = "/numbers";

pub struct PhoneNumbersResource {
    http: Arc<HttpTransport>,
}

impl PhoneNumbersResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List all phone numbers for your organisation.
    pub fn list(&self) -> Result<Vec<PhoneNumber>> {
        let data = self.http.get(BASE, crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a phone number by ID.
    pub fn get(&self, phone_number_id: &str) -> Result<PhoneNumber> {
        let data = self
            .http
            .get(&format!("{BASE}/{phone_number_id}"), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update phone number settings.
    ///
    /// Pass only the fields you want to change; omitted fields (outer `None`)
    /// are left as-is. For the nullable string fields, `Some(None)` sends an
    /// explicit JSON `null` to clear the field, while `Some(Some(v))` sets it —
    /// mirroring the Python `_UNSET` sentinel vs an explicit `None` value.
    ///
    /// # Arguments
    /// * `incoming_call_action` - `"auto_accept"`, `"auto_reject"`, or `"webhook"`.
    /// * `client_websocket_url` - WebSocket URL (wss://) for audio bridging.
    /// * `incoming_call_webhook_url` - Webhook URL called for incoming calls when
    ///   action is `"webhook"`.
    /// * `filter_mode` - `whitelist` or `blacklist`. Admin-only on the server;
    ///   agent-scoped keys receive 403. Governs both inbound voice and SMS.
    ///
    /// # Returns
    /// The updated phone number. When `filter_mode` was supplied and actually
    /// changed, `filter_mode_change_notice` is populated.
    pub fn update(
        &self,
        phone_number_id: &str,
        incoming_call_action: Option<Option<&str>>,
        client_websocket_url: Option<Option<&str>>,
        incoming_call_webhook_url: Option<Option<&str>>,
        filter_mode: Option<FilterMode>,
    ) -> Result<PhoneNumber> {
        let mut body = Map::new();
        // Each nullable-string field: outer None omits, Some(None) -> JSON null,
        // Some(Some(v)) -> the value.
        if let Some(v) = incoming_call_action {
            body.insert("incoming_call_action".into(), str_or_null(v));
        }
        if let Some(v) = client_websocket_url {
            body.insert("client_websocket_url".into(), str_or_null(v));
        }
        if let Some(v) = incoming_call_webhook_url {
            body.insert("incoming_call_webhook_url".into(), str_or_null(v));
        }
        if let Some(mode) = filter_mode {
            let mode = match mode {
                FilterMode::Whitelist => "whitelist",
                FilterMode::Blacklist => "blacklist",
            };
            body.insert("filter_mode".into(), mode.into());
        }
        let data = self.http.patch(&format!("{BASE}/{phone_number_id}"), &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Provision a new phone number and link it to an agent identity.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the agent identity to assign this number to.
    /// * `type_` - Number type to provision. Only `"local"` is supported.
    /// * `state` - US state abbreviation (e.g. `"NY"`) to request a number in
    ///   that state.
    ///
    /// # Returns
    /// The provisioned phone number.
    pub fn provision(
        &self,
        agent_handle: &str,
        type_: &str,
        state: Option<&str>,
    ) -> Result<PhoneNumber> {
        let mut body = Map::new();
        body.insert("agent_handle".into(), agent_handle.into());
        body.insert("type".into(), type_.into());
        if let Some(s) = state {
            body.insert("state".into(), s.into());
        }
        let data = self.http.post(BASE, Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Release a phone number.
    pub fn release(&self, phone_number_id: &str) -> Result<()> {
        self.http.delete(&format!("{BASE}/{phone_number_id}"))
    }

    /// Full-text search across transcripts for a phone number.
    ///
    /// # Arguments
    /// * `q` - Search query string.
    /// * `party` - Filter by speaker: `"local"` or `"remote"`.
    /// * `limit` - Maximum number of results (1-200).
    pub fn search_transcripts(
        &self,
        phone_number_id: &str,
        q: &str,
        party: Option<&str>,
        limit: i64,
    ) -> Result<Vec<PhoneTranscript>> {
        // Python passes `party=None` through; the transport drops None-valued
        // params, so we only push `party` when present.
        let mut params: Vec<(&str, String)> =
            vec![("q", q.to_string()), ("limit", limit.to_string())];
        if let Some(p) = party {
            params.push(("party", p.to_string()));
        }
        let data = self
            .http
            .get(&format!("{BASE}/{phone_number_id}/search"), &params)?;
        Ok(serde_json::from_value(data)?)
    }
}

/// Map an `Option<&str>` to a JSON string or an explicit JSON `null`.
fn str_or_null(v: Option<&str>) -> Value {
    match v {
        Some(s) => Value::String(s.to_string()),
        None => Value::Null,
    }
}

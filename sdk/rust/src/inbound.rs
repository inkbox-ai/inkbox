//! Inbound sources for hosted agents. Each source has a public URL that
//! accepts requests from an external service, optionally verifies the
//! sender's signature, and delivers each request to the agent as an
//! `inbound.received` event.

use std::collections::HashMap;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};
use crate::identities::types::Unset;
use crate::organization_domains::path_segment;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum InboundSignatureScheme {
    Stripe,
    Github,
    Slack,
    StandardWebhooks,
    Hmac,
}

/// Sender signature check. `header`/`algorithm`/`encoding`/`prefix` apply to `Hmac`.
#[derive(Clone, Debug, Serialize)]
pub struct InboundSignatureInput {
    pub scheme: InboundSignatureScheme,
    pub secret: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub header: Option<String>,
    /// `sha256` or `sha1`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub algorithm: Option<String>,
    /// `hex` or `base64`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub encoding: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prefix: Option<String>,
}

impl InboundSignatureInput {
    pub fn new(scheme: InboundSignatureScheme, secret: impl Into<String>) -> Self {
        Self {
            scheme,
            secret: secret.into(),
            header: None,
            algorithm: None,
            encoding: None,
            prefix: None,
        }
    }
}

/// Signature settings as returned; the secret is never returned.
#[derive(Clone, Debug, Deserialize)]
pub struct InboundSignature {
    pub scheme: String,
    #[serde(default)]
    pub header: Option<String>,
    #[serde(default)]
    pub algorithm: Option<String>,
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub prefix: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum InboundHandler {
    Agent {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        instructions: Option<String>,
    },
    Script {
        command: String,
    },
}

/// The external request as received. Hop-by-hop, cookie and authorization headers are removed.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct InboundRequest {
    pub method: String,
    #[serde(default)]
    pub query: HashMap<String, String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    pub content_type: Option<String>,
    pub body: String,
    /// `utf8` or `base64`.
    pub body_encoding: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InboundSource {
    pub id: String,
    pub name: String,
    pub url: String,
    #[serde(default)]
    pub signature: Option<InboundSignature>,
    pub handler: InboundHandler,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InboundEvent {
    pub id: String,
    pub source_id: String,
    pub received_at: String,
    /// `pending`, `delivered` or `failed`.
    pub status: String,
    pub attempts: u32,
    #[serde(default)]
    pub last_error: Option<String>,
    pub signature_verified: bool,
    #[serde(default)]
    pub content_type: Option<String>,
    pub size_bytes: u64,
    /// Only returned by `get_event`.
    #[serde(default)]
    pub request: Option<InboundRequest>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct InboundEventPage {
    pub events: Vec<InboundEvent>,
    #[serde(default)]
    pub next_cursor: Option<String>,
}

/// Partial source update. Omitted fields are unchanged; `signature: Unset::Value(None)` removes verification.
#[derive(Clone, Debug, Default)]
pub struct InboundSourceUpdate {
    pub name: Option<String>,
    pub handler: Option<InboundHandler>,
    pub signature: Unset<InboundSignatureInput>,
}

/// Manage an identity's inbound sources and events. The identity must be hosted.
pub struct InboundResource {
    http: Arc<HttpTransport>,
}

impl InboundResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    fn path(handle: &str, parts: &[&str]) -> String {
        let mut path = format!("/{}/inbound", path_segment(handle));
        for part in parts {
            path.push('/');
            path.push_str(&path_segment(part));
        }
        path
    }

    pub fn create_source(
        &self,
        handle: &str,
        name: &str,
        handler: &InboundHandler,
        signature: Option<&InboundSignatureInput>,
    ) -> Result<InboundSource> {
        let body = json!({ "name": name, "signature": signature, "handler": handler });
        Ok(serde_json::from_value(self.http.post(
            &Self::path(handle, &[]),
            Some(&body),
            NO_QUERY,
        )?)?)
    }

    pub fn list_sources(&self, handle: &str) -> Result<Vec<InboundSource>> {
        #[derive(Deserialize)]
        struct Sources {
            sources: Vec<InboundSource>,
        }
        let data: Sources =
            serde_json::from_value(self.http.get(&Self::path(handle, &[]), NO_QUERY)?)?;
        Ok(data.sources)
    }

    pub fn get_source(&self, handle: &str, source_id: &str) -> Result<InboundSource> {
        Ok(serde_json::from_value(
            self.http.get(&Self::path(handle, &[source_id]), NO_QUERY)?,
        )?)
    }

    pub fn update_source(
        &self,
        handle: &str,
        source_id: &str,
        update: &InboundSourceUpdate,
    ) -> Result<InboundSource> {
        let mut body = Map::new();
        if let Some(name) = &update.name {
            body.insert("name".into(), json!(name));
        }
        if let Some(handler) = &update.handler {
            body.insert("handler".into(), serde_json::to_value(handler)?);
        }
        if let Unset::Value(signature) = &update.signature {
            body.insert("signature".into(), serde_json::to_value(signature)?);
        }
        Ok(serde_json::from_value(self.http.patch(
            &Self::path(handle, &[source_id]),
            &Value::Object(body),
        )?)?)
    }

    pub fn delete_source(&self, handle: &str, source_id: &str) -> Result<()> {
        self.http.delete(&Self::path(handle, &[source_id]))
    }

    /// Issue a new URL; the previous URL stops accepting requests.
    pub fn rotate_source(&self, handle: &str, source_id: &str) -> Result<InboundSource> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &Self::path(handle, &[source_id, "rotate"]),
            None,
            NO_QUERY,
        )?)?)
    }

    pub fn list_events(
        &self,
        handle: &str,
        source_id: &str,
        limit: Option<u32>,
        cursor: Option<&str>,
    ) -> Result<InboundEventPage> {
        let mut query = Vec::new();
        if let Some(limit) = limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(cursor) = cursor {
            query.push(("cursor", cursor.to_owned()));
        }
        Ok(serde_json::from_value(self.http.get(
            &Self::path(handle, &[source_id, "events"]),
            &query,
        )?)?)
    }

    /// Includes the received `request`.
    pub fn get_event(&self, handle: &str, source_id: &str, event_id: &str) -> Result<InboundEvent> {
        Ok(serde_json::from_value(self.http.get(
            &Self::path(handle, &[source_id, "events", event_id]),
            NO_QUERY,
        )?)?)
    }

    /// Deliver the event to the agent again.
    pub fn replay_event(
        &self,
        handle: &str,
        source_id: &str,
        event_id: &str,
    ) -> Result<InboundEvent> {
        Ok(serde_json::from_value(self.http.post::<Value>(
            &Self::path(handle, &[source_id, "events", event_id, "replay"]),
            None,
            NO_QUERY,
        )?)?)
    }

    /// Report that the agent could not process an event. Requires the identity's own API key.
    pub fn report_inbound_event_result(
        &self,
        handle: &str,
        source_id: &str,
        event_id: &str,
        error: &str,
    ) -> Result<()> {
        self.http.post(
            &Self::path(handle, &[source_id, "events", event_id, "result"]),
            Some(&json!({ "status": "failed", "error": error })),
            NO_QUERY,
        )?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use super::*;
    use crate::client::Inkbox;

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    fn source_json() -> Value {
        json!({
            "id": "inbsrc_1", "name": "payments", "url": "https://agent.example.test/inbound/token",
            "signature": {"scheme": "hmac", "header": "x-signature", "algorithm": "sha256"},
            "handler": {"type": "script", "command": "./run.sh"},
            "created_at": "2026-01-01T00:00:00Z", "updated_at": "2026-01-01T00:00:00Z"
        })
    }

    fn event_json() -> Value {
        json!({
            "id": "inbev_1", "source_id": "inbsrc_1", "received_at": "2026-01-01T00:00:00Z",
            "status": "failed", "attempts": 2, "last_error": "timeout", "signature_verified": true,
            "content_type": "application/json", "size_bytes": 2
        })
    }

    #[test]
    fn manages_sources() {
        let server = MockServer::start();
        let base = "/api/v1/identities/agent/inbound";
        let create = server.mock(|when, then| {
            when.method(POST).path(base).json_body(json!({
                "name": "payments",
                "signature": {"scheme": "standard-webhooks", "secret": "synthetic-secret"},
                "handler": {"type": "agent"}
            }));
            then.status(201).json_body(source_json());
        });
        let list = server.mock(|when, then| {
            when.method(GET).path(base);
            then.status(200)
                .json_body(json!({"sources": [source_json()]}));
        });
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(format!("{base}/inbsrc_1"))
                .json_body(json!({"name": "renamed", "signature": null}));
            then.status(200).json_body(source_json());
        });
        let rotate = server.mock(|when, then| {
            when.method(POST).path(format!("{base}/inbsrc_1/rotate"));
            then.status(200).json_body(source_json());
        });
        let delete = server.mock(|when, then| {
            when.method(DELETE).path(format!("{base}/inbsrc_1"));
            then.status(204);
        });

        let inbound = client(&server);
        let inbound = inbound.inbound();
        let signature = InboundSignatureInput::new(
            InboundSignatureScheme::StandardWebhooks,
            "synthetic-secret",
        );
        let source = inbound
            .create_source(
                "agent",
                "payments",
                &InboundHandler::Agent { instructions: None },
                Some(&signature),
            )
            .unwrap();
        assert_eq!(
            source.handler,
            InboundHandler::Script {
                command: "./run.sh".into()
            }
        );
        assert_eq!(source.signature.unwrap().scheme, "hmac");
        assert_eq!(inbound.list_sources("agent").unwrap().len(), 1);
        inbound
            .update_source(
                "agent",
                "inbsrc_1",
                &InboundSourceUpdate {
                    name: Some("renamed".into()),
                    signature: Unset::Value(None),
                    ..Default::default()
                },
            )
            .unwrap();
        inbound.rotate_source("agent", "inbsrc_1").unwrap();
        inbound.delete_source("agent", "inbsrc_1").unwrap();
        for mock in [create, list, update, rotate, delete] {
            mock.assert();
        }
    }

    #[test]
    fn manages_events() {
        let server = MockServer::start();
        let base = "/api/v1/identities/agent/inbound/inbsrc_1/events";
        let list = server.mock(|when, then| {
            when.method(GET)
                .path(base)
                .query_param("limit", "10")
                .query_param("cursor", "c");
            then.status(200)
                .json_body(json!({"events": [event_json()], "next_cursor": null}));
        });
        let mut detail = event_json();
        detail["request"] = json!({
            "method": "POST", "query": {}, "headers": {"content-type": "application/json"},
            "content_type": "application/json", "body": "{}", "body_encoding": "utf8"
        });
        let get = server.mock(|when, then| {
            when.method(GET).path(format!("{base}/inbev_1"));
            then.status(200).json_body(detail);
        });
        let replay = server.mock(|when, then| {
            when.method(POST).path(format!("{base}/inbev_1/replay"));
            then.status(202).json_body(event_json());
        });
        let result = server.mock(|when, then| {
            when.method(POST)
                .path(format!("{base}/inbev_1/result"))
                .json_body(json!({"status": "failed", "error": "exit 1"}));
            then.status(204);
        });

        let client = client(&server);
        let inbound = client.inbound();
        let page = inbound
            .list_events("agent", "inbsrc_1", Some(10), Some("c"))
            .unwrap();
        assert!(page.next_cursor.is_none() && page.events[0].request.is_none());
        let event = inbound.get_event("agent", "inbsrc_1", "inbev_1").unwrap();
        assert_eq!(event.request.unwrap().body_encoding, "utf8");
        assert_eq!(
            inbound
                .replay_event("agent", "inbsrc_1", "inbev_1")
                .unwrap()
                .attempts,
            2
        );
        inbound
            .report_inbound_event_result("agent", "inbsrc_1", "inbev_1", "exit 1")
            .unwrap();
        for mock in [list, get, replay, result] {
            mock.assert();
        }
    }

    #[test]
    fn parses_inbound_received_payload() {
        let payload: crate::webhooks::InboundReceivedWebhookPayload =
            serde_json::from_value(json!({
                "id": "evt_1", "event_type": "inbound.received", "timestamp": "2026-01-01T00:00:00Z",
                "data": {
                    "event_id": "inbev_1", "delivery_id": "dlv_1", "received_at": "2026-01-01T00:00:00Z",
                    "source": {"id": "inbsrc_1", "name": "payments", "instructions": null},
                    "handler": {"type": "agent"}, "signature_verified": true,
                    "request": {"method": "POST", "query": {}, "headers": {}, "content_type": null,
                                "body": "AA==", "body_encoding": "base64"}
                }
            }))
            .unwrap();
        assert_eq!(
            payload.data.handler,
            InboundHandler::Agent { instructions: None }
        );
        assert_eq!(payload.data.request.body_encoding, "base64");
        assert_eq!(payload.data.delivery_id, "dlv_1");
    }
}

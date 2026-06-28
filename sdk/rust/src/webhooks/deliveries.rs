//! Webhook delivery log + manual replay.
//!
//! Every outbound webhook attempt is recorded as a delivery row: the signed
//! request body that was sent, the endpoint's HTTP response (or transport
//! error), and timing. Use [`WebhookDeliveriesResource::list`] to inspect what
//! was (or was not) delivered, and [`WebhookDeliveriesResource::replay`] to
//! re-deliver a logged event to its subscription's current URL.
//!
//! Replay reuses the original envelope `event_id`, so it only recovers a
//! *miss*: a compliant endpoint that already processed the original event
//! dedupes the replay away. It does not force reprocessing. Incoming-call
//! deliveries (which carry a `phone_number_id` and no `webhook_subscription_id`)
//! are logged but not replayable.

use std::sync::Arc;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::Result;
use crate::http::HttpTransport;

const BASE: &str = "/webhooks/deliveries";

/// One logged outbound webhook delivery attempt.
///
/// `webhook_subscription_id` is populated for subscription deliveries and
/// `None` for incoming-call deliveries (which instead carry `phone_number_id`).
/// `organization_id` is an `"org_..."` token string, not a UUID.
/// `request_payload` is the raw signed request body that was delivered.
/// `response_status` / `response_body` are `None` on transport failure (in which
/// case `error_detail` is set). `is_replay` is `true` for rows produced by
/// [`WebhookDeliveriesResource::replay`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookDelivery {
    pub id: Uuid,
    pub organization_id: String,
    #[serde(default)]
    pub webhook_subscription_id: Option<Uuid>,
    #[serde(default)]
    pub phone_number_id: Option<Uuid>,
    pub event_id: String,
    pub event_type: String,
    pub url: String,
    pub request_payload: String,
    #[serde(default)]
    pub response_status: Option<i32>,
    #[serde(default)]
    pub response_body: Option<String>,
    #[serde(default)]
    pub error_detail: Option<String>,
    #[serde(default)]
    pub duration_ms: Option<i64>,
    pub is_replay: bool,
    // ISO 8601 timestamp string (the contract keeps ISO strings as `String`).
    pub created_at: String,
}

/// Envelope for the `list` response.
#[derive(Debug, Deserialize)]
struct ListResponse {
    deliveries: Vec<WebhookDelivery>,
}

/// Webhook delivery-log + replay resource.
pub struct WebhookDeliveriesResource {
    http: Arc<HttpTransport>,
}

impl WebhookDeliveriesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List logged webhook delivery attempts, newest first.
    ///
    /// Filters AND-combine. `subscription_id` scopes to one subscription's
    /// deliveries; `phone_number_id` scopes to a phone number's incoming-call
    /// deliveries. `success` filters on a 2xx response (`Some(true)` ->
    /// delivered, `Some(false)` -> failed or no response). `limit` is clamped to
    /// `[1, 200]` by the API (default 50); `offset` paginates.
    ///
    /// # Arguments
    /// * `subscription_id` - optional subscription UUID filter.
    /// * `phone_number_id` - optional phone-number UUID filter.
    /// * `event_type` - optional single event-type filter.
    /// * `success` - optional 2xx-response filter.
    /// * `limit` - page size; `None` uses the API default of 50.
    /// * `offset` - row offset; `None` starts at 0.
    ///
    /// # Returns
    /// The matching delivery rows.
    pub fn list(
        &self,
        subscription_id: Option<Uuid>,
        phone_number_id: Option<Uuid>,
        event_type: Option<&str>,
        success: Option<bool>,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<Vec<WebhookDelivery>> {
        // Build the query, omitting any filter the caller left as `None`.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = subscription_id {
            params.push(("subscription_id", id.to_string()));
        }
        if let Some(id) = phone_number_id {
            params.push(("phone_number_id", id.to_string()));
        }
        if let Some(e) = event_type {
            params.push(("event_type", e.to_string()));
        }
        if let Some(s) = success {
            params.push(("success", s.to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        if let Some(o) = offset {
            params.push(("offset", o.to_string()));
        }
        let data = self.http.get(BASE, &params)?;
        let parsed: ListResponse = serde_json::from_value(data)?;
        Ok(parsed.deliveries)
    }

    /// Re-deliver a logged event to its subscription's current URL.
    ///
    /// Reuses the original envelope `event_id` (so a compliant endpoint dedupes
    /// a replay it already processed) but re-signs with a fresh
    /// request-id/timestamp, and records a new delivery row with
    /// `is_replay = true` -- which is what this returns.
    ///
    /// Errors if the delivery is an incoming-call row (not replayable, 422), or
    /// if its subscription is no longer active or no longer subscribes to the
    /// event type (409).
    ///
    /// # Arguments
    /// * `delivery_id` - the logged delivery row to replay.
    ///
    /// # Returns
    /// The new replay delivery row.
    pub fn replay(&self, delivery_id: Uuid) -> Result<WebhookDelivery> {
        // No request body; annotate `B` since `None` can't infer it.
        let data = self.http.post::<serde_json::Value>(
            &format!("{BASE}/{delivery_id}/replay"),
            None,
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}

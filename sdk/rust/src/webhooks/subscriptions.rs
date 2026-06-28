//! Webhook subscriptions -- fan-out per `(owner, url, event_types)`.
//!
//! Replaces the legacy per-resource `webhook_url` columns on mailboxes and
//! phone numbers. Use this resource to attach HTTPS receivers to mail
//! (`message.*`), phone-text (`text.*`), or iMessage (`imessage.*`) events.
//! Mail and text subscriptions are owned by the mailbox / phone number;
//! iMessage subscriptions are owned by the agent identity, since shared
//! iMessage pool numbers are not org resources. Incoming-call webhooks
//! (`phone.incoming_call`) are still set on the phone-number resource itself --
//! that channel is a synchronous control-plane callback whose response body
//! drives call routing, so fan-out is not meaningful.

use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::json;
use uuid::Uuid;

use crate::error::{InkboxError, Result};
use crate::http::HttpTransport;

const BASE: &str = "/webhooks/subscriptions";
const INCOMING_CALL: &str = "phone.incoming_call";

/// Lifecycle status of a subscription row. Callers only ever see `"active"`;
/// deleted subscriptions are not returned by `list` / `get`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookSubscriptionStatus {
    Active,
    Deleted,
}

/// A webhook subscription row returned by the API.
///
/// Exactly one of `mailbox_id` / `phone_number_id` / `agent_identity_id` (the
/// raw owner FK) is populated. `owner_identity_id` is the **resolved** owning
/// agent identity for every subscription regardless of channel — mail/phone
/// subs resolve it server-side through the mailbox / phone number, while
/// iMessage subs carry it directly. (Optional for forward-compatibility: `None`
/// on servers that predate the field.) `organization_id` is an `"org_..."`
/// token string, not a UUID. `status` is always `"active"` for subscriptions
/// callers can observe; deleted subscriptions are not returned by `list` /
/// `get`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSubscription {
    pub id: Uuid,
    pub organization_id: String,
    pub mailbox_id: Option<Uuid>,
    pub phone_number_id: Option<Uuid>,
    // `agent_identity_id` may be absent on older wire bodies (Python uses
    // `d.get(...)`), so default it to `None` when the key is missing.
    #[serde(default)]
    pub agent_identity_id: Option<Uuid>,
    pub url: String,
    pub event_types: Vec<String>,
    pub status: WebhookSubscriptionStatus,
    // ISO 8601 timestamp strings (Python parses to `datetime`; the contract
    // keeps ISO strings as `String`).
    pub created_at: String,
    pub updated_at: String,
    // Resolved owning identity; absent on servers that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_identity_id: Option<Uuid>,
}

/// The response from creating a webhook subscription.
///
/// Extends [`WebhookSubscription`] with a one-time `signing_key`. It is
/// populated **only** on the request that first mints the owning identity's
/// signing key (returned once — store it securely); on every other create it is
/// `None`. `list` / `get` / `update` never return it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSubscriptionCreateResponse {
    #[serde(flatten)]
    pub subscription: WebhookSubscription,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub signing_key: Option<String>,
}

/// Envelope for the `list` response.
#[derive(Debug, Deserialize)]
struct ListResponse {
    subscriptions: Vec<WebhookSubscription>,
}

/// Owner channel -> the event-type prefix it accepts.
const OWNER_EVENT_PREFIXES: &[(&str, &str)] = &[
    ("mailbox", "message."),
    ("phone_number", "text."),
    ("agent_identity", "imessage."),
];

/// Reject an empty list or one carrying duplicate values.
fn assert_event_types_non_empty_distinct(event_types: &[String]) -> Result<()> {
    if event_types.is_empty() {
        return Err(InkboxError::InvalidArgument(
            "event_types must be a non-empty list".into(),
        ));
    }
    let mut seen: HashSet<&str> = HashSet::new();
    for e in event_types {
        if !seen.insert(e.as_str()) {
            return Err(InkboxError::InvalidArgument(format!(
                "event_types contains duplicate value: '{e}'"
            )));
        }
    }
    Ok(())
}

/// The incoming-call event is set on the phone number, not stored here.
fn assert_no_incoming_call(event_types: &[String]) -> Result<()> {
    if event_types.iter().any(|e| e == INCOMING_CALL) {
        return Err(InkboxError::InvalidArgument(format!(
            "event_type '{INCOMING_CALL}' is not stored in webhook \
             subscriptions; set it on the phone number's \
             `incoming_call_webhook_url` field instead"
        )));
    }
    Ok(())
}

/// Every event type must belong to the owner's channel.
fn assert_channel_coherence(owner: &str, event_types: &[String]) -> Result<()> {
    let expected_prefix = OWNER_EVENT_PREFIXES
        .iter()
        .find(|(name, _)| *name == owner)
        .map(|(_, prefix)| *prefix)
        .expect("owner must be one of the known channels");
    for e in event_types {
        if e.starts_with(expected_prefix) {
            continue;
        }
        // Belongs to a different known channel?
        for (other_owner, other_prefix) in OWNER_EVENT_PREFIXES {
            if *other_owner != owner && e.starts_with(other_prefix) {
                return Err(InkboxError::InvalidArgument(format!(
                    "event_type '{e}' does not belong to the {owner} channel \
                     (it belongs to {other_owner})"
                )));
            }
        }
        return Err(InkboxError::InvalidArgument(format!(
            "event_type '{e}' does not belong to any known channel"
        )));
    }
    Ok(())
}

/// Webhook subscription CRUD resource.
pub struct WebhookSubscriptionsResource {
    http: Arc<HttpTransport>,
}

impl WebhookSubscriptionsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List webhook subscriptions visible to the caller.
    ///
    /// Filters AND-combine. `mailbox_id` / `phone_number_id` /
    /// `agent_identity_id` are mutually exclusive -- passing more than one
    /// yields a 422. Deleted subscriptions are not returned.
    ///
    /// # Arguments
    /// * `mailbox_id` - optional mailbox UUID filter.
    /// * `phone_number_id` - optional phone-number UUID filter.
    /// * `agent_identity_id` - optional agent-identity UUID filter.
    /// * `url` - optional exact-URL filter.
    /// * `event_type` - optional single event-type filter.
    ///
    /// # Returns
    /// The matching subscriptions.
    pub fn list(
        &self,
        mailbox_id: Option<Uuid>,
        phone_number_id: Option<Uuid>,
        agent_identity_id: Option<Uuid>,
        url: Option<&str>,
        event_type: Option<&str>,
    ) -> Result<Vec<WebhookSubscription>> {
        // Build the query, omitting any filter the caller left as `None`.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = mailbox_id {
            params.push(("mailbox_id", id.to_string()));
        }
        if let Some(id) = phone_number_id {
            params.push(("phone_number_id", id.to_string()));
        }
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(u) = url {
            params.push(("url", u.to_string()));
        }
        if let Some(e) = event_type {
            params.push(("event_type", e.to_string()));
        }
        let data = self.http.get(BASE, &params)?;
        let parsed: ListResponse = serde_json::from_value(data)?;
        Ok(parsed.subscriptions)
    }

    /// Fetch a single subscription by id. Returns 404 if the subscription has
    /// been deleted or is not visible to the caller.
    pub fn get(&self, sub_id: Uuid) -> Result<WebhookSubscription> {
        let data = self
            .http
            .get(&format!("{BASE}/{sub_id}"), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a webhook subscription.
    ///
    /// Exactly one of `mailbox_id` / `phone_number_id` / `agent_identity_id` is
    /// required. `event_types` must be a non-empty list of distinct values
    /// belonging to the owner's channel (mailbox -> `message.*`, phone number
    /// -> `text.*`, agent identity -> `imessage.*`).
    ///
    /// # Arguments
    /// * `url` - HTTPS receiver endpoint.
    /// * `event_types` - non-empty, distinct event-type strings.
    /// * `mailbox_id` / `phone_number_id` / `agent_identity_id` - exactly one.
    ///
    /// # Returns
    /// A [`WebhookSubscriptionCreateResponse`]. Its `signing_key` is populated
    /// **once** when this is the first subscription for an identity that had no
    /// signing key yet — store it securely; it is the only time the plaintext
    /// secret is shown. Otherwise `signing_key` is `None`.
    pub fn create(
        &self,
        url: &str,
        event_types: &[String],
        mailbox_id: Option<Uuid>,
        phone_number_id: Option<Uuid>,
        agent_identity_id: Option<Uuid>,
    ) -> Result<WebhookSubscriptionCreateResponse> {
        // Exactly one owner FK must be set.
        let owners: [(&str, Option<Uuid>); 3] = [
            ("mailbox", mailbox_id),
            ("phone_number", phone_number_id),
            ("agent_identity", agent_identity_id),
        ];
        let populated: Vec<(&str, Uuid)> = owners
            .iter()
            .filter_map(|(name, value)| value.map(|v| (*name, v)))
            .collect();
        if populated.len() != 1 {
            return Err(InkboxError::InvalidArgument(
                "Exactly one of mailbox_id, phone_number_id, or \
                 agent_identity_id must be provided"
                    .into(),
            ));
        }
        let (owner, owner_id) = populated[0];

        // Validate the event-type list against the owner's channel.
        assert_event_types_non_empty_distinct(event_types)?;
        assert_no_incoming_call(event_types)?;
        assert_channel_coherence(owner, event_types)?;

        // Body mirrors the Python dict: url, event_types, and the single
        // `{owner}_id` key (built on a Map since the owner key is computed).
        let mut body = serde_json::Map::new();
        body.insert("url".into(), json!(url));
        body.insert("event_types".into(), json!(event_types));
        body.insert(format!("{owner}_id"), json!(owner_id.to_string()));
        let body = serde_json::Value::Object(body);
        let data = self.http.post(BASE, Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update the URL and/or event-type list of a subscription.
    ///
    /// `event_types`, if supplied, replaces the stored list and must be
    /// non-empty and distinct. Owner FKs are not mutable. Passing both
    /// arguments as `None` issues a PATCH with an empty body (a no-op),
    /// matching the Python `_UNSET` behaviour.
    ///
    /// # Arguments
    /// * `sub_id` - subscription UUID.
    /// * `url` - `None` to leave unchanged, `Some` to replace.
    /// * `event_types` - `None` to leave unchanged, `Some` to replace.
    ///
    /// # Returns
    /// The updated subscription.
    pub fn update(
        &self,
        sub_id: Uuid,
        url: Option<&str>,
        event_types: Option<&[String]>,
    ) -> Result<WebhookSubscription> {
        // Only include keys the caller supplied (Python omits `_UNSET` keys).
        let mut body = serde_json::Map::new();
        if let Some(u) = url {
            body.insert("url".into(), json!(u));
        }
        if let Some(events) = event_types {
            assert_event_types_non_empty_distinct(events)?;
            assert_no_incoming_call(events)?;
            body.insert("event_types".into(), json!(events));
        }
        let data = self.http.patch(
            &format!("{BASE}/{sub_id}"),
            &serde_json::Value::Object(body),
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a subscription. Subsequent `list` / `get` calls will not return
    /// it.
    pub fn delete(&self, sub_id: Uuid) -> Result<()> {
        self.http.delete(&format!("{BASE}/{sub_id}"))
    }
}

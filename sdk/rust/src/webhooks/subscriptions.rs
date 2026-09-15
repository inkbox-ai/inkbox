//! Identity-owned subscriptions can combine notification events from every
//! channel, including channels not yet configured. Incoming-call actions remain
//! separate synchronous call-control settings.

use std::collections::HashSet;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::{InkboxError, Result};
use crate::http::HttpTransport;

const BASE: &str = "/webhooks/subscriptions";
const INCOMING_CALL: &str = "phone.incoming_call";

const CONTEXT_MAX_COUNT: u32 = 50;
const CONTEXT_MAX_WINDOW_HOURS: u32 = 168;

/// Per-class conversation-context config: count-mode or window-mode.
///
/// `Count` delivers the last `count` items of the class (1..=50); `Window`
/// delivers items from the last `hours` hours (1..=168). Tagged on the wire by
/// a `"mode"` field (`"count"` / `"window"`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "mode", rename_all = "snake_case")]
pub enum WebhookContextClassConfig {
    Count { count: u32 },
    Window { hours: u32 },
}

/// Per-subscription conversation-context config, keyed by class.
///
/// Omit a class to leave it unconfigured. The server echoes unconfigured
/// classes back as explicit `null`, which deserializes to `None`.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct WebhookContextConfig {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub email: Option<WebhookContextClassConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub texts: Option<WebhookContextClassConfig>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub calls: Option<WebhookContextClassConfig>,
}

/// Validate one class entry's numeric bound (count 1..=50, window 1..=168).
fn assert_valid_context_entry(klass: &str, entry: &WebhookContextClassConfig) -> Result<()> {
    let (value, hi, key) = match entry {
        WebhookContextClassConfig::Count { count } => (*count, CONTEXT_MAX_COUNT, "count"),
        WebhookContextClassConfig::Window { hours } => (*hours, CONTEXT_MAX_WINDOW_HOURS, "hours"),
    };
    if !(1..=hi).contains(&value) {
        return Err(InkboxError::InvalidArgument(format!(
            "context_config[{klass}].{key} must be an int in 1..{hi}"
        )));
    }
    Ok(())
}

/// Validate a whole context_config against the server's numeric rules.
///
/// Unknown class keys and modes are impossible by construction in Rust, so
/// only the count/window bounds are checked. A `None` class is skipped.
fn assert_valid_context_config(cfg: &WebhookContextConfig) -> Result<()> {
    if let Some(e) = &cfg.email {
        assert_valid_context_entry("email", e)?;
    }
    if let Some(e) = &cfg.texts {
        assert_valid_context_entry("texts", e)?;
    }
    if let Some(e) = &cfg.calls {
        assert_valid_context_entry("calls", e)?;
    }
    Ok(())
}

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
/// `agent_identity_id` is the canonical owner. Legacy responses may instead
/// populate `mailbox_id` or `phone_number_id`. `owner_identity_id` provides
/// the resolved identity for compatibility. (Optional for
/// forward-compatibility: `None` on servers that predate the field.)
/// `organization_id` is an `"org_..."`
/// token string, not a UUID. `status` is always `"active"` for subscriptions
/// callers can observe; deleted subscriptions are not returned by `list` /
/// `get`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WebhookSubscription {
    /// Version for conditional updates and deletion; 1 on older responses.
    #[serde(default = "initial_revision")]
    pub revision: u64,
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
    // Per-class conversation-context config; absent on subscriptions that never
    // opted in and on servers that predate the field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context_config: Option<WebhookContextConfig>,
    /// Whether a delivery bearer token is configured. Defaults to `false`
    /// when the server omits the field.
    #[serde(default)]
    pub has_auth_token: bool,
    /// The delivery bearer token, returned on every read; `None` when unset
    /// (and on servers that predate the field).
    #[serde(default)]
    pub auth_token: Option<String>,
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

fn initial_revision() -> u64 {
    1
}

const EVENT_PREFIXES: &[&str] = &["message.", "text.", "imessage.", "call.", "a2a."];

fn assert_revision(revision: u64) -> Result<()> {
    if revision == 0 {
        return Err(InkboxError::InvalidArgument(
            "expected_revision must be positive".into(),
        ));
    }
    Ok(())
}

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

/// Incoming-call actions are separate identity settings, not subscriptions.
fn assert_no_incoming_call(event_types: &[String]) -> Result<()> {
    if event_types.iter().any(|e| e == INCOMING_CALL) {
        return Err(InkboxError::InvalidArgument(format!(
            "event_type '{INCOMING_CALL}' is not stored in webhook \
             subscriptions; configure the identity's incoming-call action instead"
        )));
    }
    Ok(())
}

fn assert_known_event_prefixes(event_types: &[String]) -> Result<()> {
    for event_type in event_types {
        if !EVENT_PREFIXES
            .iter()
            .any(|prefix| event_type.starts_with(prefix))
        {
            return Err(InkboxError::InvalidArgument(format!(
                "event_type '{event_type}' does not belong to any known channel"
            )));
        }
    }
    Ok(())
}

/// Identity-owned notification subscription resource.
pub struct WebhookSubscriptionsResource {
    http: Arc<HttpTransport>,
}

impl WebhookSubscriptionsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List webhook subscriptions visible to the caller.
    ///
    /// Legacy mailbox/phone filters resolve the identity and select rows with
    /// mail/text events without narrowing their complete event selections.
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
    /// Prefer `agent_identity_id`; exactly one identity, legacy mailbox, or
    /// legacy phone selector is required. Legacy selectors resolve to their
    /// identity. Any mix of notification events is allowed independently of
    /// configured channels. Context applies only to received mail/text/iMessage.
    ///
    /// # Arguments
    /// * `url` - destination URL.
    /// * `event_types` - nonempty distinct notification event names.
    /// * `mailbox_id` / `phone_number_id` / `agent_identity_id` - exactly one.
    /// * `context_config` - optional per-class conversation-context config.
    /// * `auth_token` - optional delivery bearer token.
    ///
    /// # Returns
    /// A [`WebhookSubscriptionCreateResponse`]. Its `signing_key` is populated
    /// **once** when this is the first subscription for an identity that had no
    /// signing key yet — store it securely; it is the only time the plaintext
    /// secret is shown. Otherwise `signing_key` is `None`.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        url: &str,
        event_types: &[String],
        mailbox_id: Option<Uuid>,
        phone_number_id: Option<Uuid>,
        agent_identity_id: Option<Uuid>,
        context_config: Option<&WebhookContextConfig>,
        auth_token: Option<&str>,
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

        // Catalog membership is independent of the identity's configured channels.
        assert_event_types_non_empty_distinct(event_types)?;
        assert_no_incoming_call(event_types)?;
        assert_known_event_prefixes(event_types)?;

        // Body mirrors the Python dict: url, event_types, and the single
        // `{owner}_id` key (built on a Map since the owner key is computed).
        let mut body = serde_json::Map::new();
        body.insert("url".into(), json!(url));
        body.insert("event_types".into(), json!(event_types));
        body.insert(format!("{owner}_id"), json!(owner_id.to_string()));
        if let Some(cfg) = context_config {
            assert_valid_context_config(cfg)?;
            body.insert("context_config".into(), json!(cfg));
        }
        if let Some(token) = auth_token {
            body.insert("auth_token".into(), json!(token));
        }
        let body = serde_json::Value::Object(body);
        let data = self.http.post(BASE, Some(&body), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update the URL, event-type list, context config, and/or auth token.
    ///
    /// `event_types`, if supplied, replaces the stored list and must be
    /// non-empty and distinct. Owner FKs are not mutable. Passing every
    /// argument as `None` issues a PATCH with an empty body (a no-op),
    /// matching the Python `_UNSET` behaviour.
    ///
    /// `context_config` is tri-state — a field where `null` is meaningful on
    /// the wire: `None` omits the key (unchanged), `Some(None)` sends JSON
    /// `null` (clear), `Some(Some(cfg))` validates and replaces. Context applies
    /// only to received mail, text and iMessage events.
    ///
    /// `auth_token` is tri-state the same way: `None` leaves the delivery
    /// bearer token unchanged, `Some(None)` clears it, `Some(Some(token))`
    /// replaces it.
    ///
    /// # Arguments
    /// * `sub_id` - subscription UUID.
    /// * `url` - `None` to leave unchanged, `Some` to replace.
    /// * `event_types` - `None` to leave unchanged, `Some` to replace.
    /// * `context_config` - tri-state (see above).
    /// * `auth_token` - tri-state (see above).
    ///
    /// # Returns
    /// The updated subscription.
    pub fn update(
        &self,
        sub_id: Uuid,
        url: Option<&str>,
        event_types: Option<&[String]>,
        context_config: Option<Option<&WebhookContextConfig>>,
        auth_token: Option<Option<&str>>,
    ) -> Result<WebhookSubscription> {
        self.update_if_revision(sub_id, url, event_types, context_config, auth_token, None)
    }

    /// Update with an optional last-read revision; stale revisions fail with HTTP 409.
    #[allow(clippy::too_many_arguments)]
    pub fn update_if_revision(
        &self,
        sub_id: Uuid,
        url: Option<&str>,
        event_types: Option<&[String]>,
        context_config: Option<Option<&WebhookContextConfig>>,
        auth_token: Option<Option<&str>>,
        expected_revision: Option<u64>,
    ) -> Result<WebhookSubscription> {
        // Only include keys the caller supplied (Python omits `_UNSET` keys).
        let mut body = serde_json::Map::new();
        if let Some(revision) = expected_revision {
            assert_revision(revision)?;
            body.insert("expected_revision".into(), json!(revision));
        }
        if let Some(u) = url {
            body.insert("url".into(), json!(u));
        }
        if let Some(events) = event_types {
            assert_event_types_non_empty_distinct(events)?;
            assert_no_incoming_call(events)?;
            assert_known_event_prefixes(events)?;
            body.insert("event_types".into(), json!(events));
        }
        if let Some(cfg) = context_config {
            match cfg {
                Some(cfg) => {
                    assert_valid_context_config(cfg)?;
                    body.insert("context_config".into(), json!(cfg));
                }
                None => {
                    body.insert("context_config".into(), Value::Null);
                }
            }
        }
        if let Some(token) = auth_token {
            // `Some(None)` passes through as JSON null to clear the token.
            match token {
                Some(token) => {
                    body.insert("auth_token".into(), json!(token));
                }
                None => {
                    body.insert("auth_token".into(), Value::Null);
                }
            }
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
        self.delete_if_revision(sub_id, None)
    }

    /// Delete with an optional last-read revision; stale revisions fail with HTTP 409.
    pub fn delete_if_revision(&self, sub_id: Uuid, expected_revision: Option<u64>) -> Result<()> {
        match expected_revision {
            None => self.http.delete(&format!("{BASE}/{sub_id}")),
            Some(revision) => {
                assert_revision(revision)?;
                self.http.delete_with_params(
                    &format!("{BASE}/{sub_id}"),
                    &[("expected_revision", revision.to_string())],
                )
            }
        }
    }

    /// Create a subscription directly on an identity without legacy selectors.
    pub fn create_for_identity(
        &self,
        agent_identity_id: Uuid,
        url: &str,
        event_types: &[String],
        context_config: Option<&WebhookContextConfig>,
        auth_token: Option<&str>,
    ) -> Result<WebhookSubscriptionCreateResponse> {
        self.create(
            url,
            event_types,
            None,
            None,
            Some(agent_identity_id),
            context_config,
            auth_token,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(items: &[&str]) -> Vec<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn accepts_mixed_notification_channels() {
        assert!(assert_known_event_prefixes(&ev(&[
            "message.received",
            "text.received",
            "imessage.received",
            "call.ended",
            "a2a.task.created",
        ]))
        .is_ok());
    }

    #[test]
    fn rejects_unknown_channel() {
        assert!(assert_known_event_prefixes(&ev(&["bogus.thing"])).is_err());
        assert!(assert_no_incoming_call(&ev(&["phone.incoming_call"])).is_err());
    }

    #[test]
    fn auth_token_fields_default_and_parse() {
        // Older wire bodies omit the keys entirely; newer ones carry them.
        let base = serde_json::json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_test",
            "mailbox_id": "22222222-2222-2222-2222-222222222222",
            "phone_number_id": null,
            "url": "https://customer.example.com/hook",
            "event_types": ["message.received"],
            "status": "active",
            "created_at": "2026-04-10T18:00:00+00:00",
            "updated_at": "2026-04-10T18:00:00+00:00",
        });
        let sub: WebhookSubscription = serde_json::from_value(base.clone()).unwrap();
        assert_eq!(sub.revision, 1);
        assert!(!sub.has_auth_token);
        assert_eq!(sub.auth_token, None);

        let mut with_token = base;
        with_token["has_auth_token"] = serde_json::json!(true);
        with_token["auth_token"] = serde_json::json!("your-endpoint-token");
        let sub: WebhookSubscription = serde_json::from_value(with_token).unwrap();
        assert!(sub.has_auth_token);
        assert_eq!(sub.auth_token.as_deref(), Some("your-endpoint-token"));
    }

    #[test]
    fn identity_requests_preserve_full_replacement_and_revision_wire_contract() {
        use httpmock::{prelude::*, Method::PATCH};
        let server = MockServer::start();
        let client = crate::client::Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let identity = Uuid::from_u128(3);
        let id = Uuid::from_u128(1);
        let events = ev(&[
            "message.received",
            "text.received",
            "imessage.received",
            "call.ended",
            "a2a.task.created",
        ]);
        let cfg = WebhookContextConfig {
            email: Some(WebhookContextClassConfig::Count { count: 2 }),
            ..Default::default()
        };
        let row = json!({"id": id, "organization_id": "org_test", "mailbox_id": null,
            "phone_number_id": null, "agent_identity_id": identity, "revision": 2,
            "url": "https://example.com/hook", "event_types": events, "status": "active",
            "created_at": "2026-09-15T00:00:00Z", "updated_at": "2026-09-15T00:00:00Z"});
        let create = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/webhooks/subscriptions")
                .json_body(json!({
                    "agent_identity_id": identity, "url": "https://example.com/hook",
                    "event_types": events, "context_config": cfg,
                }));
            then.status(200).json_body(row.clone());
        });
        let resource = client.webhooks();
        let subs = resource.subscriptions();
        let created = subs
            .create_for_identity(
                identity,
                "https://example.com/hook",
                &events,
                Some(&cfg),
                None,
            )
            .unwrap();
        assert_eq!(created.subscription.revision, 2);
        create.assert();
        let update = server.mock(|when, then| {
            when.method(PATCH)
                .path(format!("/api/v1/webhooks/subscriptions/{id}"))
                .json_body(
                    json!({"event_types": ["a2a.task.created", "message.received"],
                    "context_config": null, "auth_token": null, "expected_revision": 2}),
                );
            then.status(200).json_body(row.clone());
        });
        subs.update_if_revision(
            id,
            None,
            Some(&ev(&["a2a.task.created", "message.received"])),
            Some(None),
            Some(None),
            Some(2),
        )
        .unwrap();
        update.assert();
        let delete = server.mock(|when, then| {
            when.method(DELETE)
                .path(format!("/api/v1/webhooks/subscriptions/{id}"))
                .query_param("expected_revision", "2");
            then.status(204);
        });
        subs.delete_if_revision(id, Some(2)).unwrap();
        delete.assert();
        assert!(subs.delete_if_revision(id, Some(0)).is_err());
    }

    #[test]
    fn conditional_update_preserves_conflict_without_retry() {
        use httpmock::{prelude::*, Method::PATCH};
        let server = MockServer::start();
        let client = crate::client::Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let conflict = server.mock(|when, then| {
            when.method(PATCH)
                .path(format!(
                    "/api/v1/webhooks/subscriptions/{}",
                    Uuid::from_u128(1)
                ))
                .json_body(json!({"expected_revision": 1, "event_types": ["message.received"]}));
            then.status(409)
                .json_body(json!({"detail": "Subscription revision changed"}));
        });
        let result = client.webhooks().subscriptions().update_if_revision(
            Uuid::from_u128(1),
            None,
            Some(&ev(&["message.received"])),
            None,
            None,
            Some(1),
        );
        assert!(matches!(
            result,
            Err(InkboxError::Api {
                status_code: 409,
                ..
            })
        ));
        conflict.assert_hits(1);
    }
}

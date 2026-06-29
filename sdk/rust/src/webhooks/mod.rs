//! Webhooks domain: receiver-side payload types and subscription CRUD.
//!
//! Faithful port of `inkbox/webhooks.py` (payload types),
//! `inkbox/webhook_subscriptions.py` (subscription resource), and
//! `inkbox/webhook_deliveries.py` (delivery log + replay). The wire shape
//! (JSON field names, enum string values, request bodies, query params, paths)
//! matches the Python and TypeScript SDKs exactly.
//!
//! Signing keys and `verify_webhook` live in the top-level
//! [`crate::signing_keys`] module, mirroring `inkbox/signing_keys.py`.

pub mod deliveries;
pub mod subscriptions;
pub mod types;

pub use deliveries::{WebhookDeliveriesResource, WebhookDelivery};
pub use subscriptions::{
    WebhookSubscription, WebhookSubscriptionCreateResponse, WebhookSubscriptionStatus,
    WebhookSubscriptionsResource,
};
pub use types::*;

//! Webhooks domain: receiver-side payload types and subscription CRUD.
//!
//! Faithful port of `inkbox/webhooks.py` (payload types) and
//! `inkbox/webhook_subscriptions.py` (subscription resource). The wire shape
//! (JSON field names, enum string values, request bodies, query params, paths)
//! matches the Python and TypeScript SDKs exactly.
//!
//! Signing keys and `verify_webhook` live in the top-level
//! [`crate::signing_keys`] module, mirroring `inkbox/signing_keys.py`.

pub mod subscriptions;
pub mod types;

pub use subscriptions::{
    WebhookSubscription, WebhookSubscriptionStatus, WebhookSubscriptionsResource,
};
pub use types::*;

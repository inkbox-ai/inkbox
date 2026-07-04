//! Phone domain: numbers, calls, texts, transcripts, contact rules, SMS opt-ins.
//!
//! Faithful port of `inkbox/phone/`. The wire shape (JSON field names, enum
//! string values, request bodies, query params, paths) matches the Python and
//! TypeScript SDKs exactly.

pub mod exceptions;
pub mod realtime;
pub mod resources;
pub mod types;

pub use types::*;

pub use resources::calls::CallsResource;
pub use resources::contact_rules::PhoneContactRulesResource;
pub use resources::hosted_realtime::HostedRealtimeResource;

#[cfg(feature = "tunnels-runtime")]
pub use realtime::{RealtimeControlSession, RealtimeResource};
pub use resources::identity_contact_rules::PhoneIdentityContactRulesResource;
pub use resources::incoming_call_action::IncomingCallActionResource;
pub use resources::numbers::PhoneNumbersResource;
pub use resources::sms_opt_ins::SmsOptInsResource;
pub use resources::texts::TextsResource;

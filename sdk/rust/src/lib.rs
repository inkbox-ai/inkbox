//! # inkbox
//!
//! Rust SDK for the [Inkbox](https://inkbox.ai) API — email, SMS/MMS,
//! iMessage, voice, contacts, notes, an encrypted vault, and inbound tunnels
//! for AI agents.
//!
//! This is a faithful port of the Python (`inkbox` on PyPI) and TypeScript
//! (`@inkbox/sdk` on npm) SDKs. The public surface is **blocking** (built on
//! `reqwest::blocking`) to match those SDKs. The tunnels data-plane runtime
//! lives behind the optional `tunnels-runtime` feature.
//!
//! ```no_run
//! use inkbox::Inkbox;
//!
//! # fn main() -> inkbox::Result<()> {
//! let inkbox = Inkbox::new("ApiKey_...")?;
//! let identity = inkbox.get_identity("support-bot")?;
//! identity.send_email(
//!     &["customer@example.com".into()],
//!     "Hello!",
//!     Some("Hi there"),
//!     None, None, None, None, None, false,
//! )?;
//! # Ok(())
//! # }
//! ```

// Internal infrastructure.
mod config;
mod cookies;
pub mod error;
pub mod filters;
pub mod http;

// Org-level entry point + per-identity facade.
pub mod agent_identity;
pub mod client;
pub mod credentials;
pub mod signing_keys;

// API domains (mirror the Python package layout).
pub mod agent_signup;
pub mod api_keys;
pub mod contacts;
pub mod identities;
pub mod imessage;
pub mod mail;
pub mod notes;
pub mod phone;
pub mod tunnels;
pub mod vault;
pub mod webhooks;
pub mod whoami;

// Canonical re-exports.
pub use agent_identity::AgentIdentity;
pub use client::{Inkbox, InkboxBuilder, DEFAULT_BASE_URL};
pub use credentials::Credentials;
pub use error::{ApiErrorDetail, InkboxError, Result};
pub use filters::DateRangeFilter;

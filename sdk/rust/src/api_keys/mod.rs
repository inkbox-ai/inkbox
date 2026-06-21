//! API keys domain — create API keys for the caller's organization.
//!
//! Mirrors `inkbox/api_keys/`.

pub mod resources;
pub mod types;

pub use resources::api_keys::ApiKeysResource;
pub use types::{ApiKey, ApiKeyStatus, CreatedApiKey};

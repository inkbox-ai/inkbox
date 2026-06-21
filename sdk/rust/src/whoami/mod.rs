//! Whoami domain — the `GET /api/whoami` endpoint.
//!
//! Mirrors `inkbox/whoami/`.

pub mod types;

pub use types::{
    parse_whoami, WhoamiApiKeyResponse, WhoamiJwtResponse, WhoamiResponse,
    AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED, AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
    AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED,
};

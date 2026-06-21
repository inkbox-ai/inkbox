//! The Inkbox **identities** domain: agent identities and their linked
//! channels (mailbox, phone number, tunnel) plus identity-visibility grants.
//!
//! Ported from `inkbox/identities/` in the Python SDK. The wire shape (JSON
//! field names, enum string values, request bodies, query params, paths)
//! matches the Python source exactly.
//!
//! Mailbox and tunnel are provisioned atomically by
//! [`resources::IdentitiesResource::create`]; there is no standalone create
//! surface. The per-identity facade with convenience methods lives at
//! [`crate::agent_identity::AgentIdentity`].

pub mod exceptions;
pub mod resources;
pub mod types;

// Re-export the public types.
pub use types::{
    AgentIdentityData, AgentIdentitySummary, IdentityAccess, IdentityMailbox,
    IdentityMailboxCreateOptions, IdentityPhoneNumber, IdentityPhoneNumberCreateOptions,
    IdentityTunnelCreateOptions, Unset, VaultSecretIds,
};

// Re-export the domain exceptions.
pub use exceptions::{map_identity_conflict_error, BlockingNamespace, HandleUnavailableError};

// Re-export the resource.
pub use resources::IdentitiesResource;

//! Agent signup domain — the agent self-signup flow.
//!
//! Mirrors `inkbox/agent_signup/`. The signup/verify/resend/status calls live
//! as classmethods on the client in Python; the orchestrator wires those into
//! the Rust client. This module only exposes the response types.

pub mod types;

pub use types::{
    AgentSignupResendResponse, AgentSignupResponse, AgentSignupStatusResponse,
    AgentSignupVerifyResponse, SignupRestrictions,
};

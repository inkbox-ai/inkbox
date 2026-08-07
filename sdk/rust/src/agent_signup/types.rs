//! Types for the agent self-signup flow, mirroring `inkbox/agent_signup/types.py`.

use serde::{Deserialize, Serialize};

/// Optional fields for [`crate::Inkbox::signup_with`].
#[derive(Debug, Clone, Default)]
pub struct AgentSignupOptions<'a> {
    pub display_name: Option<&'a str>,
    pub agent_handle: Option<&'a str>,
    pub email_local_part: Option<&'a str>,
    pub harness: Option<&'a str>,
    pub invitation_token: Option<&'a str>,
}

/// Invitation state returned by signup and verification when applicable.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignupInvitationSummary {
    pub invitation_id: String,
    pub status: String,
    pub invitee_identity_id: String,
    pub invitee_agent_handle: String,
    pub peer_agent_handles: Vec<String>,
    pub accepted_at: Option<String>,
}

/// Response from `POST /api/v1/agent-signup`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignupResponse {
    pub email_address: String,
    pub organization_id: String,
    pub api_key: String,
    pub agent_handle: String,
    pub claim_status: String,
    pub human_email: String,
    pub message: String,
    #[serde(default)]
    pub invitation: Option<AgentSignupInvitationSummary>,
}

/// Response from `POST /api/v1/agent-signup/verify`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignupVerifyResponse {
    pub claim_status: String,
    pub organization_id: String,
    pub message: String,
    #[serde(default)]
    pub invitation: Option<AgentSignupInvitationSummary>,
}

/// Response from `POST /api/v1/agent-signup/resend-verification`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignupResendResponse {
    pub claim_status: String,
    pub organization_id: String,
    pub message: String,
}

/// Behavioral restrictions applied to an agent based on claim status.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SignupRestrictions {
    pub max_sends_per_day: i64,
    pub allowed_recipients: Vec<String>,
    pub can_receive: bool,
    pub can_create_mailboxes: bool,
}

/// Response from `GET /api/v1/agent-signup/status`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AgentSignupStatusResponse {
    pub claim_status: String,
    pub human_state: String,
    pub human_email: String,
    pub restrictions: SignupRestrictions,
}

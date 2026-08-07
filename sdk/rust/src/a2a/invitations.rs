//! Parsing helpers for shareable A2A invitation links.

use url::{form_urlencoded, Url};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Lifecycle state of an A2A connection invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum A2AInvitationStatus {
    Pending,
    AwaitingVerification,
    Accepted,
    Declined,
    Revoked,
    Expired,
    #[serde(other)]
    Unknown,
}

impl A2AInvitationStatus {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::AwaitingVerification => "awaiting_verification",
            Self::Accepted => "accepted",
            Self::Declined => "declined",
            Self::Revoked => "revoked",
            Self::Expired => "expired",
            Self::Unknown => "unknown",
        }
    }
}

/// Delivery state for an email-bound invitation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[non_exhaustive]
pub enum A2AInvitationEmailStatus {
    NotRequested,
    Pending,
    Sent,
    Failed,
    Indeterminate,
    #[serde(other)]
    Unknown,
}

/// An organization-managed A2A connection invitation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct A2AInvitation {
    pub id: Uuid,
    pub issuer_organization_id: String,
    pub inviter_email: Option<String>,
    pub peer_agent_handles: Vec<String>,
    pub recipient_email: Option<String>,
    pub status: A2AInvitationStatus,
    pub email_status: A2AInvitationEmailStatus,
    pub email_sent_at: Option<String>,
    pub invitee_identity_id: Option<Uuid>,
    pub invitee_agent_handle: Option<String>,
    pub invitee_organization_id: Option<String>,
    pub expires_at: String,
    pub accepted_at: Option<String>,
    pub declined_at: Option<String>,
    pub revoked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

/// Options for creating an A2A connection invitation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct A2AInvitationCreateOptions {
    pub peer_agent_handles: Vec<String>,
    pub recipient_email: Option<String>,
    pub expires_in_seconds: Option<u32>,
}

/// A created invitation, including one-time share material when unbound.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct A2AInvitationCreateResult {
    #[serde(flatten)]
    pub invitation: A2AInvitation,
    #[serde(default)]
    pub invitation_token: Option<String>,
    #[serde(default)]
    pub invitation_url: Option<String>,
    #[serde(default)]
    pub agent_handoff_prompt: Option<String>,
}

/// Options for listing invitations created by the current organization.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct A2AInvitationListOptions {
    pub status: Option<A2AInvitationStatus>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

/// One cursor-paginated page of organization-managed invitations.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct A2AInvitationPage {
    pub items: Vec<A2AInvitation>,
    pub next_cursor: Option<String>,
}

/// Public invitation details returned without accepting the invitation.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct A2AInvitationPreview {
    pub inviter_email: String,
    pub peer_agent_handles: Vec<String>,
    pub expires_at: String,
    pub agent_handoff_prompt: String,
}

/// Result of accepting an invitation with a claimed agent identity.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct A2AInvitationAcceptResult {
    pub invitation_id: String,
    pub status: String,
    pub invitee_identity_id: String,
    pub invitee_agent_handle: String,
    pub peer_agent_handles: Vec<String>,
    pub accepted_at: String,
}

const DEFAULT_BASE_URL: &str = "https://inkbox.ai";
const MAX_INVITATION_INPUT_BYTES: usize = 2048;

/// An A2A invitation link is invalid for the configured site.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("the A2A invitation link is invalid")]
pub struct A2AInvitationParseError;

fn malformed_percent_encoding(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            if index + 2 >= bytes.len()
                || !bytes[index + 1].is_ascii_hexdigit()
                || !bytes[index + 2].is_ascii_hexdigit()
            {
                return true;
            }
            index += 3;
        } else {
            index += 1;
        }
    }
    false
}

fn invitation_origin_allowed(invitation: &Url, configured: &Url) -> bool {
    if invitation.origin() == configured.origin() {
        return true;
    }
    if invitation.scheme() != "https"
        || configured.scheme() != "https"
        || invitation.port_or_known_default() != Some(443)
        || configured.port_or_known_default() != Some(443)
    {
        return false;
    }
    matches!(
        (configured.host_str(), invitation.host_str()),
        (Some("api.inkbox.ai"), Some("inkbox.ai"))
            | (Some("api.beta.inkbox.ai"), Some("beta.inkbox.ai"))
            | (
                Some("api.development.inkbox.ai"),
                Some("development.inkbox.ai")
            )
    )
}

/// Return the raw token from an A2A invitation link or raw token.
///
/// Links must use HTTPS (HTTP only for localhost/127.0.0.1), the configured
/// site's origin or its corresponding official Inkbox public-site origin,
/// and the public invitation acceptance path. Errors never include the
/// capability value.
pub fn extract_a2a_invitation_token(value: &str) -> Result<String, A2AInvitationParseError> {
    extract_a2a_invitation_token_with_base_url(value, DEFAULT_BASE_URL)
}

/// Return the raw token using an explicit site base URL.
pub fn extract_a2a_invitation_token_with_base_url(
    value: &str,
    base_url: &str,
) -> Result<String, A2AInvitationParseError> {
    if value.is_empty() || value.len() > MAX_INVITATION_INPUT_BYTES {
        return Err(A2AInvitationParseError);
    }
    let candidate = value.trim();
    if valid_token(candidate) {
        return Ok(candidate.to_owned());
    }
    if !candidate.contains("://")
        && !candidate.to_ascii_lowercase().starts_with("http:")
        && !candidate.to_ascii_lowercase().starts_with("https:")
    {
        return Err(A2AInvitationParseError);
    }
    if !candidate.to_ascii_lowercase().starts_with("http://")
        && !candidate.to_ascii_lowercase().starts_with("https://")
    {
        return Err(A2AInvitationParseError);
    }

    let invitation = Url::parse(candidate).map_err(|_| A2AInvitationParseError)?;
    let configured = Url::parse(base_url).map_err(|_| A2AInvitationParseError)?;
    let configured_http_allowed = configured.scheme() != "http"
        || matches!(configured.host_str(), Some("localhost" | "127.0.0.1"));
    if !matches!(invitation.scheme(), "http" | "https")
        || !matches!(configured.scheme(), "http" | "https")
        || !configured_http_allowed
        || !invitation.username().is_empty()
        || invitation.password().is_some()
        || !invitation_origin_allowed(&invitation, &configured)
        || invitation.path() != "/console/a2a/invitations/accept"
        || invitation.query().is_some()
    {
        return Err(A2AInvitationParseError);
    }
    let fragment = invitation.fragment().ok_or(A2AInvitationParseError)?;
    if malformed_percent_encoding(fragment) {
        return Err(A2AInvitationParseError);
    }
    let fields: Vec<_> = form_urlencoded::parse(fragment.as_bytes()).collect();
    if fields.len() != 1 || fields[0].0 != "token" || !valid_token(&fields[0].1) {
        return Err(A2AInvitationParseError);
    }
    Ok(fields[0].1.to_string())
}

fn valid_token(value: &str) -> bool {
    value.len() == 48
        && value.starts_with("a2ai_")
        && value[5..]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Vector {
        base_url: String,
        input: String,
        token: Option<String>,
    }

    #[derive(Deserialize)]
    struct Vectors {
        valid: Vec<Vector>,
        invalid: Vec<Vector>,
    }

    #[test]
    fn accepts_raw_tokens_and_exact_origin_links() {
        assert_eq!(
            extract_a2a_invitation_token("a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")
                .unwrap(),
            "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
        assert_eq!(
            extract_a2a_invitation_token_with_base_url(
                "https://inkbox.ai/console/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
                "https://inkbox.ai/api/v1",
            )
            .unwrap(),
            "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        );
    }

    #[test]
    fn rejects_untrusted_or_ambiguous_links_without_echoing_them() {
        for value in [
            "https://evil.example/console/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "https://inkbox.ai/console/a2a/invitations/accept?token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            "https://inkbox.ai/console/a2a/invitations/accept#token=a&token=b",
            "https://inkbox.ai/console/a2a/invitations/accept#token=%ZZ",
            "https://inkbox.ai/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ] {
            let error = extract_a2a_invitation_token_with_base_url(value, "https://inkbox.ai")
                .unwrap_err();
            assert!(!error
                .to_string()
                .contains("a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
        }
    }

    #[test]
    fn shared_invitation_input_vectors_match() {
        let vectors: Vectors = serde_json::from_str(include_str!(
            "../../../../tests/fixtures/a2a_invitation_inputs.json"
        ))
        .unwrap();
        for item in vectors.valid {
            assert_eq!(
                extract_a2a_invitation_token_with_base_url(&item.input, &item.base_url).unwrap(),
                item.token.unwrap()
            );
        }
        for item in vectors.invalid {
            let error = extract_a2a_invitation_token_with_base_url(&item.input, &item.base_url)
                .unwrap_err();
            assert!(!error
                .to_string()
                .contains("a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
        }
    }

    #[test]
    fn rejects_oversized_input() {
        assert!(extract_a2a_invitation_token(&"x".repeat(2049)).is_err());
    }

    #[test]
    fn invitation_models_tolerate_unknown_status_values() {
        let invitation: A2AInvitation = serde_json::from_value(serde_json::json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "issuer_organization_id": "org_example",
            "inviter_email": "owner@example.com",
            "peer_agent_handles": ["peer-agent"],
            "recipient_email": null,
            "status": "future_invitation_status",
            "email_status": "future_email_status",
            "email_sent_at": null,
            "invitee_identity_id": null,
            "invitee_agent_handle": null,
            "invitee_organization_id": null,
            "expires_at": "2026-08-14T00:00:00Z",
            "accepted_at": null,
            "declined_at": null,
            "revoked_at": null,
            "created_at": "2026-08-07T00:00:00Z",
            "updated_at": "2026-08-07T00:00:00Z"
        }))
        .unwrap();

        assert_eq!(invitation.status, A2AInvitationStatus::Unknown);
        assert_eq!(invitation.email_status, A2AInvitationEmailStatus::Unknown);
    }
}

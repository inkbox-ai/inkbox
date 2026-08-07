//! Parsing helpers for shareable A2A invitation links.

use url::{form_urlencoded, Url};

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

/// Return the raw token from an A2A invitation link or raw token.
///
/// Links must use HTTPS (HTTP only for localhost/127.0.0.1), the configured
/// site's exact origin, and the public invitation acceptance path. Errors
/// never include the capability value.
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
        || invitation.origin() != configured.origin()
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
}

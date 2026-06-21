//! Local handle / tunnel-name validation.
//!
//! Ported from `inkbox/tunnels/_validation.py`. Mirrors the syntactic rules in
//! the canonical server validator. Reserved-name collisions are NOT checked
//! here — the server is authoritative and returns a 409
//! (`HandleUnavailableError`). Handle and tunnel-name share a single global
//! namespace; the same rules apply to both. [`validate_agent_handle`] is an
//! alias for callers who think of the value as an agent handle rather than a
//! tunnel name.
//!
//! `regex` is not a dependency, so the Python regex
//! `^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$` is reproduced with
//! manual char checks ([`matches_tunnel_name_re`]) that have identical
//! semantics: every char is a lowercase letter, digit, or hyphen; the first
//! and last char are a letter or digit; and there are no consecutive hyphens.

use crate::error::Result;
use crate::tunnels::exceptions::TunnelError;

const TUNNEL_NAME_MIN_LENGTH: usize = 3;
const TUNNEL_NAME_MAX_LENGTH: usize = 63;

/// Strip a leading `@` and lowercase the value. Subsequent validation runs
/// against the returned normalized form.
///
/// Mirrors Python's `normalize_agent_handle`. (The Python `isinstance(str)`
/// guard is unrepresentable / unnecessary in Rust — the type is already
/// `&str`.)
///
/// # Arguments
/// * `value` - The raw handle / tunnel name.
///
/// # Returns
/// The normalized value (`@` stripped, lowercased).
pub fn normalize_agent_handle(value: &str) -> String {
    // Strip a single leading '@', then lowercase the whole thing.
    let s = value.strip_prefix('@').unwrap_or(value);
    s.to_lowercase()
}

/// Validate a tunnel name / agent handle; returns an error where Python raises
/// `TunnelNameInvalid` (surfaced as [`crate::error::InkboxError::Tunnel`]).
///
/// Mirrors Python's `validate_tunnel_name`.
///
/// # Arguments
/// * `name` - The raw tunnel name / agent handle.
///
/// # Returns
/// The normalized value (`@` stripped, lowercased) on success.
pub fn validate_tunnel_name(name: &str) -> Result<String> {
    let normalized = normalize_agent_handle(name);

    // Length is measured in characters, matching Python's `len(str)`.
    let len = normalized.chars().count();
    if len < TUNNEL_NAME_MIN_LENGTH {
        return Err(TunnelError::NameInvalid(format!(
            "tunnel_name must be at least {TUNNEL_NAME_MIN_LENGTH} characters"
        ))
        .into());
    }
    if len > TUNNEL_NAME_MAX_LENGTH {
        return Err(TunnelError::NameInvalid(format!(
            "tunnel_name must be at most {TUNNEL_NAME_MAX_LENGTH} characters"
        ))
        .into());
    }
    if !matches_tunnel_name_re(&normalized) {
        return Err(TunnelError::NameInvalid(
            "tunnel_name may only contain lowercase letters, numbers, and \
             hyphens, must start and end with a letter or number, and must \
             not contain consecutive hyphens"
                .to_string(),
        )
        .into());
    }
    Ok(normalized)
}

/// Alias of [`validate_tunnel_name`]. Handle and tunnel-name share a global
/// namespace and the same validator; this lets callers spell their intent.
pub fn validate_agent_handle(name: &str) -> Result<String> {
    validate_tunnel_name(name)
}

/// Manual equivalent of the Python regex
/// `^[a-z0-9](?:[a-z0-9]|-(?!-))*[a-z0-9]$|^[a-z0-9]$`.
///
/// Accepts: a single `[a-z0-9]`, or a string of length >= 2 where the first
/// and last chars are `[a-z0-9]`, every interior char is `[a-z0-9]` or `-`,
/// and no two `-` are adjacent.
fn matches_tunnel_name_re(s: &str) -> bool {
    let chars: Vec<char> = s.chars().collect();
    if chars.is_empty() {
        return false;
    }

    let is_alnum = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit();

    // Single-char case: must be a lowercase letter or digit.
    if chars.len() == 1 {
        return is_alnum(chars[0]);
    }

    // First and last char must be alphanumeric.
    if !is_alnum(chars[0]) || !is_alnum(chars[chars.len() - 1]) {
        return false;
    }

    // Every char must be alphanumeric or a hyphen, with no consecutive hyphens.
    let mut prev_hyphen = false;
    for &c in &chars {
        if c == '-' {
            if prev_hyphen {
                return false; // consecutive hyphens are rejected
            }
            prev_hyphen = true;
        } else if is_alnum(c) {
            prev_hyphen = false;
        } else {
            return false; // any other character is rejected
        }
    }
    true
}

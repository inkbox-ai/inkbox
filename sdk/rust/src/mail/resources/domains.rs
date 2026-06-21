//! Custom sending-domain operations exposed via `client.domains`.
//!
//! Limited to the read-and-default surface: list, set the org default. Domain
//! registration, DNS-record retrieval, verification, DKIM rotation, and
//! deletion stay in the console.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::error::Result;
use crate::http::HttpTransport;
use crate::mail::types::{Domain, SendingDomainStatus};

pub struct DomainsResource {
    http: Arc<HttpTransport>,
}

impl DomainsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List custom sending domains registered to your organisation.
    ///
    /// # Arguments
    /// * `status` - Optional status filter (e.g. only verified).
    ///
    /// # Returns
    /// All domains the caller's org owns, optionally filtered by status.
    pub fn list(&self, status: Option<SendingDomainStatus>) -> Result<Vec<Domain>> {
        // Only attach the `status` param when a filter was supplied.
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(s) = status {
            params.push(("status", s.as_str().to_string()));
        }
        let data = self.http.get("/", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Set the organisation's default sending domain.
    ///
    /// Pass the **bare domain name** (e.g. `"mail.acme.com"`), not the row id.
    /// Pass the platform sending domain for the target environment (e.g.
    /// `"inkboxmail.com"` in production) to clear the org default and revert to
    /// the platform domain.
    ///
    /// Requires an **admin-scoped API key**. Non-admin keys receive 403.
    ///
    /// # Arguments
    /// * `domain_name` - The bare domain name to set as default.
    ///
    /// # Returns
    /// The bare new default domain name, or `None` when the org has reverted to
    /// the platform default. Never a row id.
    pub fn set_default(&self, domain_name: &str) -> Result<Option<String>> {
        // Percent-encode the domain so dots/special chars survive the path.
        let encoded = urlencode(domain_name);
        let path = format!("/{encoded}/set-default");
        let body = json!({});
        let data = self.http.post(&path, Some(&body), crate::http::NO_QUERY)?;
        // Pull `default_domain` out of the response object; treat a JSON null
        // or a missing key as `None`.
        let default_domain = data
            .get("default_domain")
            .and_then(Value::as_str)
            .map(|s| s.to_string());
        Ok(default_domain)
    }
}

/// Percent-encode a path segment, escaping everything that is not an
/// unreserved character (mirrors Python's `quote(domain, safe='')`).
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            // RFC 3986 unreserved set.
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

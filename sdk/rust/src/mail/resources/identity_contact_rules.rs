//! Identity-keyed mail contact rules (per-agent-identity allow/block rules +
//! org-wide list).
//!
//! Mail rules live on the **agent identity**, addressed by `agent_handle`,
//! mirroring the iMessage rule shape. The legacy per-mailbox resource
//! ([`crate::mail::resources::contact_rules::MailContactRulesResource`]) is kept
//! as a deprecated wrapper.
//!
//! Transport note: this resource rides the api-root transport (`{base}/api/v1`)
//! so it can address both the per-identity routes
//! (`/identities/{handle}/mail-contact-rules`) and the org-wide list
//! (`/mail/contact-rules`) with full paths. It must NOT ride the
//! `/mail`-prefixed transport, which would mangle the identity paths.

use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::mail::types::{MailIdentityContactRule, MailRuleAction, MailRuleMatchType};

const ORG_BASE: &str = "/mail/contact-rules";

/// Build the per-identity contact-rule path, optionally addressing one rule.
fn rule_path(agent_handle: &str, rule_id: Option<&str>) -> String {
    let base = format!("/identities/{agent_handle}/mail-contact-rules");
    match rule_id {
        None => base,
        Some(id) => format!("{base}/{id}"),
    }
}

/// Decode a rule list that may be either a bare array or an `{"items": [...]}`
/// envelope (mirrors the Python `data["items"] if ... else data`).
fn parse_rule_list(data: Value) -> Result<Vec<MailIdentityContactRule>> {
    let items = match data {
        Value::Object(mut map) if map.contains_key("items") => {
            map.remove("items").unwrap_or(Value::Array(vec![]))
        }
        other => other,
    };
    Ok(serde_json::from_value(items)?)
}

/// Allow/block mail rules scoped to agent identities.
pub struct MailIdentityContactRulesResource {
    http: Arc<HttpTransport>,
}

impl MailIdentityContactRulesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List the mail contact rules for one agent identity, optionally filtered.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the agent identity owning the rules.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_email` or `domain`.
    /// * `limit` / `offset` - Pagination controls.
    pub fn list(
        &self,
        agent_handle: &str,
        action: Option<MailRuleAction>,
        match_type: Option<MailRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MailIdentityContactRule>> {
        // Push only present params (Python omits None keys).
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(a) = action {
            params.push(("action", a.as_str().to_string()));
        }
        if let Some(m) = match_type {
            params.push(("match_type", m.as_str().to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        if let Some(o) = offset {
            params.push(("offset", o.to_string()));
        }
        let data = self.http.get(&rule_path(agent_handle, None), &params)?;
        parse_rule_list(data)
    }

    /// Get a single contact rule by id.
    pub fn get(&self, agent_handle: &str, rule_id: &str) -> Result<MailIdentityContactRule> {
        let data = self.http.get(
            &rule_path(agent_handle, Some(rule_id)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a rule for an agent identity. Use [`Self::update`] to change its
    /// allow/block action.
    ///
    /// Returns [`crate::error::InkboxError::DuplicateContactRule`] on 409 when a
    /// non-deleted rule with the same `(match_type, match_target)` already exists.
    pub fn create(
        &self,
        agent_handle: &str,
        action: MailRuleAction,
        match_type: MailRuleMatchType,
        match_target: &str,
    ) -> Result<MailIdentityContactRule> {
        let body = json!({
            "action": action.as_str(),
            "match_type": match_type.as_str(),
            "match_target": match_target,
        });
        let data = self.http.post(
            &rule_path(agent_handle, None),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update `action` (admin-only).
    ///
    /// `match_type` and `match_target` are immutable — delete + re-create to
    /// change them.
    pub fn update(
        &self,
        agent_handle: &str,
        rule_id: &str,
        action: MailRuleAction,
    ) -> Result<MailIdentityContactRule> {
        let body = json!({"action": action.as_str()});
        let data = self
            .http
            .patch(&rule_path(agent_handle, Some(rule_id)), &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a rule (admin-only).
    pub fn delete(&self, agent_handle: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&rule_path(agent_handle, Some(rule_id)))
    }

    /// Org-wide list of mail contact rules (admin-only).
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to a single agent identity by id.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_email` or `domain`.
    /// * `limit` / `offset` - Pagination controls.
    pub fn list_all(
        &self,
        agent_identity_id: Option<&Uuid>,
        action: Option<MailRuleAction>,
        match_type: Option<MailRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MailIdentityContactRule>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = agent_identity_id {
            params.push(("agent_identity_id", id.to_string()));
        }
        if let Some(a) = action {
            params.push(("action", a.as_str().to_string()));
        }
        if let Some(m) = match_type {
            params.push(("match_type", m.as_str().to_string()));
        }
        if let Some(l) = limit {
            params.push(("limit", l.to_string()));
        }
        if let Some(o) = offset {
            params.push(("offset", o.to_string()));
        }
        let data = self.http.get(ORG_BASE, &params)?;
        parse_rule_list(data)
    }
}

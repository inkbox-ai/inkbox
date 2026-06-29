//! Identity-keyed phone contact rules (per-agent-identity allow/block rules +
//! org-wide list).
//!
//! Phone (voice + SMS) rules live on the **agent identity**, addressed by
//! `agent_handle`, mirroring the iMessage rule shape. The legacy per-number
//! resource ([`crate::phone::resources::contact_rules::PhoneContactRulesResource`])
//! is kept as a deprecated wrapper.
//!
//! The identity must have a phone number: `create` returns 422 otherwise and
//! the identity helpers guard with a phone-presence check before the request.
//! Listing an identity with no number returns an empty list.
//!
//! Transport note: rides the api-root transport (`{base}/api/v1`) so it
//! addresses both `/identities/{handle}/phone-contact-rules` and the org-wide
//! `/phone/contact-rules` with full paths. It must NOT ride the
//! `/phone`-prefixed transport.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{
    ContactRuleStatus, PhoneIdentityContactRule, PhoneRuleAction, PhoneRuleMatchType,
};

const ORG_BASE: &str = "/phone/contact-rules";

/// Build the per-identity contact-rule path, optionally addressing one rule.
fn rule_path(agent_handle: &str, rule_id: Option<&str>) -> String {
    let base = format!("/identities/{agent_handle}/phone-contact-rules");
    match rule_id {
        None => base,
        Some(id) => format!("{base}/{id}"),
    }
}

/// Unwrap a list response that is either `{"items": [...]}` or a bare array,
/// matching the Python `data["items"] if ... else data` fallback.
fn extract_items(data: Value) -> Result<Vec<PhoneIdentityContactRule>> {
    let items = match data {
        Value::Object(mut map) => match map.remove("items") {
            Some(items) => items,
            None => Value::Object(map),
        },
        other => other,
    };
    Ok(serde_json::from_value(items)?)
}

/// Allow/block phone rules scoped to agent identities (voice + SMS).
pub struct PhoneIdentityContactRulesResource {
    http: Arc<HttpTransport>,
}

impl PhoneIdentityContactRulesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List rules for an identity. Returns an empty list when the identity has
    /// no phone number.
    pub fn list(
        &self,
        agent_handle: &str,
        action: Option<PhoneRuleAction>,
        match_type: Option<PhoneRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<PhoneIdentityContactRule>> {
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
        extract_items(data)
    }

    /// Get a single rule by id.
    pub fn get(&self, agent_handle: &str, rule_id: &str) -> Result<PhoneIdentityContactRule> {
        let data = self.http.get(
            &rule_path(agent_handle, Some(rule_id)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a rule for an agent identity. New rules are always `active`; use
    /// [`Self::update`] to pause one after creation.
    ///
    /// The identity must have a phone number — otherwise the server returns 422.
    ///
    /// Returns [`crate::error::InkboxError::DuplicateContactRule`] on 409 when a
    /// non-deleted rule with the same `(match_type, match_target)` already exists.
    pub fn create(
        &self,
        agent_handle: &str,
        action: PhoneRuleAction,
        match_target: &str,
        match_type: PhoneRuleMatchType,
    ) -> Result<PhoneIdentityContactRule> {
        let mut body = Map::new();
        body.insert("action".into(), action.as_str().into());
        body.insert("match_type".into(), match_type.as_str().into());
        body.insert("match_target".into(), match_target.into());
        let data = self.http.post(
            &rule_path(agent_handle, None),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update `action` or `status` (admin-only). Omitted (`None`) fields are
    /// left unchanged, matching the Python `_UNSET` sentinel.
    pub fn update(
        &self,
        agent_handle: &str,
        rule_id: &str,
        action: Option<PhoneRuleAction>,
        status: Option<ContactRuleStatus>,
    ) -> Result<PhoneIdentityContactRule> {
        let mut body = Map::new();
        if let Some(a) = action {
            body.insert("action".into(), a.as_str().into());
        }
        if let Some(s) = status {
            let s = match s {
                ContactRuleStatus::Active => "active",
                ContactRuleStatus::Paused => "paused",
            };
            body.insert("status".into(), s.into());
        }
        let data = self
            .http
            .patch(&rule_path(agent_handle, Some(rule_id)), &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a rule (admin-only).
    pub fn delete(&self, agent_handle: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&rule_path(agent_handle, Some(rule_id)))
    }

    /// Org-wide list of phone contact rules (admin-only).
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to a single agent identity by id.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_number`.
    /// * `limit` / `offset` - Pagination controls.
    pub fn list_all(
        &self,
        agent_identity_id: Option<&str>,
        action: Option<PhoneRuleAction>,
        match_type: Option<PhoneRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<PhoneIdentityContactRule>> {
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
        extract_items(data)
    }
}

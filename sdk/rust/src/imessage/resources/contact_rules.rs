//! iMessage contact rules (per-identity allow/block rules + org-wide list).
//!
//! Shared iMessage pool numbers are global infrastructure, so the policy
//! owner is the agent identity being reached — rules are addressed by
//! `agent_handle`, not by a phone-number id.

use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::imessage::types::{
    ContactRuleStatus, IMessageContactRule, IMessageRuleAction, IMessageRuleMatchType,
};

const ORG_BASE: &str = "/contact-rules";

/// Build the per-identity contact-rule path, optionally addressing a rule by id.
fn rule_path(agent_handle: &str, rule_id: Option<&str>) -> String {
    let base = format!("/identities/{agent_handle}/contact-rules");
    match rule_id {
        None => base,
        Some(id) => format!("{base}/{id}"),
    }
}

/// Allow/block rules scoped to agent identities for iMessage.
pub struct IMessageContactRulesResource {
    http: Arc<HttpTransport>,
}

impl IMessageContactRulesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List contact rules for one agent identity.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the agent identity owning the rules.
    /// * `action` - Optional filter by `allow` or `block`.
    /// * `match_type` - Optional filter by `exact_number`.
    /// * `limit` - Optional max results.
    /// * `offset` - Optional pagination offset.
    pub fn list(
        &self,
        agent_handle: &str,
        action: Option<IMessageRuleAction>,
        match_type: Option<IMessageRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<IMessageContactRule>> {
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
        Ok(serde_json::from_value(data)?)
    }

    /// Get a single contact rule by id.
    pub fn get(&self, agent_handle: &str, rule_id: &str) -> Result<IMessageContactRule> {
        let data = self.http.get(
            &rule_path(agent_handle, Some(rule_id)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a rule. New rules are always `active`; use [`Self::update`] to
    /// pause one after creation.
    ///
    /// Returns [`crate::error::InkboxError::DuplicateContactRule`] on 409 when a
    /// non-deleted rule with the same `(match_type, match_target)` already exists.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the agent identity owning the rule.
    /// * `action` - Whether to `allow` or `block`.
    /// * `match_target` - The value to match against (e.g. an E.164 number).
    /// * `match_type` - What to match on; defaults to `exact_number`.
    pub fn create(
        &self,
        agent_handle: &str,
        action: IMessageRuleAction,
        match_target: &str,
        match_type: IMessageRuleMatchType,
    ) -> Result<IMessageContactRule> {
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

    /// Update `action` or `status` (admin-only).
    ///
    /// `None` arguments are omitted from the request body, mirroring the
    /// Python `_UNSET` sentinel.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the agent identity owning the rule.
    /// * `rule_id` - Id of the rule to update.
    /// * `action` - Optional new action.
    /// * `status` - Optional new status.
    pub fn update(
        &self,
        agent_handle: &str,
        rule_id: &str,
        action: Option<IMessageRuleAction>,
        status: Option<ContactRuleStatus>,
    ) -> Result<IMessageContactRule> {
        // Build the body inserting only the fields that were supplied.
        let mut map = serde_json::Map::new();
        if let Some(a) = action {
            map.insert("action".to_string(), json!(a.as_str()));
        }
        if let Some(s) = status {
            map.insert("status".to_string(), json!(s.as_str()));
        }
        let body = serde_json::Value::Object(map);
        let data = self
            .http
            .patch(&rule_path(agent_handle, Some(rule_id)), &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a rule (admin-only).
    pub fn delete(&self, agent_handle: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&rule_path(agent_handle, Some(rule_id)))
    }

    /// Org-wide list of iMessage contact rules (admin-only).
    ///
    /// # Arguments
    /// * `agent_identity_id` - Narrow to a single agent identity by id.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_number`.
    /// * `limit` - Optional max results.
    /// * `offset` - Optional pagination offset.
    pub fn list_all(
        &self,
        agent_identity_id: Option<&Uuid>,
        action: Option<IMessageRuleAction>,
        match_type: Option<IMessageRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<IMessageContactRule>> {
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
        Ok(serde_json::from_value(data)?)
    }
}

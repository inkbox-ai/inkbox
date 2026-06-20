//! Mail contact rules (per-mailbox allow/block rules + org-wide list).

use std::sync::Arc;

use serde_json::{json, Value};
use uuid::Uuid;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::mail::types::{ContactRuleStatus, MailContactRule, MailRuleAction, MailRuleMatchType};

const BASE: &str = "/mailboxes";
const ORG_BASE: &str = "/contact-rules";

/// Build the per-mailbox contact-rules path, optionally targeting one rule.
fn rule_path(email_address: &str, rule_id: Option<&str>) -> String {
    let base = format!("{BASE}/{email_address}/contact-rules");
    match rule_id {
        Some(id) => format!("{base}/{id}"),
        None => base,
    }
}

/// Allow/block rules scoped to mail mailboxes.
pub struct MailContactRulesResource {
    http: Arc<HttpTransport>,
}

impl MailContactRulesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List the contact rules on a mailbox, optionally filtered.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_email` or `domain`.
    /// * `limit` / `offset` - Pagination controls.
    pub fn list(
        &self,
        email_address: &str,
        action: Option<MailRuleAction>,
        match_type: Option<MailRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MailContactRule>> {
        // Build the query string, omitting any param the caller left unset.
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
        let data = self.http.get(&rule_path(email_address, None), &params)?;
        parse_rule_list(data)
    }

    /// Get a single contact rule by id.
    pub fn get(&self, email_address: &str, rule_id: &str) -> Result<MailContactRule> {
        let data = self.http.get(
            &rule_path(email_address, Some(rule_id)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a rule. New rules are always `active`; use
    /// [`update`](Self::update) to pause one after creation.
    ///
    /// Returns [`crate::error::InkboxError::DuplicateContactRule`] on 409 when
    /// a non-deleted rule with the same `(match_type, match_target)` already
    /// exists.
    pub fn create(
        &self,
        email_address: &str,
        action: MailRuleAction,
        match_type: MailRuleMatchType,
        match_target: &str,
    ) -> Result<MailContactRule> {
        let body = json!({
            "action": action.as_str(),
            "match_type": match_type.as_str(),
            "match_target": match_target,
        });
        let data = self.http.post(
            &rule_path(email_address, None),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update `action` or `status` (admin-only).
    ///
    /// `match_type` and `match_target` are immutable — delete + re-create to
    /// change them. Pass `None` for a field to leave it untouched (mirrors the
    /// Python `_UNSET` sentinel: omitted keys are never sent).
    pub fn update(
        &self,
        email_address: &str,
        rule_id: &str,
        action: Option<MailRuleAction>,
        status: Option<ContactRuleStatus>,
    ) -> Result<MailContactRule> {
        let mut body = serde_json::Map::new();
        if let Some(a) = action {
            body.insert("action".into(), Value::String(a.as_str().to_string()));
        }
        if let Some(s) = status {
            body.insert("status".into(), Value::String(s.as_str().to_string()));
        }
        let data = self.http.patch(
            &rule_path(email_address, Some(rule_id)),
            &Value::Object(body),
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a rule (admin-only).
    pub fn delete(&self, email_address: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&rule_path(email_address, Some(rule_id)))
    }

    /// Org-wide list of mail contact rules (admin-only).
    ///
    /// # Arguments
    /// * `mailbox_id` - Narrow to a single mailbox by id.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_email` or `domain`.
    /// * `limit` / `offset` - Pagination controls.
    pub fn list_all(
        &self,
        mailbox_id: Option<Uuid>,
        action: Option<MailRuleAction>,
        match_type: Option<MailRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<MailContactRule>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = mailbox_id {
            params.push(("mailbox_id", id.to_string()));
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

/// Decode a rule list that may be either a bare array or an `{"items": [...]}`
/// envelope (mirrors the Python `data["items"] if ... else data`).
fn parse_rule_list(data: Value) -> Result<Vec<MailContactRule>> {
    let items = match data {
        Value::Object(mut map) if map.contains_key("items") => {
            map.remove("items").unwrap_or(Value::Array(vec![]))
        }
        other => other,
    };
    Ok(serde_json::from_value(items)?)
}

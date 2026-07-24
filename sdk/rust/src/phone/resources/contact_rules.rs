//! Phone contact rules (per-number allow/block rules + org-wide list).

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::{PhoneContactRule, PhoneRuleAction, PhoneRuleMatchType};

const BASE: &str = "/numbers";
const ORG_BASE: &str = "/contact-rules";

/// Build the per-number contact-rule path, optionally addressing one rule.
fn rule_path(phone_number_id: &str, rule_id: Option<&str>) -> String {
    let base = format!("{BASE}/{phone_number_id}/contact-rules");
    match rule_id {
        None => base,
        Some(id) => format!("{base}/{id}"),
    }
}

/// Unwrap a list response that is either `{"items": [...]}` or a bare array,
/// matching the Python `data["items"] if ... else data` fallback.
fn extract_items(data: Value) -> Result<Vec<PhoneContactRule>> {
    let items = match data {
        Value::Object(mut map) => match map.remove("items") {
            Some(items) => items,
            None => Value::Object(map),
        },
        other => other,
    };
    Ok(serde_json::from_value(items)?)
}

/// Allow/block rules scoped to phone numbers (voice + SMS).
pub struct PhoneContactRulesResource {
    http: Arc<HttpTransport>,
}

impl PhoneContactRulesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List rules for one phone number.
    pub fn list(
        &self,
        phone_number_id: &str,
        action: Option<PhoneRuleAction>,
        match_type: Option<PhoneRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<PhoneContactRule>> {
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
        let data = self.http.get(&rule_path(phone_number_id, None), &params)?;
        extract_items(data)
    }

    /// Get a single rule by ID.
    pub fn get(&self, phone_number_id: &str, rule_id: &str) -> Result<PhoneContactRule> {
        let data = self.http.get(
            &rule_path(phone_number_id, Some(rule_id)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a rule. Use [`update`](Self::update) to change its allow/block
    /// action.
    ///
    /// Returns [`InkboxError::DuplicateContactRule`](crate::error::InkboxError)
    /// on 409 when a non-deleted rule with the same `(match_type, match_target)`
    /// already exists.
    pub fn create(
        &self,
        phone_number_id: &str,
        action: PhoneRuleAction,
        match_target: &str,
        match_type: PhoneRuleMatchType,
    ) -> Result<PhoneContactRule> {
        let mut body = Map::new();
        body.insert("action".into(), action.as_str().into());
        body.insert("match_type".into(), match_type.as_str().into());
        body.insert("match_target".into(), match_target.into());
        let data = self.http.post(
            &rule_path(phone_number_id, None),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update `action` (admin-only).
    pub fn update(
        &self,
        phone_number_id: &str,
        rule_id: &str,
        action: PhoneRuleAction,
    ) -> Result<PhoneContactRule> {
        let mut body = Map::new();
        body.insert("action".into(), action.as_str().into());
        let data = self
            .http
            .patch(&rule_path(phone_number_id, Some(rule_id)), &body)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a rule (admin-only).
    pub fn delete(&self, phone_number_id: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&rule_path(phone_number_id, Some(rule_id)))
    }

    /// Org-wide list of phone contact rules (admin-only).
    ///
    /// # Arguments
    /// * `phone_number_id` - Narrow to a single phone number by id.
    /// * `action` - Filter by `allow` or `block`.
    /// * `match_type` - Filter by `exact_number`.
    pub fn list_all(
        &self,
        phone_number_id: Option<&str>,
        action: Option<PhoneRuleAction>,
        match_type: Option<PhoneRuleMatchType>,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<Vec<PhoneContactRule>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(id) = phone_number_id {
            params.push(("phone_number_id", id.to_string()));
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

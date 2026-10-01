//! Slack directional policy. Writes require a human JWT or organization-management key.
use crate::contact_rules::{
    ContactRuleCreateOptions, ContactRuleDirection, ContactRuleListOptions,
    ContactRuleUpdateOptions,
};
use crate::http::{HttpTransport, NO_QUERY};
use crate::mail::types::{ContactRuleStatus, FilterMode};
use crate::{InkboxError, Result};
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

/// Allow or block a matched Slack account.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackRuleAction {
    Allow,
    Block,
}
/// ExactUser uses verified home workspace:user; Workspace uses the workspace ID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackRuleMatchType {
    ExactUser,
    Workspace,
}
/// Stable identity-owned rule with directional coverage.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackContactRule {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub action: SlackRuleAction,
    pub match_type: SlackRuleMatchType,
    pub match_target: String,
    pub direction: ContactRuleDirection,
    pub status: ContactRuleStatus,
    pub created_at: String,
    pub updated_at: String,
}
/// Independent inbound and outbound defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackContactRuleSettings {
    pub inbound_filter_mode: FilterMode,
    pub outbound_filter_mode: FilterMode,
}
/// Change only supplied directional defaults; at least one is required.
#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateSlackContactRuleSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outbound_filter_mode: Option<FilterMode>,
}
pub type ListSlackContactRulesOptions = ContactRuleListOptions<SlackRuleAction, SlackRuleMatchType>;
pub type CreateSlackContactRuleOptions =
    ContactRuleCreateOptions<SlackRuleAction, SlackRuleMatchType>;
pub type UpdateSlackContactRuleOptions = ContactRuleUpdateOptions<SlackRuleAction>;

fn path(handle: &str, suffix: Option<&str>) -> String {
    let base = format!(
        "/slack/identities/{}/contact-rules",
        crate::slack::segment(handle.trim_start_matches('@'))
    );
    match suffix {
        Some(value) => format!("{base}/{}", crate::slack::segment(value)),
        None => base,
    }
}
/// Same directional-edit conventions as other channel rules; no automatic pagination.
#[derive(Clone)]
pub struct SlackContactRulesResource {
    http: Arc<HttpTransport>,
}
impl SlackContactRulesResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    /// List one page; a one-direction filter includes both-direction rules.
    pub fn list(
        &self,
        handle: &str,
        options: &ListSlackContactRulesOptions,
    ) -> Result<Vec<SlackContactRule>> {
        Ok(serde_json::from_value(
            self.http.get(&path(handle, None), &options.query()?)?,
        )?)
    }
    pub fn get(&self, handle: &str, rule_id: &str) -> Result<SlackContactRule> {
        Ok(serde_json::from_value(
            self.http.get(&path(handle, Some(rule_id)), NO_QUERY)?,
        )?)
    }
    /// Create/extend coverage using a workspace-qualified person or workspace target.
    pub fn create(
        &self,
        handle: &str,
        options: &CreateSlackContactRuleOptions,
    ) -> Result<SlackContactRule> {
        Ok(serde_json::from_value(self.http.post(
            &path(handle, None),
            Some(options),
            NO_QUERY,
        )?)?)
    }
    pub fn update(
        &self,
        handle: &str,
        rule_id: &str,
        options: &UpdateSlackContactRuleOptions,
    ) -> Result<SlackContactRule> {
        options.validate()?;
        Ok(serde_json::from_value(
            self.http.patch(&path(handle, Some(rule_id)), options)?,
        )?)
    }
    pub fn delete(&self, handle: &str, rule_id: &str) -> Result<()> {
        self.http.delete(&path(handle, Some(rule_id)))?;
        Ok(())
    }
    pub fn get_settings(&self, handle: &str) -> Result<SlackContactRuleSettings> {
        Ok(serde_json::from_value(
            self.http.get(&path(handle, Some("settings")), NO_QUERY)?,
        )?)
    }
    pub fn update_settings(
        &self,
        handle: &str,
        options: &UpdateSlackContactRuleSettings,
    ) -> Result<SlackContactRuleSettings> {
        if options.inbound_filter_mode.is_none() && options.outbound_filter_mode.is_none() {
            return Err(InkboxError::InvalidArgument(
                "Provide at least one directional filter mode".into(),
            ));
        }
        Ok(serde_json::from_value(
            self.http.patch(&path(handle, Some("settings")), options)?,
        )?)
    }
}

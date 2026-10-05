//! Directional Slack contact and workspace rules.
use crate::contact_rules::{
    ContactRuleCreateOptions, ContactRuleDirection, ContactRuleListOptions,
    ContactRuleUpdateOptions,
};
use crate::http::HttpTransport;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackRuleAction {
    Allow,
    Block,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackRuleMatchType {
    ExactUser,
    Workspace,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SlackContactRule {
    pub id: Uuid,
    pub agent_identity_id: Uuid,
    pub action: SlackRuleAction,
    pub match_type: SlackRuleMatchType,
    pub match_target: String,
    pub status: crate::mail::types::ContactRuleStatus,
    #[serde(default)]
    pub direction: ContactRuleDirection,
    #[serde(default)]
    pub contact: Option<crate::contacts::types::Contact>,
    pub created_at: String,
    pub updated_at: String,
}
pub type SlackContactRuleCreateOptions =
    ContactRuleCreateOptions<SlackRuleAction, SlackRuleMatchType>;
pub type SlackContactRuleListOptions = ContactRuleListOptions<SlackRuleAction, SlackRuleMatchType>;
pub type SlackContactRuleUpdateOptions = ContactRuleUpdateOptions<SlackRuleAction>;
#[derive(Clone)]
pub struct SlackContactRulesResource {
    http: Arc<HttpTransport>,
}
fn path(handle: &str, id: Option<Uuid>) -> String {
    let base = format!(
        "/identities/{}/slack-contact-rules",
        crate::slack::segment(handle)
    );
    id.map_or_else(|| base.clone(), |id| format!("{base}/{id}"))
}
impl SlackContactRulesResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    pub fn list(
        &self,
        handle: &str,
        options: &SlackContactRuleListOptions,
    ) -> crate::Result<Vec<SlackContactRule>> {
        crate::contact_rules::parse_list(self.http.get(&path(handle, None), &options.query()?)?)
    }
    pub fn list_all(
        &self,
        identity_id: Option<Uuid>,
        options: &SlackContactRuleListOptions,
    ) -> crate::Result<Vec<SlackContactRule>> {
        let mut query = options.query()?;
        if let Some(id) = identity_id {
            query.push(("agent_identity_id", id.to_string()));
        }
        crate::contact_rules::parse_list(self.http.get("/slack/contact-rules", &query)?)
    }
    pub fn get(&self, handle: &str, id: Uuid) -> crate::Result<SlackContactRule> {
        Ok(serde_json::from_value(
            self.http
                .get(&path(handle, Some(id)), crate::http::NO_QUERY)?,
        )?)
    }
    pub fn create(
        &self,
        handle: &str,
        options: &SlackContactRuleCreateOptions,
    ) -> crate::Result<SlackContactRule> {
        Ok(serde_json::from_value(self.http.post(
            &path(handle, None),
            Some(options),
            crate::http::NO_QUERY,
        )?)?)
    }
    pub fn update(
        &self,
        handle: &str,
        id: Uuid,
        options: &SlackContactRuleUpdateOptions,
    ) -> crate::Result<SlackContactRule> {
        options.validate()?;
        Ok(serde_json::from_value(
            self.http.patch(&path(handle, Some(id)), options)?,
        )?)
    }
    pub fn delete(&self, handle: &str, id: Uuid) -> crate::Result<()> {
        self.http.delete(&path(handle, Some(id)))
    }
}

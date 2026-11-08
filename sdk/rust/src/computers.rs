//! Read-only computer observations. Requests never start a computer.
use crate::{
    error::Result,
    http::{HttpTransport, NO_QUERY},
    organization_domains::path_segment,
};
use serde::Deserialize;
use std::{collections::BTreeMap, sync::Arc};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ComputerHarness {
    Codex,
    Hermes,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ComputerSoftware {
    pub harness_version: Option<String>,
    pub harness_release: Option<String>,
    pub os: Option<String>,
    pub os_version: Option<String>,
    pub model_gateway: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ComputerTemplate {
    pub id: String,
    pub total_disk_bytes: u64,
    pub requested_free_bytes: u64,
    pub harness: Option<ComputerHarness>,
    pub software: ComputerSoftware,
    pub capabilities: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct HostedTemplateDefaults {
    pub codex: Option<ComputerTemplate>,
    pub hermes: Option<ComputerTemplate>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ComputerTemplates {
    pub items: Vec<ComputerTemplate>,
    pub hosted_defaults: HostedTemplateDefaults,
}

#[derive(Clone, Debug, Deserialize)]
pub struct MetricSummary {
    pub unit: String,
    pub average: Option<f64>,
    pub maximum: Option<f64>,
    pub samples: u64,
    pub last_sample_at: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct UsagePoint {
    pub at: String,
    pub values: BTreeMap<String, MetricSummary>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct UsageHistory {
    pub machine_id: String,
    pub source: String,
    pub from: String,
    pub to: String,
    pub resolution_seconds: u32,
    pub sample_interval_seconds: u32,
    pub missing_intervals: String,
    pub items: Vec<UsagePoint>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct Conversation {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ConversationList {
    pub machine_id: String,
    pub status: String,
    pub conversations: Vec<Conversation>,
    pub truncated: Option<bool>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ConversationMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub truncated: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ConversationHistory {
    pub machine_id: String,
    pub status: String,
    pub session_id: Option<String>,
    #[serde(default)]
    pub messages: Vec<ConversationMessage>,
    pub next_before: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct SessionRun {
    pub id: String,
    pub state: String,
    pub terminal: bool,
    pub created_at: String,
}

pub struct ComputersResource {
    http: Arc<HttpTransport>,
}
impl ComputersResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }
    /// Read current hosted defaults without reserving capacity.
    pub fn templates(&self) -> Result<ComputerTemplates> {
        Ok(serde_json::from_value(
            self.http.get("/computers/templates", NO_QUERY)?,
        )?)
    }
    pub fn usage_history(&self, machine: &str, window: &str) -> Result<UsageHistory> {
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "/computers/machines/{}/usage/history",
                path_segment(machine)
            ),
            &[("window", window.to_owned())],
        )?)?)
    }
    pub fn conversations(&self, machine: &str) -> Result<ConversationList> {
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "/computers/machines/{}/conversations",
                path_segment(machine)
            ),
            NO_QUERY,
        )?)?)
    }
    pub fn conversation(
        &self,
        machine: &str,
        session: &str,
        before: Option<&str>,
    ) -> Result<ConversationHistory> {
        let mut query = vec![("session_id", session.to_owned())];
        if let Some(value) = before {
            query.push(("before", value.to_owned()));
        }
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "/computers/machines/{}/conversations",
                path_segment(machine)
            ),
            &query,
        )?)?)
    }
    pub fn session_runs(&self, session: &str) -> Result<Vec<SessionRun>> {
        #[derive(Deserialize)]
        struct Page {
            items: Vec<SessionRun>,
        }
        let page: Page = serde_json::from_value(self.http.get(
            &format!("/computers/sessions/{}/runs", path_segment(session)),
            NO_QUERY,
        )?)?;
        Ok(page.items)
    }
}

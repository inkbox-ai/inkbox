//! Computer observations, admission and model keys. Requests never start a computer.
use crate::{
    error::Result,
    http::{validate_idempotency_key, HttpTransport, NO_QUERY},
    organization_domains::path_segment,
};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, sync::Arc};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ComputerHarness {
    Codex,
    Hermes,
    #[serde(rename = "claude_code")]
    ClaudeCode,
    Opencode,
    Deepseek,
    Openclaw,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ModelProvider {
    Openai,
    Anthropic,
    Deepseek,
}
#[derive(Clone, Debug, Deserialize)]
pub struct HostingProviderCapability {
    pub id: ModelProvider,
    pub models: Vec<String>,
    pub funding: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct HostingCapability {
    pub harness: ComputerHarness,
    pub available: bool,
    pub shape_ids: Vec<String>,
    pub providers: Vec<HostingProviderCapability>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct HostingCapabilities {
    pub version: u32,
    pub items: Vec<HostingCapability>,
}
#[derive(Clone, Debug, Serialize)]
pub struct HostingAdmission {
    pub harness: ComputerHarness,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential_binding_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ModelKey {
    pub id: String,
    pub name: String,
    pub provider: ModelProvider,
    pub display_suffix: Option<String>,
    pub version: u64,
    pub revoked: bool,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}
#[derive(Serialize)]
pub struct ModelKeyInput {
    pub provider: ModelProvider,
    pub name: String,
    pub api_key: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ModelKeyChange {
    pub id: String,
    pub version: u64,
    pub revoked: bool,
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
    pub claude_code: Option<ComputerTemplate>,
    pub opencode: Option<ComputerTemplate>,
    pub deepseek: Option<ComputerTemplate>,
    pub openclaw: Option<ComputerTemplate>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ComputerTemplates {
    pub items: Vec<ComputerTemplate>,
    pub hosted_defaults: HostedTemplateDefaults,
}

#[derive(Clone, Debug, Deserialize)]
pub struct ComputerShape {
    pub id: String,
    pub vcpus: u32,
    pub memory_mib: u64,
    pub architecture: String,
    pub available: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ComputerShapes {
    pub version: u32,
    pub items: Vec<ComputerShape>,
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
    /// Read supported allocations without reserving capacity.
    pub fn shapes(&self) -> Result<ComputerShapes> {
        Ok(serde_json::from_value(
            self.http.get("/computers/shapes", NO_QUERY)?,
        )?)
    }
    pub fn hosting_capabilities(&self) -> Result<HostingCapabilities> {
        Ok(serde_json::from_value(
            self.http.get("/computers/hosting/capabilities", NO_QUERY)?,
        )?)
    }
    /// Check the selected configuration without reserving capacity.
    pub fn hosting_admission(&self, input: &HostingAdmission) -> Result<bool> {
        #[derive(Deserialize)]
        struct Response {
            allowed: bool,
        }
        let response: Response = serde_json::from_value(self.http.post(
            "/computers/hosting/admission",
            Some(input),
            NO_QUERY,
        )?)?;
        Ok(response.allowed)
    }
    pub fn model_keys(&self) -> Result<Vec<ModelKey>> {
        #[derive(Deserialize)]
        struct Response {
            items: Vec<ModelKey>,
        }
        let response: Response =
            serde_json::from_value(self.http.get("/computers/secret-bindings", NO_QUERY)?)?;
        Ok(response.items)
    }
    pub fn create_model_key(
        &self,
        input: &ModelKeyInput,
        idempotency_key: &str,
    ) -> Result<ModelKey> {
        validate_idempotency_key(idempotency_key)?;
        Ok(serde_json::from_value(self.http.post_with_headers(
            "/computers/secret-bindings",
            Some(input),
            NO_QUERY,
            &[("Idempotency-Key", idempotency_key)],
        )?)?)
    }
    pub fn rotate_model_key(
        &self,
        id: &str,
        input: &ModelKeyInput,
        expected_version: u64,
    ) -> Result<ModelKeyChange> {
        let mut body = serde_json::to_value(input)?;
        body["expected_version"] = expected_version.into();
        Ok(serde_json::from_value(self.http.put(
            &format!("/computers/secret-bindings/{}", path_segment(id)),
            &body,
        )?)?)
    }
    pub fn revoke_model_key(&self, id: &str) -> Result<ModelKeyChange> {
        Ok(serde_json::from_value(self.http.delete_with_response(
            &format!("/computers/secret-bindings/{}", path_segment(id)),
        )?)?)
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

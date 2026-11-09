//! Hosted-agent configuration. Removal preserves the identity and its channels.
use super::types::Unset;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct HostingConfiguration {
    pub mode: String,
    pub identity_id: String,
    pub machine_id: Option<String>,
    pub harness: Option<String>,
    pub tier: Option<String>,
    pub state: String,
    pub generation: u64,
    pub applied_generation: u64,
    pub instructions: String,
    pub trigger_events: Vec<String>,
    pub follow_defaults: bool,
    pub credential_binding_id: Option<String>,
    pub idle_timeout_seconds: u32,
    #[serde(default = "default_idle_stop")]
    pub idle_stop_enabled: bool,
    pub last_error: Option<String>,
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct HostingUpdate {
    pub expected_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trigger_events: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub follow_defaults: Option<bool>,
    #[serde(
        skip_serializing_if = "Unset::is_omit",
        serialize_with = "serialize_binding"
    )]
    pub credential_binding_id: Unset<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Accepted values: 300, 600, or 1800 seconds. New agents default to 600.
    pub idle_timeout_seconds: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Automatic idle shutdown is required; the API accepts only `Some(true)` or omission.
    pub idle_stop_enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reset_instructions: Option<bool>,
}

fn serialize_binding<S: serde::Serializer>(
    value: &Unset<String>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match value {
        Unset::Omit | Unset::Value(None) => serializer.serialize_none(),
        Unset::Value(Some(value)) => serializer.serialize_str(value),
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct HostingDelivery {
    pub id: String,
    pub event: String,
    pub state: String,
    pub attempts: u32,
    pub received_at: String,
    pub last_error: Option<String>,
    pub retryable: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct HostingDeliveries {
    pub items: Vec<HostingDelivery>,
}

fn default_idle_stop() -> bool {
    true
}

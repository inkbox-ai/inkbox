//! Hosted-agent configuration. Removal preserves the identity and its channels.
use super::types::Unset;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize)]
pub struct HostingConfiguration {
    pub mode: String,
    pub identity_id: String,
    pub machine_id: Option<String>,
    pub harness: Option<String>,
    #[serde(default = "default_model")]
    pub default_model: String,
    pub tier: Option<String>,
    pub shape_id: Option<String>,
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

/// Generation-checked partial command. Omitted settings are preserved;
/// enabled defaults to activate/retry, false removes hosting. Only the credential
/// binding accepts explicit null. Empty events disable triggers; the reset
/// shortcuts restore event/instruction defaults.
#[derive(Clone, Debug, Default, Serialize)]
pub struct HostingUpdate {
    pub expected_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub harness: Option<String>,
    /// Default model for turns and scheduled work without a per-turn override.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    /// Legacy `medium` allocation: 1 vCPU and 4 GiB RAM.
    pub tier: Option<String>,
    /// Initial allocation; resize existing computers through the workspace.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape_id: Option<String>,
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
    /// Accepted values: 60 or 300 seconds. New agents default to 60.
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

fn default_model() -> String {
    "gpt-6.1-terra".into()
}

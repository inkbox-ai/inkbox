use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ACaller {
    pub identity_id: Uuid,
    pub organization_id: String,
    pub handle: Option<String>,
    pub trust_tier: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATarget {
    pub identity_id: Uuid,
    pub organization_id: String,
    pub handle: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AMessage {
    pub id: Uuid,
    pub message_id: String,
    pub role: String,
    pub parts: Vec<Value>,
    pub metadata: Option<Value>,
    #[serde(default)]
    pub extensions: Option<Vec<String>>,
    #[serde(default)]
    pub reference_task_ids: Option<Vec<String>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATransition {
    pub id: Uuid,
    pub from_state: Option<String>,
    pub to_state: String,
    pub actor: String,
    pub reason: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATask {
    pub id: Uuid,
    pub context_id: Uuid,
    pub state: String,
    pub caller: A2ACaller,
    #[serde(default)]
    pub target: Option<A2ATarget>,
    #[serde(default)]
    pub messages: Vec<A2AMessage>,
    #[serde(default)]
    pub transitions: Vec<A2ATransition>,
    #[serde(default)]
    pub history_truncated: bool,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2ATaskPage {
    pub items: Vec<A2ATask>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AContext {
    pub id: Uuid,
    pub caller: A2ACaller,
    #[serde(default)]
    pub target: Option<A2ATarget>,
    #[serde(default)]
    pub tasks: Vec<A2ATask>,
    #[serde(default)]
    pub tasks_truncated: bool,
    pub created_at: String,
    pub last_activity_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AContextPage {
    pub items: Vec<A2AContext>,
    pub next_cursor: Option<String>,
}

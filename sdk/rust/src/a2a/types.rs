use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum A2AHistoryDirection {
    Inbound,
    Outbound,
    Both,
}

impl A2AHistoryDirection {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Inbound => "inbound",
            Self::Outbound => "outbound",
            Self::Both => "both",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum A2AMessageRole {
    Caller,
    Agent,
}

impl A2AMessageRole {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Caller => "caller",
            Self::Agent => "agent",
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct A2ATaskListOptions {
    pub direction: Option<A2AHistoryDirection>,
    pub requester_handle: Option<String>,
    pub worker_handle: Option<String>,
    pub state: Option<String>,
    pub context_id: Option<Uuid>,
    pub q: Option<String>,
    pub since: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct A2ASentTaskListOptions {
    pub requester_handle: Option<String>,
    pub worker_handle: Option<String>,
    pub state: Option<String>,
    pub context_id: Option<Uuid>,
    pub q: Option<String>,
    pub since: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct A2AMessageListOptions {
    pub direction: Option<A2AHistoryDirection>,
    pub requester_handle: Option<String>,
    pub worker_handle: Option<String>,
    pub task_id: Option<Uuid>,
    pub context_id: Option<Uuid>,
    pub role: Option<A2AMessageRole>,
    pub q: Option<String>,
    pub since: Option<String>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct A2AContextListOptions {
    pub direction: Option<A2AHistoryDirection>,
    pub cursor: Option<String>,
    pub limit: Option<u32>,
}

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
pub struct A2AHistoryMessage {
    pub id: Uuid,
    pub message_id: String,
    pub task_id: Uuid,
    pub context_id: Uuid,
    pub task_state: String,
    pub caller: A2ACaller,
    pub target: A2ATarget,
    pub role: A2AMessageRole,
    pub parts: Vec<Value>,
    pub metadata: Option<Value>,
    #[serde(default)]
    pub extensions: Option<Vec<String>>,
    #[serde(default)]
    pub reference_task_ids: Option<Vec<String>>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct A2AHistoryMessagePage {
    pub items: Vec<A2AHistoryMessage>,
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

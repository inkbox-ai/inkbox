//! Identity-scoped chat and workspace controls. Reads never start compute.
use crate::{
    error::Result,
    http::{validate_idempotency_key, HttpTransport},
    organization_domains::path_segment,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChatPermissionMode {
    #[default]
    Ask,
    Yolo,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatCapabilities {
    #[serde(default)]
    pub permission_mode_selection: bool,
    #[serde(default)]
    pub model_selection: bool,
    pub send_message: bool,
    pub cancel_turn: bool,
    pub approvals: bool,
    pub questions: bool,
    pub attachments: bool,
    pub tool_activity: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatConversation {
    #[serde(default)]
    pub permission_mode: ChatPermissionMode,
    pub created_at: Option<String>,
    pub last_active_at: Option<String>,
    pub id: String,
    pub identity_id: Option<String>,
    pub title: String,
    pub origin: String,
    pub capabilities: ChatCapabilities,
    pub history_completeness: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatTurn {
    pub id: String,
    pub conversation_id: String,
    pub status: String,
    pub terminal: bool,
    pub blocker: Option<Value>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatEvent {
    pub schema_version: u32,
    pub id: String,
    pub sequence: u64,
    pub conversation_id: String,
    pub turn_id: Option<String>,
    pub created_at: String,
    pub r#type: String,
    pub data: Value,
    pub cursor: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatEventPage {
    pub items: Vec<ChatEvent>,
    pub next_cursor: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ChatContent {
    Text { text: String },
    File { file_id: String },
}
#[derive(Clone, Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ChatAnswer {
    Approval {
        decision: String,
    },
    Question {
        answers: std::collections::BTreeMap<String, Value>,
    },
}
#[derive(Clone, Debug)]
pub struct HostedWorkspace {
    http: Arc<HttpTransport>,
    base: String,
}
impl HostedWorkspace {
    pub(crate) fn new(http: Arc<HttpTransport>, handle: &str) -> Self {
        Self {
            http,
            base: format!("/{}/hosting", path_segment(handle)),
        }
    }
    fn command(&self, method: &str, path: &str, body: &Value, key: Option<&str>) -> Result<Value> {
        let headers = if let Some(key) = key {
            validate_idempotency_key(key)?;
            vec![("Idempotency-Key", key)]
        } else {
            vec![]
        };
        self.http.command_json(method, path, body, &headers)
    }
    pub fn stream_events(
        &self,
        conversation: &str,
        after: Option<&str>,
    ) -> Result<ChatEventStream> {
        Ok(ChatEventStream {
            reader: std::io::BufReader::new(self.http.event_stream(
                &format!(
                    "{}/chat/conversations/{}/events",
                    self.base,
                    path_segment(conversation)
                ),
                after,
            )?),
            done: false,
        })
    }
    pub fn status(&self) -> Result<Value> {
        let query = Vec::new();
        self.http.get(&format!("{}/workspace", self.base), &query)
    }
    pub fn conversations(&self, after: Option<&str>, limit: u32) -> Result<Value> {
        let mut query = Vec::new();
        if let Some(value) = after {
            query.push(("after", value.to_owned()));
        }
        query.push(("limit", limit.to_string()));
        self.http
            .get(&format!("{}/chat/conversations", self.base), &query)
    }
    pub fn create_conversation(&self, title: &str, key: &str) -> Result<ChatConversation> {
        Ok(serde_json::from_value(self.command(
            "POST",
            &format!("{}/chat/conversations", self.base),
            &json!({"title":title}),
            Some(key),
        )?)?)
    }
    pub fn rename_conversation(
        &self,
        conversation: &str,
        title: &str,
        key: &str,
    ) -> Result<ChatConversation> {
        Ok(serde_json::from_value(self.command(
            "PATCH",
            &format!(
                "{}/chat/conversations/{}",
                self.base,
                path_segment(conversation)
            ),
            &json!({"title":title}),
            Some(key),
        )?)?)
    }
    pub fn set_permission_mode(
        &self,
        conversation: &str,
        mode: ChatPermissionMode,
        key: &str,
    ) -> Result<ChatConversation> {
        Ok(serde_json::from_value(self.command(
            "PATCH",
            &format!(
                "{}/chat/conversations/{}",
                self.base,
                path_segment(conversation)
            ),
            &json!({"permission_mode":mode}),
            Some(key),
        )?)?)
    }
    pub fn snapshot(&self, conversation: &str) -> Result<Value> {
        let query = Vec::new();
        self.http.get(
            &format!(
                "{}/chat/conversations/{}",
                self.base,
                path_segment(conversation)
            ),
            &query,
        )
    }
    pub fn messages(
        &self,
        conversation: &str,
        after: Option<&str>,
        snapshot: Option<&str>,
        limit: u32,
    ) -> Result<Value> {
        let mut query = Vec::new();
        if let Some(value) = after {
            query.push(("after", value.to_owned()));
        }
        if let Some(value) = snapshot {
            query.push(("snapshot", value.to_owned()));
        }
        query.push(("limit", limit.to_string()));
        self.http.get(
            &format!(
                "{}/chat/conversations/{}/messages",
                self.base,
                path_segment(conversation)
            ),
            &query,
        )
    }
    pub fn events(
        &self,
        conversation: &str,
        after: Option<&str>,
        limit: u32,
    ) -> Result<ChatEventPage> {
        let mut query = Vec::new();
        if let Some(value) = after {
            query.push(("after", value.to_owned()));
        }
        query.push(("limit", limit.to_string()));
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "{}/chat/conversations/{}/events",
                self.base,
                path_segment(conversation)
            ),
            &query,
        )?)?)
    }
    pub fn send(&self, conversation: &str, content: &[ChatContent], key: &str) -> Result<ChatTurn> {
        self.send_with_model(conversation, content, key, None)
    }
    pub fn send_with_model(
        &self,
        conversation: &str,
        content: &[ChatContent],
        key: &str,
        model: Option<&str>,
    ) -> Result<ChatTurn> {
        let mut body = json!({"content":content});
        if let Some(model) = model {
            body["model"] = json!(model);
        }
        Ok(serde_json::from_value(self.command(
            "POST",
            &format!(
                "{}/chat/conversations/{}/turns",
                self.base,
                path_segment(conversation)
            ),
            &body,
            Some(key),
        )?)?)
    }
    pub fn turn(&self, conversation: &str, turn: &str) -> Result<ChatTurn> {
        let query = Vec::new();
        Ok(serde_json::from_value(self.http.get(
            &format!(
                "{}/chat/conversations/{}/turns/{}",
                self.base,
                path_segment(conversation),
                path_segment(turn)
            ),
            &query,
        )?)?)
    }
    pub fn cancel(&self, conversation: &str, turn: &str, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!(
                "{}/chat/conversations/{}/turns/{}/cancel",
                self.base,
                path_segment(conversation),
                path_segment(turn)
            ),
            &json!({}),
            Some(key),
        )
    }
    pub fn respond(
        &self,
        conversation: &str,
        interaction: &str,
        expected_version: u64,
        response: &ChatAnswer,
        key: &str,
    ) -> Result<Value> {
        self.command(
            "POST",
            &format!(
                "{}/chat/conversations/{}/interactions/{}/response",
                self.base,
                path_segment(conversation),
                path_segment(interaction)
            ),
            &json!({"expected_version":expected_version,"response":response}),
            Some(key),
        )
    }
    pub fn upload_file(
        &self,
        name: &str,
        data_base64: &str,
        key: &str,
        media_type: &str,
    ) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/chat/files", self.base),
            &json!({"name":name,"data_base64":data_base64,"media_type":media_type}),
            Some(key),
        )
    }
    pub fn file(&self, file: &str) -> Result<Value> {
        let query = Vec::new();
        self.http.get(
            &format!("{}/chat/files/{}", self.base, path_segment(file)),
            &query,
        )
    }
    pub fn download_file(&self, file: &str) -> Result<Value> {
        let query = Vec::new();
        self.http.get(
            &format!("{}/chat/files/{}/content", self.base, path_segment(file)),
            &query,
        )
    }
    pub fn start(&self, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/workspace/actions/start", self.base),
            &json!({}),
            Some(key),
        )
    }
    pub fn stop(&self, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/workspace/actions/stop", self.base),
            &json!({}),
            Some(key),
        )
    }
    pub fn operation(&self, operation: &str) -> Result<Value> {
        let query = Vec::new();
        self.http.get(
            &format!(
                "{}/workspace/operations/{}",
                self.base,
                path_segment(operation)
            ),
            &query,
        )
    }
    pub fn environment(&self) -> Result<Value> {
        let query = Vec::new();
        self.http
            .get(&format!("{}/workspace/environment", self.base), &query)
    }
    pub fn update_environment(&self, options: &Value) -> Result<Value> {
        self.command(
            "PUT",
            &format!("{}/workspace/environment", self.base),
            &options.clone(),
            None,
        )
    }
    pub fn usage(&self) -> Result<Value> {
        let query = Vec::new();
        self.http
            .get(&format!("{}/workspace/usage", self.base), &query)
    }
    pub fn usage_history(&self, window: &str) -> Result<Value> {
        let mut query = Vec::new();
        query.push(("window", window.to_string()));
        self.http
            .get(&format!("{}/workspace/usage/history", self.base), &query)
    }
    pub fn terminals(&self, after: Option<&str>, limit: u32) -> Result<Value> {
        let mut query = Vec::new();
        if let Some(value) = after {
            query.push(("after", value.to_owned()));
        }
        query.push(("limit", limit.to_string()));
        self.http
            .get(&format!("{}/workspace/terminals", self.base), &query)
    }
    pub fn create_terminal(&self, options: &Value, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/workspace/terminals", self.base),
            &options.clone(),
            Some(key),
        )
    }
    pub fn terminal_ticket(&self, terminal: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!(
                "{}/workspace/terminals/{}/ticket",
                self.base,
                path_segment(terminal)
            ),
            &json!({}),
            None,
        )
    }
    pub fn close_terminal(&self, terminal: &str, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!(
                "{}/workspace/terminals/{}/close",
                self.base,
                path_segment(terminal)
            ),
            &json!({}),
            Some(key),
        )
    }
    pub fn schedules(&self, after: Option<&str>, limit: u32) -> Result<Value> {
        let mut query = Vec::new();
        if let Some(value) = after {
            query.push(("after", value.to_owned()));
        }
        query.push(("limit", limit.to_string()));
        self.http
            .get(&format!("{}/workspace/schedules", self.base), &query)
    }
    pub fn create_schedule(&self, fields: &Value, key: &str) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/workspace/schedules", self.base),
            &json!({"expected_revision":0,"fields":fields}),
            Some(key),
        )
    }
    pub fn update_schedule(
        &self,
        schedule: &str,
        expected_revision: u64,
        fields: &Value,
        key: &str,
    ) -> Result<Value> {
        self.command(
            "PUT",
            &format!(
                "{}/workspace/schedules/{}",
                self.base,
                path_segment(schedule)
            ),
            &json!({"expected_revision":expected_revision,"fields":fields}),
            Some(key),
        )
    }
    pub fn delete_schedule(
        &self,
        schedule: &str,
        expected_revision: u64,
        key: &str,
    ) -> Result<Value> {
        self.command(
            "DELETE",
            &format!(
                "{}/workspace/schedules/{}",
                self.base,
                path_segment(schedule)
            ),
            &json!({"expected_revision":expected_revision,"fields":{}}),
            Some(key),
        )
    }
    pub fn preview_schedule(&self, timing: &Value) -> Result<Value> {
        self.command(
            "POST",
            &format!("{}/workspace/schedules/preview", self.base),
            &json!({"timing":timing}),
            None,
        )
    }
    pub fn schedule_history(&self, schedule: &str) -> Result<Value> {
        let query = Vec::new();
        self.http.get(
            &format!(
                "{}/workspace/schedules/{}/occurrences",
                self.base,
                path_segment(schedule)
            ),
            &query,
        )
    }
}

#[derive(Clone, Debug, Deserialize)]
pub struct ChatMessage {
    pub phase: Option<String>,
    pub id: String,
    pub role: String,
    #[serde(default)]
    pub content: Vec<Value>,
    #[serde(default)]
    pub completed: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatTool {
    pub id: String,
    pub title: String,
    pub status: String,
    pub detail: Option<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatQuestionField {
    pub id: String,
    pub label: String,
    pub required: bool,
    pub r#type: String,
    #[serde(default)]
    pub choices: Vec<ChatChoice>,
    #[serde(default)]
    pub allow_free_text: bool,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatChoice {
    pub id: String,
    pub label: String,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatInteraction {
    pub decision: Option<String>,
    pub id: String,
    pub kind: String,
    pub version: u64,
    pub status: String,
    pub expires_at: String,
    pub title: String,
    pub detail: Option<String>,
    pub effective_scope: Option<String>,
    pub decisions: Option<Vec<String>>,
    pub fields: Option<Vec<ChatQuestionField>>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatTurnUpdate {
    pub id: String,
    pub status: String,
    pub terminal: bool,
    pub blocker: Option<Value>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct ChatArtifact {
    pub id: String,
    pub file_id: String,
    pub name: String,
    pub media_type: String,
    pub size_bytes: u64,
    pub availability: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", content = "data")]
pub enum ChatPayload {
    #[serde(rename = "message.created", alias = "message.completed")]
    Message(ChatMessage),
    #[serde(rename = "message.delta")]
    Delta { id: String, text: String },
    #[serde(rename = "turn.updated")]
    Turn(ChatTurnUpdate),
    #[serde(
        rename = "tool.started",
        alias = "tool.updated",
        alias = "tool.completed"
    )]
    Tool(ChatTool),
    #[serde(rename = "interaction.created", alias = "interaction.updated")]
    Interaction(ChatInteraction),
    #[serde(rename = "artifact.created")]
    Artifact(ChatArtifact),
}
impl ChatEvent {
    pub fn payload(&self) -> Result<ChatPayload> {
        Ok(serde_json::from_value(
            json!({"type":self.r#type,"data":self.data}),
        )?)
    }
}

/// Dropping the iterator closes the stream. Resume explicitly with the last event cursor.
pub struct ChatEventStream {
    reader: std::io::BufReader<reqwest::blocking::Response>,
    done: bool,
}
impl Iterator for ChatEventStream {
    type Item = Result<ChatEvent>;
    fn next(&mut self) -> Option<Self::Item> {
        use std::io::{BufRead, Read};
        if self.done {
            return None;
        }
        let mut data = Vec::new();
        let mut event_type = Vec::new();
        loop {
            let mut line = Vec::new();
            match self
                .reader
                .by_ref()
                .take(1048577)
                .read_until(b'\n', &mut line)
            {
                Ok(0) => {
                    self.done = true;
                    return None;
                }
                Err(_) => {
                    self.done = true;
                    return Some(Err(crate::InkboxError::InvalidArgument(
                        "Event stream disconnected".into(),
                    )));
                }
                _ => {}
            }
            if line.len() + data.len() > 1048576 {
                self.done = true;
                return Some(Err(crate::InkboxError::InvalidArgument(
                    "Event frame exceeds limit".into(),
                )));
            }
            while matches!(line.last(), Some(b'\n' | b'\r')) {
                line.pop();
            }
            if line.is_empty() {
                if !data.is_empty() {
                    if event_type == b"stream.reset" {
                        self.done = true;
                        return Some(
                            serde_json::from_slice::<Value>(&data)
                                .map_err(Into::into)
                                .and_then(|payload| {
                                    Err(crate::InkboxError::Api {
                                        status_code: payload["status"]
                                            .as_u64()
                                            .and_then(|v| u16::try_from(v).ok())
                                            .unwrap_or(410),
                                        detail: crate::error::ApiErrorDetail::Structured(payload),
                                        agent_support: None,
                                    })
                                }),
                        );
                    }
                    return Some(serde_json::from_slice(&data).map_err(Into::into));
                }
                event_type.clear();
            } else if let Some(part) = line.strip_prefix(b"event:") {
                event_type = part.strip_prefix(b" ").unwrap_or(part).to_vec();
            } else if let Some(part) = line.strip_prefix(b"data:") {
                if !data.is_empty() {
                    data.push(b'\n');
                }
                data.extend_from_slice(part.strip_prefix(b" ").unwrap_or(part));
            }
        }
    }
}

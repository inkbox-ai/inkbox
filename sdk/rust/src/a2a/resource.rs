use std::sync::Arc;

use uuid::Uuid;

use crate::a2a::types::{
    A2AContext, A2AContextListOptions, A2AContextPage, A2AHistoryDirection, A2AHistoryMessagePage,
    A2AMessageListOptions, A2ASentTaskListOptions, A2ATask, A2ATaskListOptions, A2ATaskPage,
};
use crate::error::Result;
use crate::http::{HttpTransport, NO_QUERY};

pub struct A2AResource {
    http: Arc<HttpTransport>,
}

impl A2AResource {
    pub(crate) fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    fn base(agent_handle: &str) -> String {
        format!("/identities/{agent_handle}/a2a")
    }

    pub fn tasks(&self, agent_handle: &str, options: &A2ATaskListOptions) -> Result<A2ATaskPage> {
        let mut params = Vec::new();
        if let Some(value) = options.direction {
            params.push(("direction", value.as_str().to_string()));
        }
        if let Some(value) = &options.requester_handle {
            params.push(("requester_handle", value.clone()));
        }
        if let Some(value) = &options.worker_handle {
            params.push(("worker_handle", value.clone()));
        }
        if let Some(value) = &options.state {
            params.push(("state", value.clone()));
        }
        if let Some(value) = options.context_id {
            params.push(("context_id", value.to_string()));
        }
        if let Some(value) = &options.q {
            params.push(("q", value.clone()));
        }
        if let Some(value) = &options.since {
            params.push(("since", value.clone()));
        }
        if let Some(value) = &options.cursor {
            params.push(("cursor", value.clone()));
        }
        if let Some(value) = options.limit {
            params.push(("limit", value.to_string()));
        }
        let data = self
            .http
            .get(&format!("{}/tasks", Self::base(agent_handle)), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn sent_tasks(
        &self,
        agent_handle: &str,
        options: &A2ASentTaskListOptions,
    ) -> Result<A2ATaskPage> {
        let mut params = Vec::new();
        if let Some(value) = &options.requester_handle {
            params.push(("requester_handle", value.clone()));
        }
        if let Some(value) = &options.worker_handle {
            params.push(("worker_handle", value.clone()));
        }
        if let Some(value) = &options.state {
            params.push(("state", value.clone()));
        }
        if let Some(value) = options.context_id {
            params.push(("context_id", value.to_string()));
        }
        if let Some(value) = &options.q {
            params.push(("q", value.clone()));
        }
        if let Some(value) = &options.since {
            params.push(("since", value.clone()));
        }
        if let Some(value) = &options.cursor {
            params.push(("cursor", value.clone()));
        }
        if let Some(value) = options.limit {
            params.push(("limit", value.to_string()));
        }
        let data = self
            .http
            .get(&format!("{}/sent/tasks", Self::base(agent_handle)), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn task(&self, agent_handle: &str, task_id: Uuid) -> Result<A2ATask> {
        let data = self.http.get(
            &format!("{}/tasks/{task_id}", Self::base(agent_handle)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn sent_task(&self, agent_handle: &str, task_id: Uuid) -> Result<A2ATask> {
        let data = self.http.get(
            &format!("{}/sent/tasks/{task_id}", Self::base(agent_handle)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn messages(
        &self,
        agent_handle: &str,
        options: &A2AMessageListOptions,
    ) -> Result<A2AHistoryMessagePage> {
        let mut params = Vec::new();
        if let Some(value) = options.direction {
            params.push(("direction", value.as_str().to_string()));
        }
        if let Some(value) = &options.requester_handle {
            params.push(("requester_handle", value.clone()));
        }
        if let Some(value) = &options.worker_handle {
            params.push(("worker_handle", value.clone()));
        }
        if let Some(value) = options.task_id {
            params.push(("task_id", value.to_string()));
        }
        if let Some(value) = options.context_id {
            params.push(("context_id", value.to_string()));
        }
        if let Some(value) = options.role {
            params.push(("role", value.as_str().to_string()));
        }
        if let Some(value) = &options.q {
            params.push(("q", value.clone()));
        }
        if let Some(value) = &options.since {
            params.push(("since", value.clone()));
        }
        if let Some(value) = &options.cursor {
            params.push(("cursor", value.clone()));
        }
        if let Some(value) = options.limit {
            params.push(("limit", value.to_string()));
        }
        let data = self
            .http
            .get(&format!("{}/messages", Self::base(agent_handle)), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    fn context_page(
        &self,
        agent_handle: &str,
        sent: bool,
        direction: Option<A2AHistoryDirection>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2AContextPage> {
        let mut params = Vec::new();
        if !sent {
            if let Some(value) = direction {
                params.push(("direction", value.as_str().to_string()));
            }
        }
        if let Some(value) = cursor {
            params.push(("cursor", value.to_string()));
        }
        if let Some(value) = limit {
            params.push(("limit", value.to_string()));
        }
        let segment = if sent { "/sent/contexts" } else { "/contexts" };
        let data = self
            .http
            .get(&format!("{}{segment}", Self::base(agent_handle)), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn contexts(
        &self,
        agent_handle: &str,
        options: &A2AContextListOptions,
    ) -> Result<A2AContextPage> {
        self.context_page(
            agent_handle,
            false,
            options.direction,
            options.cursor.as_deref(),
            options.limit,
        )
    }

    pub fn sent_contexts(
        &self,
        agent_handle: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2AContextPage> {
        self.context_page(agent_handle, true, None, cursor, limit)
    }

    pub fn context(&self, agent_handle: &str, context_id: Uuid) -> Result<A2AContext> {
        let data = self.http.get(
            &format!("{}/contexts/{context_id}", Self::base(agent_handle)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn sent_context(&self, agent_handle: &str, context_id: Uuid) -> Result<A2AContext> {
        let data = self.http.get(
            &format!("{}/sent/contexts/{context_id}", Self::base(agent_handle)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;
    use uuid::Uuid;

    use crate::a2a::{
        A2AContextListOptions, A2AHistoryDirection, A2AMessageListOptions, A2AMessageRole,
        A2ASentTaskListOptions, A2ATaskListOptions,
    };
    use crate::client::Inkbox;

    #[test]
    fn sent_tasks_use_caller_history_path_and_parse_target() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/identities/caller-agent/a2a/sent/tasks")
                .query_param("state", "completed")
                .query_param("limit", "25");
            then.status(200).json_body(json!({
                "items": [{
                    "id": "11111111-1111-1111-1111-111111111111",
                    "context_id": "22222222-2222-2222-2222-222222222222",
                    "state": "completed",
                    "caller": {
                        "identity_id": "33333333-3333-3333-3333-333333333333",
                        "organization_id": "org_caller",
                        "handle": "caller-agent",
                        "trust_tier": "inkbox_verified"
                    },
                    "target": {
                        "identity_id": "44444444-4444-4444-4444-444444444444",
                        "organization_id": "org_target",
                        "handle": "worker-agent"
                    },
                    "messages": [],
                    "completed_at": "2026-07-24T00:01:00Z",
                    "created_at": "2026-07-24T00:00:00Z",
                    "updated_at": "2026-07-24T00:01:00Z"
                }],
                "next_cursor": null
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let page = client
            .a2a()
            .sent_tasks(
                "caller-agent",
                &A2ASentTaskListOptions {
                    state: Some("completed".to_string()),
                    limit: Some(25),
                    ..Default::default()
                },
            )
            .unwrap();

        request.assert();
        assert_eq!(
            page.items[0]
                .target
                .as_ref()
                .and_then(|target| target.handle.as_deref()),
            Some("worker-agent")
        );
    }

    #[test]
    fn tasks_send_every_history_filter_with_exact_wire_names() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/identities/coordinator/a2a/tasks")
                .query_param("direction", "both")
                .query_param("requester_handle", "coordinator")
                .query_param("worker_handle", "researcher")
                .query_param("state", "working")
                .query_param("context_id", "22222222-2222-2222-2222-222222222222")
                .query_param("q", "quarterly 2026")
                .query_param("since", "2026-07-01T00:00:00Z")
                .query_param("cursor", "opaque")
                .query_param("limit", "20");
            then.status(200)
                .json_body(json!({"items": [], "next_cursor": null}));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        client
            .a2a()
            .tasks(
                "coordinator",
                &A2ATaskListOptions {
                    direction: Some(A2AHistoryDirection::Both),
                    requester_handle: Some("coordinator".to_string()),
                    worker_handle: Some("researcher".to_string()),
                    state: Some("working".to_string()),
                    context_id: Some(
                        Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
                    ),
                    q: Some("quarterly 2026".to_string()),
                    since: Some("2026-07-01T00:00:00Z".to_string()),
                    cursor: Some("opaque".to_string()),
                    limit: Some(20),
                },
            )
            .unwrap();

        request.assert();
    }

    #[test]
    fn contexts_send_combined_direction_and_page_options() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/identities/coordinator/a2a/contexts")
                .query_param("direction", "both")
                .query_param("cursor", "opaque")
                .query_param("limit", "20");
            then.status(200)
                .json_body(json!({"items": [], "next_cursor": null}));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        client
            .a2a()
            .contexts(
                "coordinator",
                &A2AContextListOptions {
                    direction: Some(A2AHistoryDirection::Both),
                    cursor: Some("opaque".to_string()),
                    limit: Some(20),
                },
            )
            .unwrap();

        request.assert();
    }

    #[test]
    fn messages_parse_task_and_participant_provenance() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/identities/coordinator/a2a/messages")
                .query_param("direction", "outbound")
                .query_param("worker_handle", "researcher")
                .query_param("role", "agent")
                .query_param("q", "quarter")
                .query_param("limit", "10");
            then.status(200).json_body(json!({
                "items": [{
                    "id": "11111111-1111-1111-1111-111111111111",
                    "message_id": "protocol-message-1",
                    "task_id": "22222222-2222-2222-2222-222222222222",
                    "context_id": "33333333-3333-3333-3333-333333333333",
                    "task_state": "input_required",
                    "caller": {
                        "identity_id": "44444444-4444-4444-4444-444444444444",
                        "organization_id": "org_caller",
                        "handle": "coordinator",
                        "trust_tier": "inkbox_verified"
                    },
                    "target": {
                        "identity_id": "55555555-5555-5555-5555-555555555555",
                        "organization_id": "org_worker",
                        "handle": "researcher"
                    },
                    "role": "agent",
                    "parts": [{"text": "Which quarter?"}],
                    "metadata": null,
                    "extensions": null,
                    "reference_task_ids": null,
                    "created_at": "2026-07-24T00:00:00Z"
                }],
                "next_cursor": "next-page"
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let page = client
            .a2a()
            .messages(
                "coordinator",
                &A2AMessageListOptions {
                    direction: Some(A2AHistoryDirection::Outbound),
                    worker_handle: Some("researcher".to_string()),
                    role: Some(A2AMessageRole::Agent),
                    q: Some("quarter".to_string()),
                    limit: Some(10),
                    ..Default::default()
                },
            )
            .unwrap();

        request.assert();
        assert_eq!(page.next_cursor.as_deref(), Some("next-page"));
        assert_eq!(page.items[0].task_state, "input_required");
        assert_eq!(page.items[0].caller.handle.as_deref(), Some("coordinator"));
        assert_eq!(page.items[0].target.handle.as_deref(), Some("researcher"));
    }
}

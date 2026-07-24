use std::sync::Arc;

use uuid::Uuid;

use crate::a2a::types::{A2AContext, A2AContextPage, A2ATask, A2ATaskPage};
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

    fn task_page(
        &self,
        agent_handle: &str,
        sent: bool,
        state: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2ATaskPage> {
        let mut params = Vec::new();
        if let Some(value) = state {
            params.push(("state", value.to_string()));
        }
        if let Some(value) = cursor {
            params.push(("cursor", value.to_string()));
        }
        if let Some(value) = limit {
            params.push(("limit", value.to_string()));
        }
        let segment = if sent { "/sent/tasks" } else { "/tasks" };
        let data = self
            .http
            .get(&format!("{}{segment}", Self::base(agent_handle)), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    pub fn tasks(
        &self,
        agent_handle: &str,
        state: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2ATaskPage> {
        self.task_page(agent_handle, false, state, cursor, limit)
    }

    pub fn sent_tasks(
        &self,
        agent_handle: &str,
        state: Option<&str>,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2ATaskPage> {
        self.task_page(agent_handle, true, state, cursor, limit)
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

    fn context_page(
        &self,
        agent_handle: &str,
        sent: bool,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2AContextPage> {
        let mut params = Vec::new();
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
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2AContextPage> {
        self.context_page(agent_handle, false, cursor, limit)
    }

    pub fn sent_contexts(
        &self,
        agent_handle: &str,
        cursor: Option<&str>,
        limit: Option<u32>,
    ) -> Result<A2AContextPage> {
        self.context_page(agent_handle, true, cursor, limit)
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
                    "transitions": [],
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
            .sent_tasks("caller-agent", Some("completed"), None, Some(25))
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
}

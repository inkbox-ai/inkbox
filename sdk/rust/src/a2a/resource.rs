use std::sync::Arc;

use serde_json::json;
use uuid::Uuid;

use crate::a2a::types::{
    A2AContext, A2AContextListOptions, A2AContextPage, A2ADirectoryListOptions, A2ADirectoryPage,
    A2AHistoryDirection, A2AHistoryMessagePage, A2AMessageListOptions, A2ASentTaskListOptions,
    A2ATask, A2ATaskListOptions, A2ATaskPage,
};
use crate::a2a::{
    extract_a2a_invitation_token_with_base_url, A2AInvitation, A2AInvitationAcceptResult,
    A2AInvitationCreateOptions, A2AInvitationCreateResult, A2AInvitationListOptions,
    A2AInvitationPage,
};
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

pub struct A2AResource {
    http: Arc<HttpTransport>,
    public_http: Arc<HttpTransport>,
    base_url: String,
}

impl A2AResource {
    pub(crate) fn new(
        http: Arc<HttpTransport>,
        public_http: Arc<HttpTransport>,
        base_url: String,
    ) -> Self {
        Self {
            http,
            public_http,
            base_url,
        }
    }

    fn base(agent_handle: &str) -> String {
        format!("/identities/{agent_handle}/a2a")
    }

    fn directory(
        &self,
        public: bool,
        options: &A2ADirectoryListOptions,
    ) -> Result<A2ADirectoryPage> {
        let mut params = Vec::new();
        if let Some(value) = &options.q {
            params.push(("q", value.clone()));
        }
        if let Some(value) = &options.cursor {
            params.push(("cursor", value.clone()));
        }
        if let Some(value) = options.limit {
            params.push(("limit", value.to_string()));
        }
        let data = if public {
            self.public_http.get("/a2a/directory", &params)?
        } else {
            self.http.get("/identities/a2a/directory", &params)?
        };
        Ok(serde_json::from_value(data)?)
    }

    pub fn public_directory(&self, options: &A2ADirectoryListOptions) -> Result<A2ADirectoryPage> {
        self.directory(true, options)
    }

    pub fn organization_directory(
        &self,
        options: &A2ADirectoryListOptions,
    ) -> Result<A2ADirectoryPage> {
        self.directory(false, options)
    }

    /// Create an invitation for one or more claimed, A2A-enabled agents.
    pub fn create_invitation(
        &self,
        options: &A2AInvitationCreateOptions,
    ) -> Result<A2AInvitationCreateResult> {
        let mut body = json!({"peer_agent_handles": options.peer_agent_handles});
        if let Some(recipient_email) = &options.recipient_email {
            body["recipient_email"] = json!(recipient_email);
        }
        if let Some(expires_in_seconds) = options.expires_in_seconds {
            body["expires_in_seconds"] = json!(expires_in_seconds);
        }
        let data = self.http.post("/a2a/invitations", Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// List invitations created by the current organization.
    pub fn list_invitations(
        &self,
        options: &A2AInvitationListOptions,
    ) -> Result<A2AInvitationPage> {
        let mut params = Vec::new();
        if let Some(status) = options.status {
            params.push(("status", status.as_str().to_string()));
        }
        if let Some(cursor) = &options.cursor {
            params.push(("cursor", cursor.clone()));
        }
        params.push(("limit", options.limit.unwrap_or(50).to_string()));
        let data = self.http.get("/a2a/invitations", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get one invitation created by the current organization.
    pub fn get_invitation(&self, invitation_id: Uuid) -> Result<A2AInvitation> {
        let data = self
            .http
            .get(&format!("/a2a/invitations/{invitation_id}"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Revoke an open invitation created by the current organization.
    pub fn revoke_invitation(&self, invitation_id: Uuid) -> Result<A2AInvitation> {
        let data = self.http.post::<serde_json::Value>(
            &format!("/a2a/invitations/{invitation_id}/revoke"),
            None,
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Accept an invitation with the client's claimed agent-scoped API key.
    pub fn accept_invitation(&self, invitation: &str) -> Result<A2AInvitationAcceptResult> {
        let invitation_token =
            extract_a2a_invitation_token_with_base_url(invitation, &self.base_url)
                .map_err(|error| InkboxError::InvalidArgument(error.to_string()))?;
        let data = self.http.post(
            "/a2a/invitations/accept",
            Some(&json!({"invitation_token": invitation_token})),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
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

    /// Rename a context visible to either participant.
    pub fn update_context(
        &self,
        agent_handle: &str,
        context_id: Uuid,
        name: &str,
    ) -> Result<A2AContext> {
        let data = self.http.patch(
            &format!("{}/contexts/{context_id}", Self::base(agent_handle)),
            &json!({"name": name}),
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
        A2AContextListOptions, A2ADirectoryListOptions, A2ADirectoryPage, A2ADirectoryVisibility,
        A2AHistoryDirection, A2AInvitationCreateOptions, A2AInvitationListOptions,
        A2AInvitationStatus, A2AMessageListOptions, A2AMessageRole, A2ASentTaskListOptions,
        A2ATaskListOptions,
    };
    use crate::client::Inkbox;

    fn invitation_json(invitation_id: Uuid, status: &str) -> serde_json::Value {
        json!({
            "id": invitation_id,
            "issuer_organization_id": "org_sender",
            "inviter_email": "sender@example.com",
            "peer_agent_handles": ["support"],
            "recipient_email": "customer@example.com",
            "status": status,
            "email_status": "sent",
            "email_sent_at": "2026-08-04T00:01:00Z",
            "invitee_identity_id": null,
            "invitee_agent_handle": null,
            "invitee_organization_id": null,
            "expires_at": "2026-08-11T00:00:00Z",
            "accepted_at": null,
            "declined_at": null,
            "revoked_at": null,
            "created_at": "2026-08-04T00:00:00Z",
            "updated_at": "2026-08-04T00:01:00Z"
        })
    }

    #[test]
    fn directory_methods_use_public_and_organization_paths() {
        let server = MockServer::start();
        let public_request = server.mock(|when, then| {
            when.method(GET)
                .path("/a2a/directory")
                .query_param("q", "research")
                .query_param("cursor", "page")
                .query_param("limit", "20");
            then.status(200).json_body(json!({
                "items": [{
                    "card_url": "https://example.com/a2a/helper/card",
                    "card": {"name": "@helper"},
                    "visibility": "public"
                }],
                "next_cursor": "next-page"
            }));
        });
        let organization_request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/identities/a2a/directory")
                .query_param("q", "research")
                .query_param("cursor", "page")
                .query_param("limit", "20");
            then.status(200).json_body(json!({
                "items": [{
                    "card_url": "https://example.com/a2a/helper/card",
                    "card": {"name": "@helper"},
                    "visibility": "organization"
                }],
                "next_cursor": null
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let options = A2ADirectoryListOptions {
            q: Some("research".to_string()),
            cursor: Some("page".to_string()),
            limit: Some(20),
        };

        let public_page = client.a2a().public_directory(&options).unwrap();
        let organization_page = client.a2a().organization_directory(&options).unwrap();

        public_request.assert();
        organization_request.assert();
        assert_eq!(public_page.next_cursor.as_deref(), Some("next-page"));
        assert_eq!(
            public_page.items[0].visibility,
            A2ADirectoryVisibility::Public
        );
        assert_eq!(
            organization_page.items[0].visibility,
            A2ADirectoryVisibility::Organization
        );
    }

    #[test]
    fn directory_visibility_tolerates_unknown_values() {
        let page: A2ADirectoryPage = serde_json::from_value(json!({
            "items": [{
                "card_url": "https://example.com/a2a/helper/card",
                "card": {"name": "@helper"},
                "visibility": "partner"
            }],
            "next_cursor": null
        }))
        .unwrap();

        assert_eq!(page.items[0].visibility, A2ADirectoryVisibility::Unknown);
    }

    #[test]
    fn accepts_an_invitation_with_the_configured_agent_key() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/a2a/invitations/accept")
                .header("x-api-key", "ApiKey_claimed_agent")
                .json_body(json!({
                    "invitation_token": "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
                }));
            then.status(200).json_body(json!({
                "invitation_id": "inv_1",
                "status": "accepted",
                "invitee_identity_id": "identity_2",
                "invitee_agent_handle": "buyer",
                "peer_agent_handles": ["support"],
                "accepted_at": "2026-08-04T01:00:00Z"
            }));
        });
        let client = Inkbox::builder("ApiKey_claimed_agent")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let invitation_url = format!(
            "{}/console/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            server.base_url()
        );

        let result = client.a2a().accept_invitation(&invitation_url).unwrap();

        request.assert();
        assert_eq!(result.status, "accepted");
        assert_eq!(result.invitee_agent_handle, "buyer");
    }

    #[test]
    fn manages_the_complete_invitation_issuer_lifecycle() {
        let server = MockServer::start();
        let invitation_id = Uuid::new_v4();
        let mut create_response = invitation_json(invitation_id, "pending");
        create_response["invitation_token"] = json!(null);
        create_response["invitation_url"] = json!(null);
        create_response["agent_handoff_prompt"] = json!(null);

        let create_request = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/a2a/invitations")
                .header("x-api-key", "ApiKey_admin")
                .json_body(json!({
                    "peer_agent_handles": ["support"],
                    "recipient_email": "customer@example.com",
                    "expires_in_seconds": 86400
                }));
            then.status(201).json_body(create_response.clone());
        });
        let list_request = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/a2a/invitations")
                .query_param("status", "pending")
                .query_param("cursor", "next-page")
                .query_param("limit", "25");
            then.status(200).json_body(json!({
                "items": [invitation_json(invitation_id, "pending")],
                "next_cursor": null
            }));
        });
        let get_request = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/a2a/invitations/{invitation_id}"));
            then.status(200)
                .json_body(invitation_json(invitation_id, "pending"));
        });
        let revoke_request = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/a2a/invitations/{invitation_id}/revoke"));
            then.status(200)
                .json_body(invitation_json(invitation_id, "revoked"));
        });
        let client = Inkbox::builder("ApiKey_admin")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let created = client
            .a2a()
            .create_invitation(&A2AInvitationCreateOptions {
                peer_agent_handles: vec!["support".into()],
                recipient_email: Some("customer@example.com".into()),
                expires_in_seconds: Some(86_400),
            })
            .unwrap();
        let page = client
            .a2a()
            .list_invitations(&A2AInvitationListOptions {
                status: Some(A2AInvitationStatus::Pending),
                cursor: Some("next-page".into()),
                limit: Some(25),
            })
            .unwrap();
        let fetched = client.a2a().get_invitation(invitation_id).unwrap();
        let revoked = client.a2a().revoke_invitation(invitation_id).unwrap();

        create_request.assert();
        list_request.assert();
        get_request.assert();
        revoke_request.assert();
        assert_eq!(created.invitation.id, invitation_id);
        assert_eq!(page.items, vec![fetched]);
        assert_eq!(revoked.status, A2AInvitationStatus::Revoked);
    }

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
    fn context_preserves_name_original_pair_and_mixed_direction_tasks() {
        let server = MockServer::start();
        let context_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        let request = server.mock(|when, then| {
            when.method(GET).path(
                "/api/v1/identities/coordinator/a2a/contexts/22222222-2222-2222-2222-222222222222",
            );
            then.status(200).json_body(json!({
                "id": context_id,
                "name": "Analyse Überprüfung Ergebnis Jetzt",
                "caller": {
                    "identity_id": "33333333-3333-3333-3333-333333333333",
                    "organization_id": "org_a",
                    "handle": "coordinator",
                    "trust_tier": "inkbox_verified"
                },
                "target": {
                    "identity_id": "44444444-4444-4444-4444-444444444444",
                    "organization_id": "org_b",
                    "handle": "researcher"
                },
                "tasks": [{
                    "id": "55555555-5555-5555-5555-555555555555",
                    "context_id": context_id,
                    "state": "working",
                    "caller": {
                        "identity_id": "33333333-3333-3333-3333-333333333333",
                        "organization_id": "org_a",
                        "handle": "coordinator",
                        "trust_tier": "inkbox_verified"
                    },
                    "target": {
                        "identity_id": "44444444-4444-4444-4444-444444444444",
                        "organization_id": "org_b",
                        "handle": "researcher"
                    },
                    "messages": [{
                        "id": "77777777-7777-7777-7777-777777777777",
                        "message_id": "protocol-a-b",
                        "role": "caller",
                        "parts": [{"text": "Analyse"}],
                        "metadata": null,
                        "extensions": null,
                        "reference_task_ids": null,
                        "created_at": "2026-08-01T00:00:00Z"
                    }],
                    "completed_at": null,
                    "created_at": "2026-08-01T00:00:00Z",
                    "updated_at": "2026-08-01T00:01:00Z"
                }, {
                    "id": "66666666-6666-6666-6666-666666666666",
                    "context_id": context_id,
                    "state": "submitted",
                    "caller": {
                        "identity_id": "44444444-4444-4444-4444-444444444444",
                        "organization_id": "org_b",
                        "handle": "researcher",
                        "trust_tier": "inkbox_verified"
                    },
                    "target": {
                        "identity_id": "33333333-3333-3333-3333-333333333333",
                        "organization_id": "org_a",
                        "handle": "coordinator"
                    },
                    "messages": [{
                        "id": "88888888-8888-8888-8888-888888888888",
                        "message_id": "protocol-b-a",
                        "role": "caller",
                        "parts": [{"text": "Review"}],
                        "metadata": null,
                        "extensions": null,
                        "reference_task_ids": null,
                        "created_at": "2026-08-01T00:00:30Z"
                    }],
                    "completed_at": null,
                    "created_at": "2026-08-01T00:00:30Z",
                    "updated_at": "2026-08-01T00:00:30Z"
                }],
                "tasks_truncated": false,
                "created_at": "2026-08-01T00:00:00Z",
                "last_activity_at": "2026-08-01T00:01:00Z"
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let context = client.a2a().context("coordinator", context_id).unwrap();

        request.assert();
        assert_eq!(context.name, "Analyse Überprüfung Ergebnis Jetzt");
        assert_eq!(context.caller.handle.as_deref(), Some("coordinator"));
        assert_eq!(
            context
                .target
                .as_ref()
                .and_then(|target| target.handle.as_deref()),
            Some("researcher")
        );
        assert_eq!(
            context.tasks[0].caller.handle.as_deref(),
            Some("coordinator")
        );
        assert_eq!(
            context.tasks[0]
                .target
                .as_ref()
                .and_then(|target| target.handle.as_deref()),
            Some("researcher")
        );
        assert_eq!(context.tasks[0].state, "working");
        assert_eq!(
            context.tasks[0].messages[0].parts,
            vec![json!({"text": "Analyse"})]
        );
        assert_eq!(
            context.tasks[1].caller.handle.as_deref(),
            Some("researcher")
        );
        assert_eq!(
            context.tasks[1]
                .target
                .as_ref()
                .and_then(|target| target.handle.as_deref()),
            Some("coordinator")
        );
        assert_eq!(context.tasks[1].state, "submitted");
        assert_eq!(
            context.tasks[1].messages[0].parts,
            vec![json!({"text": "Review"})]
        );
    }

    #[test]
    fn update_context_uses_participant_path_and_exact_body() {
        let server = MockServer::start();
        let context_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        let request = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(
                    "/api/v1/identities/coordinator/a2a/contexts/22222222-2222-2222-2222-222222222222",
                )
                .json_body(json!({"name": "Analyse Überprüfung Ergebnis Jetzt"}));
            then.status(200).json_body(json!({
                "id": context_id,
                "name": "Analyse Überprüfung Ergebnis Jetzt",
                "caller": {
                    "identity_id": "33333333-3333-3333-3333-333333333333",
                    "organization_id": "org_a",
                    "handle": "coordinator",
                    "trust_tier": "inkbox_verified"
                },
                "target": {
                    "identity_id": "44444444-4444-4444-4444-444444444444",
                    "organization_id": "org_b",
                    "handle": "researcher"
                },
                "tasks": [],
                "tasks_truncated": false,
                "created_at": "2026-08-01T00:00:00Z",
                "last_activity_at": "2026-08-01T00:01:00Z"
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let context = client
            .a2a()
            .update_context(
                "coordinator",
                context_id,
                "Analyse Überprüfung Ergebnis Jetzt",
            )
            .unwrap();

        request.assert();
        assert_eq!(context.name, "Analyse Überprüfung Ergebnis Jetzt");
    }

    #[test]
    fn update_context_preserves_server_validation_detail() {
        let server = MockServer::start();
        let context_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        let request = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH).path(
                "/api/v1/identities/coordinator/a2a/contexts/22222222-2222-2222-2222-222222222222",
            );
            then.status(422).json_body(json!({
                "detail": "Context names contain at most five words"
            }));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        let error = client
            .a2a()
            .update_context("coordinator", context_id, "Too many words")
            .unwrap_err();

        request.assert();
        match error {
            crate::error::InkboxError::Api {
                status_code,
                detail,
            } => {
                assert_eq!(status_code, 422);
                assert_eq!(
                    detail.to_string(),
                    "Context names contain at most five words"
                );
            }
            other => panic!("unexpected error: {other:?}"),
        }
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

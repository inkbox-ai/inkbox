//! Saved email draft lifecycle.

use std::sync::Arc;

use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::Result;
use crate::http::{validate_idempotency_key, HttpTransport, NO_QUERY};
use crate::mail::resources::Attachment;
use crate::mail::types::{
    DraftAttachmentContent, DraftDetail, DraftRecipients, DraftSummary, ForwardMode, Message,
};

const DEFAULT_PAGE_SIZE: u32 = 50;

/// Fields accepted when creating a draft.
#[derive(Debug, Clone, Default)]
pub struct CreateDraftOptions {
    pub recipients: DraftRecipients,
    pub subject: Option<String>,
    pub body_text: Option<String>,
    pub body_html: Option<String>,
    pub reply_to: Option<String>,
    pub thread_id: Option<Uuid>,
    pub in_reply_to_message_id: Option<String>,
    pub references: Option<Vec<String>>,
    pub attachments: Option<Vec<Attachment>>,
    pub track_opens: bool,
    pub forward_message_id: Option<Uuid>,
    pub forward_mode: Option<ForwardMode>,
    pub include_original_attachments: Option<bool>,
    pub forward_note_text: Option<String>,
    pub forward_note_html: Option<String>,
    pub idempotency_key: Option<String>,
}

impl CreateDraftOptions {
    fn to_wire(&self) -> Result<Value> {
        if self.forward_message_id.is_none()
            && (self.forward_mode.is_some()
                || self.include_original_attachments.is_some()
                || self.forward_note_text.is_some()
                || self.forward_note_html.is_some())
        {
            return Err(crate::error::InkboxError::InvalidArgument(
                "forward options require forward_message_id".into(),
            ));
        }
        let mut body = Map::new();
        body.insert(
            "recipients".into(),
            serde_json::to_value(&self.recipients).expect("draft recipients serialize"),
        );
        insert_optional(&mut body, "subject", &self.subject);
        insert_optional(&mut body, "body_text", &self.body_text);
        insert_optional(&mut body, "body_html", &self.body_html);
        insert_optional(&mut body, "reply_to", &self.reply_to);
        insert_optional(&mut body, "thread_id", &self.thread_id);
        insert_optional(
            &mut body,
            "in_reply_to_message_id",
            &self.in_reply_to_message_id,
        );
        insert_optional(&mut body, "references", &self.references);
        insert_optional(&mut body, "attachments", &self.attachments);
        if self.track_opens {
            body.insert("track_opens".into(), Value::Bool(true));
        }
        if let Some(message_id) = self.forward_message_id {
            body.insert(
                "forward_message_id".into(),
                Value::String(message_id.to_string()),
            );
            if let Some(mode) = self.forward_mode {
                body.insert(
                    "forward_mode".into(),
                    Value::String(mode.as_str().to_string()),
                );
            }
            if let Some(include) = self.include_original_attachments {
                body.insert("include_original_attachments".into(), Value::Bool(include));
            }
        }
        insert_optional(&mut body, "forward_note_text", &self.forward_note_text);
        insert_optional(&mut body, "forward_note_html", &self.forward_note_html);
        Ok(Value::Object(body))
    }
}

/// Partial changes to a draft. Nullable fields are tri-state: outer `None`
/// omits the field, `Some(None)` clears it, and `Some(Some(value))` replaces it.
#[derive(Debug, Clone, Default)]
pub struct UpdateDraftOptions {
    pub recipients: Option<Option<DraftRecipients>>,
    pub subject: Option<Option<String>>,
    pub body_text: Option<Option<String>>,
    pub body_html: Option<Option<String>>,
    pub reply_to: Option<Option<String>>,
    pub thread_id: Option<Option<Uuid>>,
    pub in_reply_to_message_id: Option<Option<String>>,
    pub references: Option<Option<Vec<String>>>,
    pub track_opens: Option<bool>,
    pub forward_note_text: Option<Option<String>>,
    pub forward_note_html: Option<Option<String>>,
}

impl UpdateDraftOptions {
    fn to_wire(&self, generation: u64) -> Value {
        let mut body = Map::new();
        body.insert("generation".into(), Value::from(generation));
        insert_nullable(&mut body, "recipients", &self.recipients);
        insert_nullable(&mut body, "subject", &self.subject);
        insert_nullable(&mut body, "body_text", &self.body_text);
        insert_nullable(&mut body, "body_html", &self.body_html);
        insert_nullable(&mut body, "reply_to", &self.reply_to);
        insert_nullable(&mut body, "thread_id", &self.thread_id);
        insert_nullable(
            &mut body,
            "in_reply_to_message_id",
            &self.in_reply_to_message_id,
        );
        insert_nullable(&mut body, "references", &self.references);
        insert_optional(&mut body, "track_opens", &self.track_opens);
        insert_nullable(&mut body, "forward_note_text", &self.forward_note_text);
        insert_nullable(&mut body, "forward_note_html", &self.forward_note_html);
        Value::Object(body)
    }
}

pub struct DraftsResource {
    http: Arc<HttpTransport>,
}

impl DraftsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    fn base(email_address: &str) -> String {
        format!("/mailboxes/{email_address}/drafts")
    }

    /// Fetch all drafts, newest first, following cursor pagination.
    pub fn list(&self, email_address: &str, page_size: Option<u32>) -> Result<Vec<DraftSummary>> {
        let limit = page_size.unwrap_or(DEFAULT_PAGE_SIZE);
        let mut drafts = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let mut params = vec![("limit", limit.to_string())];
            if let Some(cursor) = &cursor {
                params.push(("cursor", cursor.clone()));
            }
            let page = self.http.get(&Self::base(email_address), &params)?;
            let items = page.get("items").cloned().unwrap_or(Value::Array(vec![]));
            drafts.extend(serde_json::from_value::<Vec<DraftSummary>>(items)?);
            if !page
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                break;
            }
            cursor = page
                .get("next_cursor")
                .and_then(Value::as_str)
                .map(str::to_string);
            if cursor.is_none() {
                break;
            }
        }
        Ok(drafts)
    }

    pub fn create(&self, email_address: &str, options: &CreateDraftOptions) -> Result<DraftDetail> {
        let body = options.to_wire()?;
        let value = match options.idempotency_key.as_deref() {
            Some(key) => {
                validate_idempotency_key(key)?;
                self.http.post_with_headers(
                    &Self::base(email_address),
                    Some(&body),
                    NO_QUERY,
                    &[("Idempotency-Key", key)],
                )
            }
            None => self
                .http
                .post(&Self::base(email_address), Some(&body), NO_QUERY),
        }?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn get(&self, email_address: &str, draft_id: &Uuid) -> Result<DraftDetail> {
        let value = self.http.get(
            &format!("{}/{draft_id}", Self::base(email_address)),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn update(
        &self,
        email_address: &str,
        draft_id: &Uuid,
        generation: u64,
        options: &UpdateDraftOptions,
    ) -> Result<DraftDetail> {
        let value = self.http.patch(
            &format!("{}/{draft_id}", Self::base(email_address)),
            &options.to_wire(generation),
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn duplicate(
        &self,
        email_address: &str,
        draft_id: &Uuid,
        generation: u64,
    ) -> Result<DraftDetail> {
        let body = serde_json::json!({"generation": generation});
        let value = self.http.post(
            &format!("{}/{draft_id}/duplicate", Self::base(email_address)),
            Some(&body),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn delete(&self, email_address: &str, draft_id: &Uuid, generation: u64) -> Result<()> {
        let params = [("generation", generation.to_string())];
        self.http.delete_with_params(
            &format!("{}/{draft_id}", Self::base(email_address)),
            &params,
        )
    }

    pub fn add_attachments(
        &self,
        email_address: &str,
        draft_id: &Uuid,
        generation: u64,
        attachments: &[Attachment],
    ) -> Result<DraftDetail> {
        let body = serde_json::json!({
            "generation": generation,
            "attachments": attachments,
        });
        let value = self.http.post(
            &format!("{}/{draft_id}/attachments", Self::base(email_address)),
            Some(&body),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn remove_attachment(
        &self,
        email_address: &str,
        draft_id: &Uuid,
        part_index: usize,
        generation: u64,
    ) -> Result<DraftDetail> {
        let params = [("generation", generation.to_string())];
        let value = self.http.delete_with_response_and_params(
            &format!(
                "{}/{draft_id}/attachments/{part_index}",
                Self::base(email_address)
            ),
            &params,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn download_attachment(
        &self,
        email_address: &str,
        draft_id: &Uuid,
        part_index: usize,
        generation: u64,
    ) -> Result<DraftAttachmentContent> {
        let params = [("generation", generation.to_string())];
        let response = self.http.get_binary(
            &format!(
                "{}/{draft_id}/attachments/{part_index}",
                Self::base(email_address)
            ),
            "*/*",
            &params,
        )?;
        Ok(DraftAttachmentContent {
            content: response.bytes,
            filename: response
                .filename
                .unwrap_or_else(|| "attachment".to_string()),
            content_type: response
                .content_type
                .and_then(|value| value.split(';').next().map(str::trim).map(str::to_string))
                .unwrap_or_else(|| "application/octet-stream".to_string()),
        })
    }

    pub fn send(&self, email_address: &str, draft_id: &Uuid, generation: u64) -> Result<Message> {
        let body = serde_json::json!({"generation": generation});
        let value = self.http.post(
            &format!("{}/{draft_id}/send", Self::base(email_address)),
            Some(&body),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }
}

fn insert_optional<T: serde::Serialize>(
    body: &mut Map<String, Value>,
    key: &str,
    value: &Option<T>,
) {
    if let Some(value) = value {
        body.insert(
            key.to_string(),
            serde_json::to_value(value).expect("draft option serializes"),
        );
    }
}

fn insert_nullable<T: serde::Serialize>(
    body: &mut Map<String, Value>,
    key: &str,
    value: &Option<Option<T>>,
) {
    if let Some(value) = value {
        body.insert(
            key.to_string(),
            serde_json::to_value(value).expect("draft option serializes"),
        );
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use super::*;
    use crate::agent_identity::AgentIdentity;
    use crate::client::Inkbox;
    use crate::error::{ApiErrorDetail, InkboxError};
    use crate::identities::types::AgentIdentityData;

    const MAILBOX: &str = "agent@example.test";
    const DRAFT_ID: &str = "11111111-1111-1111-1111-111111111111";
    const SECOND_DRAFT_ID: &str = "22222222-2222-2222-2222-222222222222";
    const MAILBOX_ID: &str = "33333333-3333-3333-3333-333333333333";

    fn client(server: &MockServer) -> Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    fn draft(id: &str, generation: u64) -> Value {
        json!({
            "id": id,
            "mailbox_id": MAILBOX_ID,
            "from_address": MAILBOX,
            "to_addresses": ["reader@example.test"],
            "cc_addresses": [],
            "bcc_addresses": [],
            "subject": "Draft subject",
            "snippet": "Draft body",
            "has_attachments": false,
            "attachment_count": 0,
            "generation": generation,
            "send_state": "draft",
            "track_opens": false,
            "created_at": "2026-08-17T10:00:00Z",
            "updated_at": "2026-08-17T10:01:00Z",
            "body_text": "Draft body",
            "body_html": null,
            "reply_to": null,
            "thread_id": null,
            "message_id": "<draft@example.test>",
            "in_reply_to": null,
            "references": [],
            "forward_source_message_id": null,
            "forward_note_text": null,
            "forward_note_html": null,
            "attachment_metadata": []
        })
    }

    fn summary(id: &str) -> Value {
        let mut value = draft(id, 1);
        for key in [
            "body_text",
            "body_html",
            "reply_to",
            "thread_id",
            "message_id",
            "in_reply_to",
            "references",
            "forward_source_message_id",
            "forward_note_text",
            "forward_note_html",
            "attachment_metadata",
        ] {
            value.as_object_mut().unwrap().remove(key);
        }
        value
    }

    fn message() -> Value {
        json!({
            "id": "44444444-4444-4444-4444-444444444444",
            "mailbox_id": MAILBOX_ID,
            "thread_id": "55555555-5555-5555-5555-555555555555",
            "message_id": "<sent@example.test>",
            "from_address": MAILBOX,
            "to_addresses": ["reader@example.test"],
            "cc_addresses": null,
            "subject": "Draft subject",
            "snippet": "Draft body",
            "direction": "outbound",
            "status": "sent",
            "is_read": true,
            "is_starred": false,
            "has_attachments": false,
            "created_at": "2026-08-17T10:02:00Z",
            "open_count": 0,
            "first_opened_at": null,
            "import_job_id": null
        })
    }

    fn draft_id() -> Uuid {
        Uuid::parse_str(DRAFT_ID).unwrap()
    }

    #[test]
    fn list_auto_paginates_and_client_exposes_resource() {
        let server = MockServer::start();
        let second = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts"))
                .query_param("limit", "2")
                .query_param("cursor", "next-page");
            then.status(200).json_body(json!({
                "items": [summary(SECOND_DRAFT_ID)],
                "next_cursor": null,
                "has_more": false
            }));
        });
        let first = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts"))
                .query_param("limit", "2");
            then.status(200).json_body(json!({
                "items": [summary(DRAFT_ID)],
                "next_cursor": "next-page",
                "has_more": true
            }));
        });

        let drafts = client(&server).drafts().list(MAILBOX, Some(2)).unwrap();

        first.assert();
        second.assert();
        assert_eq!(drafts.len(), 2);
        assert_eq!(drafts[1].id.to_string(), SECOND_DRAFT_ID);
    }

    #[test]
    fn create_sends_exact_non_forward_body_and_omits_forward_defaults() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts"))
                .json_body(json!({
                    "recipients": {"to": ["reader@example.test"]},
                    "subject": "Draft subject",
                    "body_text": "Draft body",
                    "track_opens": true
                }));
            then.status(201).json_body(draft(DRAFT_ID, 1));
        });
        let options = CreateDraftOptions {
            recipients: DraftRecipients {
                to: Some(vec!["reader@example.test".into()]),
                ..Default::default()
            },
            subject: Some("Draft subject".into()),
            body_text: Some("Draft body".into()),
            track_opens: true,
            ..Default::default()
        };

        let created = client(&server).drafts().create(MAILBOX, &options).unwrap();

        request.assert();
        assert_eq!(created.summary.generation, 1);
    }

    #[test]
    fn create_forward_sends_forward_defaults_and_attachments() {
        let server = MockServer::start();
        let source_id = Uuid::parse_str("66666666-6666-6666-6666-666666666666").unwrap();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts"))
                .json_body(json!({
                    "recipients": {},
                    "attachments": [{
                        "filename": "note.txt",
                        "content_type": "text/plain",
                        "content_base64": "aGk="
                    }],
                    "forward_message_id": source_id,
                    "forward_mode": "inline",
                    "include_original_attachments": true,
                    "forward_note_text": "For reference"
                }));
            then.status(201).json_body(draft(DRAFT_ID, 1));
        });
        let options = CreateDraftOptions {
            forward_message_id: Some(source_id),
            forward_mode: Some(ForwardMode::Inline),
            include_original_attachments: Some(true),
            forward_note_text: Some("For reference".into()),
            attachments: Some(vec![Attachment {
                filename: "note.txt".into(),
                content_type: "text/plain".into(),
                content_base64: "aGk=".into(),
                content_id: None,
            }]),
            ..Default::default()
        };

        client(&server).drafts().create(MAILBOX, &options).unwrap();
        request.assert();
    }

    #[test]
    fn create_rejects_forward_options_without_source() {
        let server = MockServer::start();
        let options = CreateDraftOptions {
            forward_mode: Some(ForwardMode::Inline),
            ..Default::default()
        };

        let error = client(&server)
            .drafts()
            .create(MAILBOX, &options)
            .unwrap_err();

        assert!(
            matches!(error, InkboxError::InvalidArgument(message) if message.contains("forward_message_id"))
        );
    }

    #[test]
    fn create_sends_validated_idempotency_key_as_header() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts"))
                .header("Idempotency-Key", "draft-create-1")
                .json_body(json!({"recipients": {}}));
            then.status(201).json_body(draft(DRAFT_ID, 1));
        });
        let options = CreateDraftOptions {
            idempotency_key: Some("draft-create-1".into()),
            ..Default::default()
        };

        client(&server).drafts().create(MAILBOX, &options).unwrap();

        request.assert();
        let invalid = CreateDraftOptions {
            idempotency_key: Some(String::new()),
            ..Default::default()
        };
        assert!(matches!(
            client(&server).drafts().create(MAILBOX, &invalid),
            Err(InkboxError::InvalidArgument(_))
        ));
    }

    #[test]
    fn update_preserves_omitted_null_and_value_states() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method("PATCH")
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}"
                ))
                .json_body(json!({
                    "generation": 7,
                    "subject": null,
                    "body_text": "Replacement",
                    "references": null,
                    "track_opens": false
                }));
            then.status(200).json_body(draft(DRAFT_ID, 8));
        });
        let options = UpdateDraftOptions {
            subject: Some(None),
            body_text: Some(Some("Replacement".into())),
            references: Some(None),
            track_opens: Some(false),
            ..Default::default()
        };

        let updated = client(&server)
            .drafts()
            .update(MAILBOX, &draft_id(), 7, &options)
            .unwrap();

        request.assert();
        assert_eq!(updated.summary.generation, 8);
    }

    #[test]
    fn duplicate_and_delete_place_generation_correctly() {
        let server = MockServer::start();
        let duplicate = server.mock(|when, then| {
            when.method(POST)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/duplicate"
                ))
                .json_body(json!({"generation": 3}));
            then.status(201).json_body(draft(SECOND_DRAFT_ID, 1));
        });
        let delete = server.mock(|when, then| {
            when.method(DELETE)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}"
                ))
                .query_param("generation", "3");
            then.status(204);
        });
        let client = client(&server);

        client.drafts().duplicate(MAILBOX, &draft_id(), 3).unwrap();
        client.drafts().delete(MAILBOX, &draft_id(), 3).unwrap();

        duplicate.assert();
        delete.assert();
    }

    #[test]
    fn attachment_operations_preserve_generation_bytes_and_headers() {
        let server = MockServer::start();
        let add = server.mock(|when, then| {
            when.method(POST)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/attachments"
                ))
                .json_body(json!({
                    "generation": 2,
                    "attachments": [{
                        "filename": "résumé.txt",
                        "content_type": "text/plain",
                        "content_base64": "ZHJhZnQ="
                    }]
                }));
            then.status(200).json_body(draft(DRAFT_ID, 3));
        });
        let remove = server.mock(|when, then| {
            when.method(DELETE)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/attachments/4"
                ))
                .query_param("generation", "3");
            then.status(200).json_body(draft(DRAFT_ID, 4));
        });
        let download = server.mock(|when, then| {
            when.method(GET)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/attachments/4"
                ))
                .query_param("generation", "4");
            then.status(200)
                .header("Content-Type", "text/plain; charset=utf-8")
                .header(
                    "Content-Disposition",
                    "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.txt",
                )
                .body("draft bytes");
        });
        let attachment = Attachment {
            filename: "résumé.txt".into(),
            content_type: "text/plain".into(),
            content_base64: "ZHJhZnQ=".into(),
            content_id: None,
        };
        let client = client(&server);

        client
            .drafts()
            .add_attachments(MAILBOX, &draft_id(), 2, &[attachment])
            .unwrap();
        client
            .drafts()
            .remove_attachment(MAILBOX, &draft_id(), 4, 3)
            .unwrap();
        let content = client
            .drafts()
            .download_attachment(MAILBOX, &draft_id(), 4, 4)
            .unwrap();

        add.assert();
        remove.assert();
        download.assert();
        assert_eq!(content.content, b"draft bytes");
        assert_eq!(content.filename, "résumé.txt");
        assert_eq!(content.content_type, "text/plain");
    }

    #[test]
    fn send_returns_message_and_maps_api_errors() {
        let server = MockServer::start();
        let sent = server.mock(|when, then| {
            when.method(POST)
                .path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/send"
                ))
                .json_body(json!({"generation": 5}));
            then.status(200).json_body(message());
        });
        let sent_message = client(&server)
            .drafts()
            .send(MAILBOX, &draft_id(), 5)
            .unwrap();
        sent.assert();
        assert_eq!(sent_message.status, "sent");

        for code in [
            "draft_generation_conflict",
            "draft_send_in_progress",
            "draft_delivery_uncertain",
        ] {
            let conflict_server = MockServer::start();
            conflict_server.mock(|when, then| {
                when.method(POST).path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/send"
                ));
                then.status(409)
                    .header("Retry-After", "12")
                    .json_body(json!({"detail": {
                        "error": code,
                        "message": "Draft conflict"
                    }}));
            });
            let error = client(&conflict_server)
                .drafts()
                .send(MAILBOX, &draft_id(), 5)
                .unwrap_err();
            assert_eq!(error.retry_after_seconds(), Some(12));
            match error {
                InkboxError::Api {
                    status_code: 409,
                    detail: ApiErrorDetail::Structured(detail),
                    ..
                } => {
                    assert_eq!(detail["error"], code);
                    assert_eq!(detail["retry_after_seconds"], 12);
                }
                other => panic!("expected structured conflict, got {other:?}"),
            }
        }

        let storage_server = MockServer::start();
        storage_server.mock(|when, then| {
            when.method(POST).path(format!(
                "/api/v1/mail/mailboxes/{MAILBOX}/drafts/{DRAFT_ID}/send"
            ));
            then.status(402).json_body(json!({"detail": {
                "error": "storage_limit_exceeded",
                "message": "Storage limit reached",
                "upgrade_url": "https://example.test/billing",
                "limit_bytes": 1024
            }}));
        });
        let error = client(&storage_server)
            .drafts()
            .send(MAILBOX, &draft_id(), 5)
            .unwrap_err();
        assert!(matches!(
            error,
            InkboxError::StorageLimitExceeded {
                status_code: 402,
                limit_bytes: Some(1024),
                ..
            }
        ));
    }

    #[test]
    fn identity_draft_helpers_scope_every_request_to_its_mailbox() {
        let server = MockServer::start();
        let base = format!("/api/v1/mail/mailboxes/{MAILBOX}/drafts");
        let list = server.mock(|when, then| {
            when.method(GET)
                .path(base.as_str())
                .query_param("limit", "1");
            then.status(200)
                .json_body(json!({"items": [], "next_cursor": null, "has_more": false}));
        });
        let create = server.mock(|when, then| {
            when.method(POST)
                .path(base.as_str())
                .json_body(json!({"recipients": {}}));
            then.status(201).json_body(draft(DRAFT_ID, 1));
        });
        let get = server.mock(|when, then| {
            when.method(GET).path(format!("{base}/{DRAFT_ID}"));
            then.status(200).json_body(draft(DRAFT_ID, 1));
        });
        let update = server.mock(|when, then| {
            when.method("PATCH")
                .path(format!("{base}/{DRAFT_ID}"))
                .json_body(json!({"generation": 1}));
            then.status(200).json_body(draft(DRAFT_ID, 2));
        });
        let duplicate = server.mock(|when, then| {
            when.method(POST)
                .path(format!("{base}/{DRAFT_ID}/duplicate"))
                .json_body(json!({"generation": 2}));
            then.status(201).json_body(draft(SECOND_DRAFT_ID, 1));
        });
        let delete = server.mock(|when, then| {
            when.method(DELETE)
                .path(format!("{base}/{DRAFT_ID}"))
                .query_param("generation", "2");
            then.status(204);
        });
        let send = server.mock(|when, then| {
            when.method(POST)
                .path(format!("{base}/{DRAFT_ID}/send"))
                .json_body(json!({"generation": 2}));
            then.status(200).json_body(message());
        });
        let data: AgentIdentityData = serde_json::from_value(json!({
            "id": "77777777-7777-7777-7777-777777777777",
            "organization_id": "org_test",
            "agent_handle": "agent",
            "email_address": MAILBOX,
            "created_at": "2026-08-17T10:00:00Z",
            "updated_at": "2026-08-17T10:00:00Z",
            "mailbox": {
                "id": MAILBOX_ID,
                "email_address": MAILBOX,
                "created_at": "2026-08-17T10:00:00Z",
                "updated_at": "2026-08-17T10:00:00Z"
            }
        }))
        .unwrap();
        let identity = AgentIdentity::new(data, client(&server));

        identity.iter_email_drafts(Some(1)).unwrap();
        identity
            .create_email_draft(&CreateDraftOptions::default())
            .unwrap();
        identity.get_email_draft(&draft_id()).unwrap();
        identity
            .update_email_draft(&draft_id(), 1, &UpdateDraftOptions::default())
            .unwrap();
        identity.duplicate_email_draft(&draft_id(), 2).unwrap();
        identity.delete_email_draft(&draft_id(), 2).unwrap();
        identity.send_email_draft(&draft_id(), 2).unwrap();

        for request in [list, create, get, update, duplicate, delete, send] {
            request.assert();
        }
    }
}

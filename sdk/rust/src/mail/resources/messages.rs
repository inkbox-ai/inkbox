//! Message operations: list (auto-paginated), get, send, flag updates, delete.

use std::sync::Arc;

use serde_json::{json, Value};

use crate::error::Result;
use crate::filters::DateRangeFilter;
use crate::http::HttpTransport;
use crate::mail::types::{ForwardMode, Message, MessageDetail, MessageDirection};

const DEFAULT_PAGE_SIZE: i64 = 50;

/// An attachment to ride along with a `send`/`forward`.
///
/// Mirrors the Python `dict` shape: each entry must carry `filename`,
/// `content_type` (MIME type), and `content_base64` (base64-encoded content).
///
/// Set `content_id` to render the part inline in the HTML body (referenced as
/// `cid:<content_id>`, e.g. `<img src="cid:chart1">`) instead of as a download.
/// Inline parts require `body_html`, an `image/*` `content_type`, and a unique
/// id per send; they are only honored on `send`/`reply_all` (forwards 422).
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize)]
pub struct Attachment {
    pub filename: String,
    pub content_type: String,
    pub content_base64: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content_id: Option<String>,
}

pub struct MessagesResource {
    http: Arc<HttpTransport>,
}

impl MessagesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Fetch all messages in a mailbox, newest first.
    ///
    /// Pagination is handled automatically: every page is fetched and the
    /// messages are collected into a single `Vec` (the synchronous analogue of
    /// the Python iterator).
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox.
    /// * `page_size` - Number of messages fetched per API call (1-100). Pass
    ///   `None` for the default of 50.
    /// * `direction` - Filter by direction.
    pub fn list(
        &self,
        email_address: &str,
        page_size: Option<i64>,
        direction: Option<MessageDirection>,
    ) -> Result<Vec<Message>> {
        // Delegate with an empty (default) date range, which sends no extra
        // params — wire-identical to the original list.
        self.list_filtered(
            email_address,
            page_size,
            direction,
            &DateRangeFilter::default(),
        )
    }

    /// Fetch all messages in a mailbox, newest first, additionally narrowed by
    /// a `created_at` [`DateRangeFilter`].
    ///
    /// Identical to [`MessagesResource::list`] but also forwards the filter's
    /// `start_datetime` / `end_datetime` / `tz`. A default filter sends nothing extra,
    /// so this behaves exactly like `list`.
    ///
    /// # Arguments
    /// * `email_address` / `page_size` / `direction` - See
    ///   [`MessagesResource::list`].
    /// * `filter` - Optional `created_at` date-range bounds. Bare dates cover
    ///   the whole day; `end_datetime` is whole-day inclusive.
    pub fn list_filtered(
        &self,
        email_address: &str,
        page_size: Option<i64>,
        direction: Option<MessageDirection>,
        filter: &DateRangeFilter,
    ) -> Result<Vec<Message>> {
        let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE);
        let mut out: Vec<Message> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            // `cursor` is always sent (Python sends it even when None); on the
            // wire `None` simply means "first page".
            let mut params: Vec<(&str, String)> = vec![("limit", page_size.to_string())];
            if let Some(c) = &cursor {
                params.push(("cursor", c.clone()));
            }
            if let Some(d) = direction {
                params.push(("direction", d_str(d).to_string()));
            }
            filter.apply(&mut params);
            let page = self
                .http
                .get(&format!("/mailboxes/{email_address}/messages"), &params)?;

            // Pull and decode this page's items.
            let items = page.get("items").cloned().unwrap_or(Value::Array(vec![]));
            let batch: Vec<Message> = serde_json::from_value(items)?;
            out.extend(batch);

            // Stop once the server reports no more pages.
            let has_more = page
                .get("has_more")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if !has_more {
                break;
            }
            cursor = page
                .get("next_cursor")
                .and_then(Value::as_str)
                .map(|s| s.to_string());
        }
        Ok(out)
    }

    /// Get a message with full body content.
    ///
    /// Fetching a single **inbound** message with an API key marks it read
    /// server-side (`is_read` becomes `true`); list, thread, and attachment
    /// routes do not. Agents that only read via `list` never flip `is_read` —
    /// use `mark_read` for those workflows. `is_read` (agent consumed via API)
    /// is distinct from `first_opened_at` (the recipient's mail client loaded
    /// the tracking pixel).
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the owning mailbox.
    /// * `message_id` - UUID of the message.
    ///
    /// # Returns
    /// Full message including `body_text` and `body_html`.
    pub fn get(&self, email_address: &str, message_id: &str) -> Result<MessageDetail> {
        let data = self.http.get(
            &format!("/mailboxes/{email_address}/messages/{message_id}"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Send an email from a mailbox.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the sending mailbox.
    /// * `to` - Primary recipient addresses (at least one required).
    /// * `subject` - Email subject line.
    /// * `body_text` - Plain-text body.
    /// * `body_html` - HTML body.
    /// * `cc` / `bcc` - Carbon-copy / blind carbon-copy recipients.
    /// * `in_reply_to_message_id` - RFC 5322 Message-ID of the message being
    ///   replied to. Threads the reply automatically.
    /// * `attachments` - Optional file attachments. Max total size: 25 MB.
    ///   Blocked extensions: `.exe`, `.bat`, `.scr`. Set `content_id` on an
    ///   entry to render it inline in the HTML body (see [`Attachment`]).
    /// * `track_opens` - Embed an open-tracking pixel in the HTML body. Requires
    ///   `body_html`; a plain-text-only send with `track_opens` is rejected 422
    ///   server-side. Opens surface as `first_opened_at` / `open_count`; prefer
    ///   `first_opened_at` as the reliable "opened" signal.
    ///
    /// # Returns
    /// The sent message metadata.
    ///
    /// Returns [`InkboxError::StorageLimitExceeded`](crate::error::InkboxError)
    /// (HTTP 402) when the mailbox has reached its plan's storage cap. Free
    /// space with [`delete`](Self::delete) or `threads().delete()`, or upgrade
    /// the plan at the error's `upgrade_url`.
    ///
    /// On the Free plan a footer is appended to the *stored* body, so what
    /// [`get`](Self::get) reads back is not byte-for-byte what you sent (a send
    /// with no body comes back with the footer as its body).
    #[allow(clippy::too_many_arguments)]
    pub fn send(
        &self,
        email_address: &str,
        to: &[String],
        subject: &str,
        body_text: Option<&str>,
        body_html: Option<&str>,
        cc: Option<&[String]>,
        bcc: Option<&[String]>,
        in_reply_to_message_id: Option<&str>,
        attachments: Option<&[Attachment]>,
        track_opens: bool,
    ) -> Result<Message> {
        // Recipients: `to` always present; `cc`/`bcc` only when non-empty
        // (Python tests truthiness, so empty lists are dropped).
        let mut recipients = serde_json::Map::new();
        recipients.insert("to".into(), json!(to));
        if let Some(cc) = cc {
            if !cc.is_empty() {
                recipients.insert("cc".into(), json!(cc));
            }
        }
        if let Some(bcc) = bcc {
            if !bcc.is_empty() {
                recipients.insert("bcc".into(), json!(bcc));
            }
        }

        let mut body = serde_json::Map::new();
        body.insert("recipients".into(), Value::Object(recipients));
        body.insert("subject".into(), Value::String(subject.to_string()));
        if let Some(bt) = body_text {
            body.insert("body_text".into(), Value::String(bt.to_string()));
        }
        if let Some(bh) = body_html {
            body.insert("body_html".into(), Value::String(bh.to_string()));
        }
        if let Some(irt) = in_reply_to_message_id {
            body.insert(
                "in_reply_to_message_id".into(),
                Value::String(irt.to_string()),
            );
        }
        if let Some(att) = attachments {
            body.insert("attachments".into(), json!(att));
        }
        if track_opens {
            body.insert("track_opens".into(), Value::Bool(true));
        }

        let data = self.http.post(
            &format!("/mailboxes/{email_address}/messages"),
            Some(&Value::Object(body)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Reply to everyone on a stored message.
    ///
    /// The server resolves recipients from the source message, so no `to`/`cc`
    /// is sent. BCC recipients are never carried forward.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the replying mailbox.
    /// * `message_id` - UUID of the message being replied to.
    /// * `subject` - Optional override; defaults server-side to
    ///   `"Re: " + original.subject`.
    /// * `body_text` / `body_html` - Optional reply body.
    /// * `attachments` - Optional file attachments. Same shape as `send`,
    ///   including `content_id` for inline images.
    /// * `reply_to` - Optional Reply-To address.
    ///
    /// # Returns
    /// The sent reply's message metadata.
    ///
    /// Returns [`InkboxError::StorageLimitExceeded`](crate::error::InkboxError)
    /// (HTTP 402) when the mailbox has reached its plan's storage cap, and — on
    /// the Free plan — appends a footer to the stored body. See
    /// [`send`](Self::send).
    #[allow(clippy::too_many_arguments)]
    pub fn reply_all(
        &self,
        email_address: &str,
        message_id: &str,
        subject: Option<&str>,
        body_text: Option<&str>,
        body_html: Option<&str>,
        attachments: Option<&[Attachment]>,
        reply_to: Option<&str>,
    ) -> Result<Message> {
        let mut body = serde_json::Map::new();
        if let Some(s) = subject {
            body.insert("subject".into(), Value::String(s.to_string()));
        }
        if let Some(bt) = body_text {
            body.insert("body_text".into(), Value::String(bt.to_string()));
        }
        if let Some(bh) = body_html {
            body.insert("body_html".into(), Value::String(bh.to_string()));
        }
        if let Some(att) = attachments {
            body.insert("attachments".into(), json!(att));
        }
        if let Some(rt) = reply_to {
            body.insert("reply_to".into(), Value::String(rt.to_string()));
        }

        let data = self.http.post(
            &format!("/mailboxes/{email_address}/messages/{message_id}/reply-all"),
            Some(&Value::Object(body)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Forward a stored message out from this mailbox.
    ///
    /// Two modes are available — see [`ForwardMode`]. Forwards start a
    /// brand-new thread. At least one address is required across `to`, `cc`,
    /// and `bcc`.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the forwarding mailbox.
    /// * `message_id` - UUID of the message being forwarded.
    /// * `to` / `cc` / `bcc` - Recipient addresses (only non-empty lists are
    ///   sent).
    /// * `mode` - `Inline` (default) or `Wrapped`.
    /// * `subject` - Optional override; defaults server-side to
    ///   `"Fwd: " + original.subject`.
    /// * `body_text` / `body_html` - Optional caller note.
    /// * `additional_attachments` - Optional caller-authored attachments. Same
    ///   shape and limits as `send`, but inline images (`content_id`) are not
    ///   supported on forwards (422).
    /// * `include_original_attachments` - `inline` mode only: re-attach the
    ///   original attachments. Ignored in `wrapped` mode.
    /// * `reply_to` - Optional Reply-To address for the outer envelope.
    /// * `track_opens` - Embed an open-tracking pixel; requires an HTML part to
    ///   inject into. `inline` forwards inherit the original email's HTML (no
    ///   caller body needed); `wrapped` forwards need a caller `body_html`.
    ///   Opens surface as `first_opened_at` / `open_count`.
    ///
    /// # Returns
    /// The newly forwarded message metadata.
    ///
    /// Returns [`InkboxError::StorageLimitExceeded`](crate::error::InkboxError)
    /// (HTTP 402) when the mailbox has reached its plan's storage cap, and — on
    /// the Free plan — appends a footer to the stored body. See
    /// [`send`](Self::send).
    #[allow(clippy::too_many_arguments)]
    pub fn forward(
        &self,
        email_address: &str,
        message_id: &str,
        to: Option<&[String]>,
        cc: Option<&[String]>,
        bcc: Option<&[String]>,
        mode: ForwardMode,
        subject: Option<&str>,
        body_text: Option<&str>,
        body_html: Option<&str>,
        additional_attachments: Option<&[Attachment]>,
        include_original_attachments: bool,
        reply_to: Option<&str>,
        track_opens: bool,
    ) -> Result<Message> {
        // Recipients map: each list is only added when non-empty (Python's
        // truthiness check), so an empty `to`/`cc`/`bcc` is omitted entirely.
        let mut recipients = serde_json::Map::new();
        if let Some(to) = to {
            if !to.is_empty() {
                recipients.insert("to".into(), json!(to));
            }
        }
        if let Some(cc) = cc {
            if !cc.is_empty() {
                recipients.insert("cc".into(), json!(cc));
            }
        }
        if let Some(bcc) = bcc {
            if !bcc.is_empty() {
                recipients.insert("bcc".into(), json!(bcc));
            }
        }

        let mut body = serde_json::Map::new();
        body.insert("recipients".into(), Value::Object(recipients));
        body.insert("mode".into(), Value::String(mode.as_str().to_string()));
        body.insert(
            "include_original_attachments".into(),
            Value::Bool(include_original_attachments),
        );
        if let Some(s) = subject {
            body.insert("subject".into(), Value::String(s.to_string()));
        }
        if let Some(bt) = body_text {
            body.insert("body_text".into(), Value::String(bt.to_string()));
        }
        if let Some(bh) = body_html {
            body.insert("body_html".into(), Value::String(bh.to_string()));
        }
        if let Some(att) = additional_attachments {
            body.insert("additional_attachments".into(), json!(att));
        }
        if let Some(rt) = reply_to {
            body.insert("reply_to".into(), Value::String(rt.to_string()));
        }
        if track_opens {
            body.insert("track_opens".into(), Value::Bool(true));
        }

        let data = self.http.post(
            &format!("/mailboxes/{email_address}/messages/{message_id}/forward"),
            Some(&Value::Object(body)),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update read/starred flags on a message.
    ///
    /// Pass only the flags you want to change; `None` flags are left as-is.
    pub fn update_flags(
        &self,
        email_address: &str,
        message_id: &str,
        is_read: Option<bool>,
        is_starred: Option<bool>,
    ) -> Result<Message> {
        let mut body = serde_json::Map::new();
        if let Some(r) = is_read {
            body.insert("is_read".into(), Value::Bool(r));
        }
        if let Some(s) = is_starred {
            body.insert("is_starred".into(), Value::Bool(s));
        }
        let data = self.http.patch(
            &format!("/mailboxes/{email_address}/messages/{message_id}"),
            &Value::Object(body),
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Mark a message as read.
    pub fn mark_read(&self, email_address: &str, message_id: &str) -> Result<Message> {
        self.update_flags(email_address, message_id, Some(true), None)
    }

    /// Mark a message as unread.
    pub fn mark_unread(&self, email_address: &str, message_id: &str) -> Result<Message> {
        self.update_flags(email_address, message_id, Some(false), None)
    }

    /// Star a message.
    pub fn star(&self, email_address: &str, message_id: &str) -> Result<Message> {
        self.update_flags(email_address, message_id, None, Some(true))
    }

    /// Unstar a message.
    pub fn unstar(&self, email_address: &str, message_id: &str) -> Result<Message> {
        self.update_flags(email_address, message_id, None, Some(false))
    }

    /// Delete a message.
    pub fn delete(&self, email_address: &str, message_id: &str) -> Result<()> {
        self.http
            .delete(&format!("/mailboxes/{email_address}/messages/{message_id}"))
    }

    /// Get a temporary signed URL for a message attachment.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the owning mailbox.
    /// * `message_id` - UUID of the message.
    /// * `filename` - Attachment filename.
    /// * `redirect` - If `true`, follows the 302 redirect and returns the final
    ///   URL as `{"url": str}`. If `false` (default), returns `{"url",
    ///   "filename", "expires_in"}`.
    ///
    /// # Returns
    /// The raw JSON object (`url`, `filename`, `expires_in` in seconds).
    pub fn get_attachment(
        &self,
        email_address: &str,
        message_id: &str,
        filename: &str,
        redirect: bool,
    ) -> Result<Value> {
        let params = [(
            "redirect",
            if redirect { "true" } else { "false" }.to_string(),
        )];
        self.http.get(
            &format!("/mailboxes/{email_address}/messages/{message_id}/attachments/{filename}"),
            &params,
        )
    }
}

/// Wire string for a message direction (used as a query value).
fn d_str(d: MessageDirection) -> &'static str {
    match d {
        MessageDirection::Inbound => "inbound",
        MessageDirection::Outbound => "outbound",
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use super::Attachment;
    use crate::client::Inkbox;
    use crate::error::{ApiErrorDetail, InkboxError};
    use crate::mail::types::ForwardMode;

    const MAILBOX: &str = "agent-x@inkboxmail.com";
    const MSG_ID: &str = "44444444-4444-4444-4444-444444444444";

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    /// The structured 402 the server emits once a mailbox is at its cap.
    fn storage_limit_402() -> serde_json::Value {
        json!({
            "detail": {
                "error": "storage_limit_exceeded",
                "message": "This inbox has reached its storage limit of 2 GiB. \
                            Delete messages to free space, or upgrade your plan \
                            for more: https://inkbox.ai/console/billing",
                "upgrade_url": "https://inkbox.ai/console/billing",
                "limit_bytes": 2147483648u64
            }
        })
    }

    fn assert_storage_limit(err: InkboxError) {
        match err {
            InkboxError::StorageLimitExceeded {
                status_code,
                message,
                upgrade_url,
                limit_bytes,
                ..
            } => {
                assert_eq!(status_code, 402);
                assert!(message.contains("storage limit"));
                assert_eq!(upgrade_url, "https://inkbox.ai/console/billing");
                assert_eq!(limit_bytes, Some(2 * 1024 * 1024 * 1024));
            }
            other => panic!("expected InkboxError::StorageLimitExceeded, got {other:?}"),
        }
    }

    #[test]
    fn send_402_maps_to_storage_limit_exceeded() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/messages"));
            then.status(402).json_body(storage_limit_402());
        });
        let err = client(&server)
            .messages()
            .send(
                MAILBOX,
                &["dest@example.com".to_string()],
                "hi",
                Some("body"),
                None,
                None,
                None,
                None,
                None,
                false,
            )
            .unwrap_err();
        mock.assert();
        assert_storage_limit(err);
    }

    #[test]
    fn reply_all_402_maps_to_storage_limit_exceeded() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path(format!(
                "/api/v1/mail/mailboxes/{MAILBOX}/messages/{MSG_ID}/reply-all"
            ));
            then.status(402).json_body(storage_limit_402());
        });
        let err = client(&server)
            .messages()
            .reply_all(MAILBOX, MSG_ID, None, Some("body"), None, None, None)
            .unwrap_err();
        mock.assert();
        assert_storage_limit(err);
    }

    #[test]
    fn forward_402_maps_to_storage_limit_exceeded() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST).path(format!(
                "/api/v1/mail/mailboxes/{MAILBOX}/messages/{MSG_ID}/forward"
            ));
            then.status(402).json_body(storage_limit_402());
        });
        let err = client(&server)
            .messages()
            .forward(
                MAILBOX,
                MSG_ID,
                Some(&["dest@example.com".to_string()]),
                None,
                None,
                ForwardMode::Inline,
                None,
                None,
                None,
                None,
                false,
                None,
                false,
            )
            .unwrap_err();
        mock.assert();
        assert_storage_limit(err);
    }

    #[test]
    fn storage_limit_402_preserves_an_unavailable_limit_as_none() {
        for detail in [
            json!({
                "error": "storage_limit_exceeded",
                "message": "Storage limit reached",
                "upgrade_url": "https://inkbox.ai/console/billing"
            }),
            json!({
                "error": "storage_limit_exceeded",
                "message": "Storage limit reached",
                "upgrade_url": "https://inkbox.ai/console/billing",
                "limit_bytes": "unknown"
            }),
        ] {
            let server = MockServer::start();
            let mock = server.mock(|when, then| {
                when.method(POST).path(format!(
                    "/api/v1/mail/mailboxes/{MAILBOX}/messages/{MSG_ID}/reply-all"
                ));
                then.status(402).json_body(json!({ "detail": detail }));
            });
            let err = client(&server)
                .messages()
                .reply_all(MAILBOX, MSG_ID, None, Some("body"), None, None, None)
                .unwrap_err();
            mock.assert();
            match err {
                InkboxError::StorageLimitExceeded { limit_bytes, .. } => {
                    assert_eq!(limit_bytes, None);
                }
                other => panic!("expected InkboxError::StorageLimitExceeded, got {other:?}"),
            }
        }
    }

    #[test]
    fn send_402_with_string_detail_falls_back_to_api_error() {
        // Old server: plain-string detail, no discriminator. Must degrade to the
        // generic Api variant rather than fail to parse.
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/messages"));
            then.status(402)
                .json_body(json!({"detail": "This inbox has reached its storage limit of 2 GiB."}));
        });
        let err = client(&server)
            .messages()
            .send(
                MAILBOX,
                &["dest@example.com".to_string()],
                "hi",
                Some("body"),
                None,
                None,
                None,
                None,
                None,
                false,
            )
            .unwrap_err();
        match err {
            InkboxError::Api {
                status_code,
                detail,
            } => {
                assert_eq!(status_code, 402);
                match detail {
                    ApiErrorDetail::Message(m) => assert!(m.contains("storage limit")),
                    other => panic!("expected message detail, got {other:?}"),
                }
            }
            other => panic!("expected InkboxError::Api, got {other:?}"),
        }
    }

    #[test]
    fn content_id_omitted_when_none() {
        let att = Attachment {
            filename: "doc.pdf".into(),
            content_type: "application/pdf".into(),
            content_base64: "aGk=".into(),
            content_id: None,
        };
        let v = serde_json::to_value(&att).unwrap();
        assert!(v.get("content_id").is_none());
    }

    #[test]
    fn content_id_serialized_when_set() {
        let att = Attachment {
            filename: "chart.png".into(),
            content_type: "image/png".into(),
            content_base64: "aGk=".into(),
            content_id: Some("chart".into()),
        };
        let v = serde_json::to_value(&att).unwrap();
        assert_eq!(v["content_id"], "chart");
    }
}

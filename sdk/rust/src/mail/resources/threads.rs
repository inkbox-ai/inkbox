//! Thread operations: list (auto-paginated), get with messages, folder
//! listing, per-thread update, and delete.

use std::sync::Arc;

use serde_json::Value;

use crate::error::{InkboxError, Result};
use crate::http::HttpTransport;
use crate::mail::types::{Thread, ThreadDetail, ThreadFolder};

const DEFAULT_PAGE_SIZE: i64 = 50;

pub struct ThreadsResource {
    http: Arc<HttpTransport>,
}

impl ThreadsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Fetch all threads in a mailbox, most recent activity first.
    ///
    /// Pagination is handled automatically: every page is fetched and the
    /// threads are collected into a single `Vec`.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox.
    /// * `folder` - Optional folder filter. When `None`, the server returns all
    ///   visible folders for the caller.
    /// * `page_size` - Number of threads fetched per API call (1–100). Pass
    ///   `None` for the default of 50.
    pub fn list(
        &self,
        email_address: &str,
        folder: Option<ThreadFolder>,
        page_size: Option<i64>,
    ) -> Result<Vec<Thread>> {
        let page_size = page_size.unwrap_or(DEFAULT_PAGE_SIZE);
        let folder_value = folder.map(|f| f.as_str().to_string());

        let mut out: Vec<Thread> = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            // `limit` always sent; `cursor` only once we have one; `folder`
            // only when a filter was supplied.
            let mut params: Vec<(&str, String)> = vec![("limit", page_size.to_string())];
            if let Some(c) = &cursor {
                params.push(("cursor", c.clone()));
            }
            if let Some(f) = &folder_value {
                params.push(("folder", f.clone()));
            }
            let page = self
                .http
                .get(&format!("/mailboxes/{email_address}/threads"), &params)?;

            let items = page.get("items").cloned().unwrap_or(Value::Array(vec![]));
            let batch: Vec<Thread> = serde_json::from_value(items)?;
            out.extend(batch);

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

    /// Return the distinct folders that have at least one thread.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the mailbox.
    ///
    /// # Returns
    /// Sorted list of [`ThreadFolder`] values that currently hold at least one
    /// non-deleted thread in this mailbox.
    pub fn list_folders(&self, email_address: &str) -> Result<Vec<ThreadFolder>> {
        let data = self.http.get(
            &format!("/mailboxes/{email_address}/threads/folders"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get a thread with all its messages inlined.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the owning mailbox.
    /// * `thread_id` - UUID of the thread.
    ///
    /// # Returns
    /// Thread detail with all messages (oldest-first).
    pub fn get(&self, email_address: &str, thread_id: &str) -> Result<ThreadDetail> {
        let data = self.http.get(
            &format!("/mailboxes/{email_address}/threads/{thread_id}"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Update mutable thread fields.
    ///
    /// Returns a bare [`Thread`] (no inlined messages). Use [`get`](Self::get)
    /// to refetch with messages attached. Pass `None` for `folder` to leave it
    /// untouched.
    ///
    /// # Arguments
    /// * `email_address` - Full email address of the owning mailbox.
    /// * `thread_id` - UUID of the thread.
    /// * `folder` - New folder — `Inbox` | `Spam` | `Archive`. The `Blocked`
    ///   folder is server-assigned and cannot be set by clients; passing it
    ///   returns [`InkboxError::InvalidArgument`] without making an HTTP call.
    pub fn update(
        &self,
        email_address: &str,
        thread_id: &str,
        folder: Option<ThreadFolder>,
    ) -> Result<Thread> {
        let mut body = serde_json::Map::new();
        if let Some(f) = folder {
            // Reject the server-assigned `blocked` folder client-side, matching
            // the Python `ValueError` raised before any HTTP call.
            if f == ThreadFolder::Blocked {
                return Err(InkboxError::InvalidArgument(
                    "folder='blocked' is server-assigned and cannot be set by \
                     clients — the server will reject this PATCH."
                        .to_string(),
                ));
            }
            body.insert("folder".into(), Value::String(f.as_str().to_string()));
        }
        let data = self.http.patch(
            &format!("/mailboxes/{email_address}/threads/{thread_id}"),
            &Value::Object(body),
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a thread.
    pub fn delete(&self, email_address: &str, thread_id: &str) -> Result<()> {
        self.http
            .delete(&format!("/mailboxes/{email_address}/threads/{thread_id}"))
    }
}

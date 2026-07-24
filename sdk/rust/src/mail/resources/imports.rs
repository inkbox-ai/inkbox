//! Mailbox import lifecycle and direct file upload.

use std::path::Path;
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

use reqwest::blocking::multipart::{Form, Part};
use serde_json::json;

use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};
use crate::mail::types::{
    MailImportCreateResult, MailImportFormat, MailImportJob, MailImportJobPage,
    MailImportUploadTarget,
};

pub struct MailboxImportsResource {
    http: Arc<HttpTransport>,
}

impl MailboxImportsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    fn base(email_address: &str) -> String {
        format!("/mailboxes/{email_address}/imports")
    }

    pub fn create(
        &self,
        email_address: &str,
        source_format: MailImportFormat,
        original_addresses: Option<&[String]>,
        mark_as_read: bool,
    ) -> Result<MailImportCreateResult> {
        let body = json!({
            "source_format": source_format.as_str(),
            "original_addresses": original_addresses,
            "mark_as_read": mark_as_read,
        });
        let value = self
            .http
            .post(&Self::base(email_address), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn refresh_upload_target(
        &self,
        email_address: &str,
        job_id: &str,
    ) -> Result<MailImportUploadTarget> {
        let value = self.http.post::<serde_json::Value>(
            &format!("{}/{job_id}/upload-url", Self::base(email_address)),
            None,
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn upload(
        &self,
        upload_target: &MailImportUploadTarget,
        path: impl AsRef<Path>,
    ) -> Result<()> {
        self.upload_with_timeout(upload_target, path, None)
    }

    pub fn upload_with_timeout(
        &self,
        upload_target: &MailImportUploadTarget,
        path: impl AsRef<Path>,
        timeout: Option<Duration>,
    ) -> Result<()> {
        let path = path.as_ref();
        let mut form = Form::new();
        for (name, value) in &upload_target.fields {
            form = form.text(name.clone(), value.clone());
        }
        let file = Part::file(path).map_err(|error| {
            InkboxError::InvalidArgument(format!("could not open import file: {error}"))
        })?;
        form = form.part("file", file);

        let client = reqwest::blocking::Client::builder()
            .timeout(timeout.unwrap_or(Duration::from_secs(3600)))
            .build()
            .map_err(|error| InkboxError::MailImportUploadTransport {
                detail: error.to_string(),
            })?;
        let response = client
            .post(&upload_target.url)
            .multipart(form)
            .send()
            .map_err(|error| InkboxError::MailImportUploadTransport {
                detail: error.to_string(),
            })?;
        if !response.status().is_success() {
            let status_code = response.status().as_u16();
            let detail = response.text().unwrap_or_default();
            return Err(InkboxError::MailImportUpload {
                status_code,
                detail,
            });
        }
        Ok(())
    }

    pub fn start(&self, email_address: &str, job_id: &str) -> Result<MailImportJob> {
        let value = self.http.post::<serde_json::Value>(
            &format!("{}/{job_id}/start", Self::base(email_address)),
            None,
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn get(&self, email_address: &str, job_id: &str) -> Result<MailImportJob> {
        self.get_with_timeout(email_address, job_id, None)
    }

    fn get_with_timeout(
        &self,
        email_address: &str,
        job_id: &str,
        timeout: Option<Duration>,
    ) -> Result<MailImportJob> {
        let value = self.http.get_with_timeout(
            &format!("{}/{job_id}", Self::base(email_address)),
            NO_QUERY,
            timeout,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn list(
        &self,
        email_address: &str,
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<MailImportJobPage> {
        let mut params = vec![("limit", limit.to_string())];
        if let Some(cursor) = cursor {
            params.push(("cursor", cursor.to_string()));
        }
        let value = self.http.get(&Self::base(email_address), &params)?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn cancel(&self, email_address: &str, job_id: &str) -> Result<MailImportJob> {
        let value = self.http.post::<serde_json::Value>(
            &format!("{}/{job_id}/cancel", Self::base(email_address)),
            None,
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(value)?)
    }

    pub fn wait(
        &self,
        email_address: &str,
        job_id: &str,
        timeout: Option<Duration>,
        poll_interval: Option<Duration>,
    ) -> Result<MailImportJob> {
        let poll_interval = poll_interval.unwrap_or(Duration::from_secs(5));
        if poll_interval.is_zero() {
            return Err(InkboxError::InvalidArgument(
                "poll_interval must be greater than zero".into(),
            ));
        }
        let started = Instant::now();
        loop {
            let remaining = match timeout {
                Some(timeout) => Some(timeout.checked_sub(started.elapsed()).ok_or_else(|| {
                    InkboxError::InvalidArgument(format!(
                        "timed out waiting for import job {job_id}"
                    ))
                })?),
                None => None,
            };
            let job = match self.get_with_timeout(email_address, job_id, remaining) {
                Err(InkboxError::Transport(error)) if timeout.is_some() && error.is_timeout() => {
                    return Err(InkboxError::InvalidArgument(format!(
                        "timed out waiting for import job {job_id}"
                    )));
                }
                result => result?,
            };
            if job.status.is_terminal() {
                return Ok(job);
            }
            let delay = match timeout {
                Some(timeout) => {
                    let remaining = timeout.checked_sub(started.elapsed()).ok_or_else(|| {
                        InkboxError::InvalidArgument(format!(
                            "timed out waiting for import job {job_id}"
                        ))
                    })?;
                    poll_interval.min(remaining)
                }
                None => poll_interval,
            };
            thread::sleep(delay);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::time::Duration;

    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;
    use crate::error::InkboxError;
    use crate::mail::types::{MailImportFormat, MailImportJobStatus, MailImportUploadTarget};

    const MAILBOX: &str = "archive@example.com";
    const JOB_ID: &str = "11111111-1111-1111-1111-111111111111";

    fn job(status: &str) -> serde_json::Value {
        json!({
            "id": JOB_ID,
            "mailbox_id": "22222222-2222-2222-2222-222222222222",
            "status": status,
            "source_format": "zip",
            "original_addresses": ["old@example.com"],
            "mark_as_read": true,
            "upload_size_bytes": 123,
            "messages_processed": 4,
            "messages_imported": 2,
            "messages_skipped_duplicate": 1,
            "messages_failed": 0,
            "messages_rejected_unsafe": 1,
            "error_detail": null,
            "created_at": "2026-07-24T12:00:00Z",
            "updated_at": "2026-07-24T12:01:00Z",
            "started_at": "2026-07-24T12:00:10Z",
            "finished_at": null
        })
    }

    #[test]
    fn create_and_wait_parse_jobs() {
        let server = MockServer::start();
        let create = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/imports"))
                .json_body(json!({
                    "source_format": "zip",
                    "original_addresses": ["old@example.com"],
                    "mark_as_read": false
                }));
            then.status(201).json_body(json!({
                "job": job("pending_upload"),
                "upload": {"url": "https://uploads.example.test", "fields": {}, "expires_in_seconds": 60}
            }));
        });
        let terminal = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/mail/mailboxes/{MAILBOX}/imports/{JOB_ID}"));
            then.status(200).json_body(job("failed"));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let imports = client.mailboxes().imports();
        let addresses = vec!["old@example.com".to_string()];
        let result = imports
            .create(MAILBOX, MailImportFormat::Zip, Some(&addresses), false)
            .unwrap();
        assert_eq!(result.job.status, MailImportJobStatus::PendingUpload);
        let result = imports
            .wait(MAILBOX, JOB_ID, None, Some(Duration::from_millis(1)))
            .unwrap();
        assert_eq!(result.status, MailImportJobStatus::Failed);
        create.assert();
        terminal.assert();
    }

    #[test]
    fn upload_is_file_backed_and_sends_no_api_key() {
        let server = MockServer::start();
        let authenticated = server.mock(|when, then| {
            when.method(POST)
                .path("/upload")
                .header("x-api-key", "test-key");
            then.status(500);
        });
        let upload = server.mock(|when, then| {
            when.method(POST)
                .path("/upload")
                .body_contains("message.eml")
                .body_contains("Subject: Test");
            then.status(204);
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let path = std::env::temp_dir().join(format!("inkbox-{JOB_ID}-message.eml"));
        fs::write(&path, b"Subject: Test\n\nBody").unwrap();
        let target = MailImportUploadTarget {
            url: format!("{}/upload", server.base_url()),
            fields: Default::default(),
            expires_in_seconds: 60,
        };
        client.mailboxes().imports().upload(&target, &path).unwrap();
        fs::remove_file(path).unwrap();
        upload.assert();
        assert_eq!(authenticated.hits(), 0);
    }

    #[test]
    fn upload_error_is_distinct() {
        let server = MockServer::start();
        server.mock(|when, then| {
            when.method(POST).path("/upload");
            then.status(403).body("denied");
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let path = std::env::temp_dir().join(format!("inkbox-{JOB_ID}-denied.eml"));
        fs::write(&path, b"x").unwrap();
        let target = MailImportUploadTarget {
            url: format!("{}/upload", server.base_url()),
            fields: Default::default(),
            expires_in_seconds: 60,
        };
        let error = client
            .mailboxes()
            .imports()
            .upload(&target, &path)
            .unwrap_err();
        fs::remove_file(path).unwrap();
        assert!(matches!(
            error,
            InkboxError::MailImportUpload {
                status_code: 403,
                ..
            }
        ));
    }
}

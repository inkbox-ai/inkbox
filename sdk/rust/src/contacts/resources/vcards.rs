//! vCard import / export.
//!
//! Port of `inkbox/contacts/resources/vcards.py`.

use std::sync::Arc;

use crate::contacts::types::{ContactImportResult, ContactVCardExportResult};
use crate::error::{InkboxError, Result};
use crate::http::{validate_idempotency_key, HttpTransport, NO_HEADERS, NO_QUERY};

const BASE: &str = "/contacts";
const VCARD_CONTENT_TYPE: &str = "text/vcard";

pub struct VCardsResource {
    http: Arc<HttpTransport>,
}

impl VCardsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Bulk-import vCards.
    ///
    /// # Arguments
    /// * `content` - Raw vCard bytes. The server caps payload size at 5 MiB and
    ///   at most 1000 cards. Zero cards returns 422.
    /// * `content_type` - MIME type to send. Pass `None` for the default
    ///   `text/vcard`; `text/x-vcard` is also accepted.
    pub fn import_vcards(
        &self,
        content: Vec<u8>,
        content_type: Option<&str>,
    ) -> Result<ContactImportResult> {
        self.import_vcards_with_idempotency_key(content, content_type, None)
    }

    /// Bulk-import vCards with an optional retry-safe idempotency key.
    pub fn import_vcards_with_idempotency_key(
        &self,
        content: Vec<u8>,
        content_type: Option<&str>,
        idempotency_key: Option<&str>,
    ) -> Result<ContactImportResult> {
        let content_type = content_type.unwrap_or(VCARD_CONTENT_TYPE);
        let idempotency_header;
        let headers = if let Some(key) = idempotency_key {
            validate_idempotency_key(key)?;
            idempotency_header = [("Idempotency-Key", key)];
            idempotency_header.as_slice()
        } else {
            NO_HEADERS
        };
        let data = self.http.post_bytes_with_headers(
            &format!("{BASE}/import"),
            content,
            content_type,
            "application/json",
            headers,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Export a single contact as vCard 4.0 text.
    ///
    /// Returns the raw vCard body as a UTF-8 string.
    pub fn export_vcard(&self, contact_id: &str) -> Result<String> {
        let bytes = self.http.get_bytes(
            &format!("{BASE}/{contact_id}.vcf"),
            VCARD_CONTENT_TYPE,
            NO_QUERY,
        )?;
        // Decode the response body, surfacing invalid UTF-8 as an argument error.
        String::from_utf8(bytes).map_err(|e| {
            InkboxError::InvalidArgument(format!("vCard body is not valid UTF-8: {e}"))
        })
    }

    /// Export up to 25 contacts as one vCard document.
    pub fn export_vcards(&self, contact_ids: &[String]) -> Result<ContactVCardExportResult> {
        let body = serde_json::json!({ "contact_ids": contact_ids });
        let data = self
            .http
            .post(&format!("{BASE}/vcard-export"), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use crate::client::Inkbox;

    #[test]
    fn supports_idempotent_import_and_batch_export() {
        let server = MockServer::start();
        let import = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts/import")
                .header("Idempotency-Key", "import-vcard-1");
            then.status(200).json_body(json!({
                "created_count": 0,
                "error_count": 0,
                "results": []
            }));
        });
        let export = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts/vcard-export")
                .json_body(json!({"contact_ids": ["contact-1"]}));
            then.status(200).json_body(json!({
                "content_type": "text/vcard; charset=utf-8",
                "contact_count": 1,
                "vcard": "BEGIN:VCARD\r\nEND:VCARD\r\n"
            }));
        });
        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();

        sdk.contacts()
            .vcards()
            .import_vcards_with_idempotency_key(
                b"BEGIN:VCARD\r\nEND:VCARD\r\n".to_vec(),
                None,
                Some("import-vcard-1"),
            )
            .unwrap();
        let result = sdk
            .contacts()
            .vcards()
            .export_vcards(&["contact-1".into()])
            .unwrap();

        import.assert();
        export.assert();
        assert_eq!(result.contact_count, 1);
    }
}

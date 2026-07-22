//! vCard import / export.
//!
//! Port of `inkbox/contacts/resources/vcards.py`.

use std::sync::Arc;

use crate::contacts::types::{ContactImportResult, ContactVCardExportResult};
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

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
        let content_type = content_type.unwrap_or(VCARD_CONTENT_TYPE);
        let data = self.http.post_bytes(
            &format!("{BASE}/import"),
            content,
            content_type,
            "application/json",
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
    fn supports_import_and_batch_export() {
        let server = MockServer::start();
        let import = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts/import")
                .header("Content-Type", "text/vcard");
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
            .import_vcards(b"BEGIN:VCARD\r\nEND:VCARD\r\n".to_vec(), None)
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

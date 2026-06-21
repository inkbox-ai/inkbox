//! vCard import / export.
//!
//! Port of `inkbox/contacts/resources/vcards.py`.

use std::sync::Arc;

use crate::contacts::types::ContactImportResult;
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
        // Import POSTs raw bytes; the server replies with a JSON import report.
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
}

//! Transcript retrieval.

use std::sync::Arc;

use crate::error::Result;
use crate::http::HttpTransport;
use crate::phone::types::PhoneTranscript;

pub struct TranscriptsResource {
    http: Arc<HttpTransport>,
}

impl TranscriptsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// List all transcript segments for a call, ordered by sequence number.
    ///
    /// # Arguments
    /// * `phone_number_id` - UUID (or string) of the phone number.
    /// * `call_id` - UUID (or string) of the call.
    pub fn list(&self, phone_number_id: &str, call_id: &str) -> Result<Vec<PhoneTranscript>> {
        let data = self.http.get(
            &format!("/numbers/{phone_number_id}/calls/{call_id}/transcripts"),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }
}

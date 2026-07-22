//! Unified correspondence retrieval for a contact.

use std::sync::Arc;

use uuid::Uuid;

use crate::contacts::correspondence::{
    ContactCorrespondence, CorrespondenceChannel, CorrespondenceContentMode, CorrespondenceOrder,
    CorrespondenceTranscriptMode,
};
use crate::error::Result;
use crate::http::HttpTransport;

const BASE: &str = "/contacts";

#[derive(Debug, Clone, Default)]
pub struct CorrespondenceQuery {
    pub channels: Vec<CorrespondenceChannel>,
    pub after: Option<String>,
    pub before: Option<String>,
    pub limit_per_channel: Option<u64>,
    pub email_limit: Option<u64>,
    pub sms_limit: Option<u64>,
    pub imessage_limit: Option<u64>,
    pub calls_limit: Option<u64>,
    pub cursor: Option<String>,
    pub order: Option<CorrespondenceOrder>,
    pub content: Option<CorrespondenceContentMode>,
    pub transcripts: Option<CorrespondenceTranscriptMode>,
    pub include_failed: Option<bool>,
    pub identity_id: Option<Uuid>,
}

pub struct ContactCorrespondenceResource {
    http: Arc<HttpTransport>,
}

impl ContactCorrespondenceResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Return chronologically merged correspondence for one contact and identity.
    pub fn get(
        &self,
        contact_id: &str,
        query: &CorrespondenceQuery,
    ) -> Result<ContactCorrespondence> {
        let mut params: Vec<(&str, String)> = Vec::new();
        for channel in &query.channels {
            params.push(("channels", channel.as_str().to_string()));
        }
        push_option(&mut params, "after", query.after.as_ref());
        push_option(&mut params, "before", query.before.as_ref());
        push_display(&mut params, "limit_per_channel", query.limit_per_channel);
        push_display(&mut params, "email_limit", query.email_limit);
        push_display(&mut params, "sms_limit", query.sms_limit);
        push_display(&mut params, "imessage_limit", query.imessage_limit);
        push_display(&mut params, "calls_limit", query.calls_limit);
        push_option(&mut params, "cursor", query.cursor.as_ref());
        if let Some(order) = query.order {
            params.push(("order", order.as_str().to_string()));
        }
        if let Some(content) = query.content {
            params.push(("content", content.as_str().to_string()));
        }
        if let Some(transcripts) = query.transcripts {
            params.push(("transcripts", transcripts.as_str().to_string()));
        }
        push_display(&mut params, "include_failed", query.include_failed);
        push_display(&mut params, "identity_id", query.identity_id);

        let data = self
            .http
            .get(&format!("{BASE}/{contact_id}/correspondence"), &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Alias for [`Self::get`].
    pub fn list(
        &self,
        contact_id: &str,
        query: &CorrespondenceQuery,
    ) -> Result<ContactCorrespondence> {
        self.get(contact_id, query)
    }
}

fn push_option(
    params: &mut Vec<(&'static str, String)>,
    key: &'static str,
    value: Option<&String>,
) {
    if let Some(value) = value {
        params.push((key, value.clone()));
    }
}

fn push_display<T: ToString>(
    params: &mut Vec<(&'static str, String)>,
    key: &'static str,
    value: Option<T>,
) {
    if let Some(value) = value {
        params.push((key, value.to_string()));
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;
    use uuid::Uuid;

    use crate::client::Inkbox;
    use crate::contacts::{
        CorrespondenceChannel, CorrespondenceContentMode, CorrespondenceOrder, CorrespondenceQuery,
    };

    #[test]
    fn sends_correspondence_query_options() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts/11111111-1111-1111-1111-111111111111/correspondence")
                .query_param("channels", "email")
                .query_param("content", "full")
                .query_param("order", "asc")
                .query_param("identity_id", "22222222-2222-2222-2222-222222222222");
            then.status(200).json_body(json!({
                "contact_id": "11111111-1111-1111-1111-111111111111",
                "identity_id": "22222222-2222-2222-2222-222222222222",
                "items": [],
                "channels": [{"channel": "email", "status": "available", "returned": 0}],
                "next_cursor": null
            }));
        });

        let sdk = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        let result = sdk
            .contacts()
            .correspondence()
            .get(
                "11111111-1111-1111-1111-111111111111",
                &CorrespondenceQuery {
                    channels: vec![CorrespondenceChannel::Email],
                    content: Some(CorrespondenceContentMode::Full),
                    order: Some(CorrespondenceOrder::Asc),
                    identity_id: Some(
                        Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap(),
                    ),
                    ..Default::default()
                },
            )
            .unwrap();

        mock.assert();
        assert!(result.items.is_empty());
        assert_eq!(result.channels[0].channel, CorrespondenceChannel::Email);
    }
}

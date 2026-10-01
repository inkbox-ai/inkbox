//! Recover the original message ID after losing a send response.

use crate::error::Result;
use crate::http::{validate_message_key, HttpTransport};
use std::sync::Arc;
use uuid::Uuid;

pub struct MessageSendsResource {
    http: Arc<HttpTransport>,
    mail: Arc<HttpTransport>,
}

impl MessageSendsResource {
    pub(crate) fn new(http: Arc<HttpTransport>, mail: Arc<HttpTransport>) -> Self {
        Self { http, mail }
    }

    /// Read the original ID without sending. Read its channel resource for status.
    pub fn lookup(
        &self,
        sender_kind: &str,
        sender_id: &Uuid,
        operation: &str,
        key: &str,
    ) -> Result<Uuid> {
        validate_message_key(key)?;
        let params = vec![
            ("sender_kind", sender_kind.to_string()),
            ("sender_id", sender_id.to_string()),
            ("operation", operation.to_string()),
        ];
        let data = self.http.get_with_headers(
            "/message-sends/lookup",
            &params,
            &[("Idempotency-Key", key)],
        )?;
        Ok(serde_json::from_value(data["message_id"].clone())?)
    }

    /// Resolve a sending mailbox by address before looking up its message key.
    pub fn lookup_email(&self, email_address: &str, operation: &str, key: &str) -> Result<Uuid> {
        let mailbox = self.mail.get(
            &format!("/mailboxes/{email_address}"),
            crate::http::NO_QUERY,
        )?;
        let id = serde_json::from_value(mailbox["id"].clone())?;
        self.lookup("mailbox", &id, operation, key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Inkbox;
    use httpmock::prelude::*;
    use serde_json::json;

    #[test]
    fn email_lookup_resolves_mailbox_and_keeps_the_key_out_of_the_url() {
        let server = MockServer::start();
        let mailbox = Uuid::new_v4();
        let message = Uuid::new_v4();
        let address = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/mail/mailboxes/agent@example.com");
            then.status(200).json_body(json!({"id": mailbox}));
        });
        let lookup = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/message-sends/lookup")
                .query_param("sender_kind", "mailbox")
                .query_param("sender_id", mailbox.to_string())
                .query_param("operation", "mail.send")
                .header("Idempotency-Key", "original");
            then.status(200).json_body(json!({"message_id": message}));
        });
        let client = Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap();
        assert_eq!(
            client
                .message_sends()
                .lookup_email("agent@example.com", "mail.send", "original")
                .unwrap(),
            message
        );
        address.assert();
        lookup.assert();
    }
}

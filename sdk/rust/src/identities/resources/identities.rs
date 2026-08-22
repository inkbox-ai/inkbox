//! Identity CRUD. Mailbox and tunnel are provisioned atomically by
//! [`IdentitiesResource::create`]; there is no standalone mailbox / tunnel
//! create surface.
//!
//! Faithful port of `inkbox/identities/resources/identities.py`. Every path,
//! query param, and request body matches the Python source exactly. The
//! resource is mounted at the identities base URL, so all paths are relative
//! (`"/"`, `"/{agent_handle}"`, ...) — matching the Python which posts to `"/"`.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::error::Result;
use crate::http::{validate_idempotency_key, HttpTransport};
use crate::identities::exceptions::map_identity_conflict_error;
use crate::identities::types::{
    AgentIdentityData, AgentIdentitySummary, IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions, IdentityTunnelCreateOptions, Unset, VaultSecretIds,
};
use uuid::Uuid;

pub struct IdentitiesResource {
    http: Arc<HttpTransport>,
}

impl IdentitiesResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self { http }
    }

    /// Create a new agent identity. Atomically provisions the identity's
    /// mailbox and tunnel; both are returned nested on the response.
    ///
    /// # Arguments
    /// * `agent_handle` - Unique handle, globally unique across all orgs (the
    ///   handle shares its namespace with tunnel names). May be passed with or
    ///   without a leading `@`.
    /// * `display_name` - Human-readable identity name. `None` omits the key;
    ///   the server defaults it to `agent_handle`.
    /// * `description` - Free-form org-internal description. `Unset::Value(None)`
    ///   leaves the column null; `Unset::Omit` defers to the server default.
    /// * `imessage_enabled` - Whether the identity can be reached over
    ///   iMessage. `None` omits the key (server default `false`).
    /// * `mailbox` / `tunnel` / `phone_number` - Optional nested specs.
    /// * `vault_secret_ids` - Optional vault secret selection to attach.
    ///
    /// # Returns
    /// The created identity with `mailbox` and `tunnel` populated from the
    /// atomic create response.
    #[allow(clippy::too_many_arguments)]
    pub fn create(
        &self,
        agent_handle: &str,
        display_name: Option<&str>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        mailbox: Option<&IdentityMailboxCreateOptions>,
        tunnel: Option<&IdentityTunnelCreateOptions>,
        phone_number: Option<&IdentityPhoneNumberCreateOptions>,
        vault_secret_ids: Option<&VaultSecretIds>,
    ) -> Result<AgentIdentityData> {
        self.create_with_imessage_number(
            agent_handle,
            display_name,
            description,
            imessage_enabled,
            mailbox,
            tunnel,
            phone_number,
            vault_secret_ids,
            None,
        )
    }

    /// Create an identity and optionally claim and attach a dedicated iMessage
    /// number in the same operation.
    ///
    /// `imessage_enabled` must be `Some(true)` when claiming a line.
    #[allow(clippy::too_many_arguments)]
    pub fn create_with_imessage_number(
        &self,
        agent_handle: &str,
        display_name: Option<&str>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        mailbox: Option<&IdentityMailboxCreateOptions>,
        tunnel: Option<&IdentityTunnelCreateOptions>,
        phone_number: Option<&IdentityPhoneNumberCreateOptions>,
        vault_secret_ids: Option<&VaultSecretIds>,
        claim_imessage_number: Option<bool>,
    ) -> Result<AgentIdentityData> {
        self.create_with_contact_sharing_and_imessage_number(
            agent_handle,
            display_name,
            description,
            imessage_enabled,
            None,
            mailbox,
            tunnel,
            phone_number,
            vault_secret_ids,
            claim_imessage_number,
        )
    }

    /// Create an identity while explicitly controlling automatic contact
    /// sharing and optionally claiming a dedicated iMessage number atomically.
    #[allow(clippy::too_many_arguments)]
    pub fn create_with_contact_sharing_and_imessage_number(
        &self,
        agent_handle: &str,
        display_name: Option<&str>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        contact_sharing_enabled: Option<bool>,
        mailbox: Option<&IdentityMailboxCreateOptions>,
        tunnel: Option<&IdentityTunnelCreateOptions>,
        phone_number: Option<&IdentityPhoneNumberCreateOptions>,
        vault_secret_ids: Option<&VaultSecretIds>,
        claim_imessage_number: Option<bool>,
    ) -> Result<AgentIdentityData> {
        if claim_imessage_number == Some(false) {
            return Err(crate::error::InkboxError::InvalidArgument(
                "claim_imessage_number only accepts true when supplied".into(),
            ));
        }
        if claim_imessage_number == Some(true) && imessage_enabled != Some(true) {
            return Err(crate::error::InkboxError::InvalidArgument(
                "claim_imessage_number requires imessage_enabled=true".into(),
            ));
        }
        // Build the body conditionally, omitting any field left unset/None,
        // matching the Python dict-building exactly.
        let mut body = Map::new();
        body.insert(
            "agent_handle".into(),
            Value::String(agent_handle.to_string()),
        );
        if let Some(name) = display_name {
            body.insert("display_name".into(), Value::String(name.to_string()));
        }
        // `description` honours the three-way sentinel: omit vs explicit null.
        if let Unset::Value(d) = &description {
            body.insert(
                "description".into(),
                match d {
                    Some(s) => Value::String(s.clone()),
                    None => Value::Null,
                },
            );
        }
        if let Some(flag) = imessage_enabled {
            body.insert("imessage_enabled".into(), Value::Bool(flag));
        }
        if let Some(flag) = contact_sharing_enabled {
            body.insert("contact_sharing_enabled".into(), Value::Bool(flag));
        }
        if claim_imessage_number == Some(true) {
            body.insert("claim_imessage_number".into(), Value::Bool(true));
        }
        if let Some(m) = mailbox {
            body.insert("mailbox".into(), m.to_wire());
        }
        if let Some(t) = tunnel {
            body.insert("tunnel".into(), t.to_wire());
        }
        if let Some(p) = phone_number {
            // `to_wire` validates the same invariants the Python `ValueError`s on.
            body.insert("phone_number".into(), p.to_wire()?);
        }
        if let Some(ids) = vault_secret_ids {
            body.insert("vault_secret_ids".into(), ids.to_wire());
        }

        let body = Value::Object(body);
        let data = self
            .http
            .post("/", Some(&body), crate::http::NO_QUERY)
            // Map a 409 handle collision to the typed view (see exceptions.rs).
            .map_err(map_identity_conflict_error)?;
        AgentIdentityData::from_value(data)
    }

    /// List identities visible to this credential.
    ///
    /// Agent-scoped credentials return only their own identity. Use the A2A
    /// organization directory to discover peers.
    pub fn list(&self) -> Result<Vec<AgentIdentitySummary>> {
        let data = self.http.get("/", crate::http::NO_QUERY)?;
        let items: Vec<Value> = serde_json::from_value(data)?;
        items
            .into_iter()
            .map(AgentIdentitySummary::from_value)
            .collect()
    }

    /// Get an identity with its linked channels (mailbox, phone number, tunnel).
    pub fn get(&self, agent_handle: &str) -> Result<AgentIdentityData> {
        let data = self
            .http
            .get(&format!("/{agent_handle}"), crate::http::NO_QUERY)?;
        AgentIdentityData::from_value(data)
    }

    /// Toggle automatic name and optional photo sharing for an attached
    /// dedicated iMessage line.
    pub fn set_contact_sharing_enabled(
        &self,
        agent_handle: &str,
        enabled: bool,
    ) -> Result<AgentIdentityData> {
        let body = serde_json::json!({ "contact_sharing_enabled": enabled });
        let data = self
            .http
            .patch(&format!("/{agent_handle}"), &body)
            .map_err(map_identity_conflict_error)?;
        AgentIdentityData::from_value(data)
    }

    /// Update an identity's handle, display name, description, iMessage
    /// reachability and contact-rule filter modes.
    ///
    /// Only provided fields are applied; omitted fields are left unchanged. For
    /// `display_name` and `description`, `Unset::Value(None)` clears the column;
    /// `Unset::Omit` leaves it untouched.
    ///
    /// # Arguments
    /// * `agent_handle` - Current handle of the identity to update.
    /// * `new_handle` - New handle value (`None` omits the key).
    /// * `display_name` - New display name, or `Unset::Value(None)` to clear.
    /// * `description` - New description, or `Unset::Value(None)` to clear.
    /// * `imessage_enabled` - Toggle identity-level iMessage reachability.
    /// * `imessage_filter_mode` - `"whitelist"` or `"blacklist"` (admin-only).
    /// * `mail_filter_mode` - `"whitelist"` or `"blacklist"` for this identity's
    ///   mail contact rules (admin-only).
    /// * `phone_filter_mode` - `"whitelist"` or `"blacklist"` for this identity's
    ///   phone contact rules (admin-only). The server rejects this with 422 when
    ///   the identity has no phone number.
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &self,
        agent_handle: &str,
        new_handle: Option<&str>,
        display_name: Unset<String>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        imessage_filter_mode: Option<&str>,
        mail_filter_mode: Option<&str>,
        phone_filter_mode: Option<&str>,
    ) -> Result<AgentIdentitySummary> {
        self.update_with_imessage_number(
            agent_handle,
            new_handle,
            display_name,
            description,
            imessage_enabled,
            imessage_filter_mode,
            mail_filter_mode,
            phone_filter_mode,
            Unset::Omit,
            None,
            None,
        )
        .map(|data| data.summary)
    }

    /// Update an identity and optionally change its dedicated iMessage line.
    ///
    /// `imessage_number_id` distinguishes omission from explicit `null`:
    /// `Unset::Value(None)` moves the identity back to shared iMessage service,
    /// while `Unset::Value(Some(id))` attaches an already-owned number.
    /// `claim_imessage_number` atomically claims and attaches a new line and cannot
    /// be combined with an explicit `imessage_number_id`.
    #[allow(clippy::too_many_arguments)]
    pub fn update_with_imessage_number(
        &self,
        agent_handle: &str,
        new_handle: Option<&str>,
        display_name: Unset<String>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        imessage_filter_mode: Option<&str>,
        mail_filter_mode: Option<&str>,
        phone_filter_mode: Option<&str>,
        imessage_number_id: Unset<Uuid>,
        claim_imessage_number: Option<bool>,
        idempotency_key: Option<&str>,
    ) -> Result<AgentIdentityData> {
        self.update_with_contact_sharing_and_imessage_number(
            agent_handle,
            new_handle,
            display_name,
            description,
            imessage_enabled,
            None,
            imessage_filter_mode,
            mail_filter_mode,
            phone_filter_mode,
            imessage_number_id,
            claim_imessage_number,
            idempotency_key,
        )
    }

    /// Update an identity while explicitly controlling automatic contact
    /// sharing and optionally changing its dedicated iMessage line atomically.
    #[allow(clippy::too_many_arguments)]
    pub fn update_with_contact_sharing_and_imessage_number(
        &self,
        agent_handle: &str,
        new_handle: Option<&str>,
        display_name: Unset<String>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        contact_sharing_enabled: Option<bool>,
        imessage_filter_mode: Option<&str>,
        mail_filter_mode: Option<&str>,
        phone_filter_mode: Option<&str>,
        imessage_number_id: Unset<Uuid>,
        claim_imessage_number: Option<bool>,
        idempotency_key: Option<&str>,
    ) -> Result<AgentIdentityData> {
        if claim_imessage_number == Some(false) {
            return Err(crate::error::InkboxError::InvalidArgument(
                "claim_imessage_number only accepts true when supplied".into(),
            ));
        }
        let has_number_id = !imessage_number_id.is_omit();
        let attaches_number_id = matches!(&imessage_number_id, Unset::Value(Some(_)));
        if claim_imessage_number == Some(true) && has_number_id {
            return Err(crate::error::InkboxError::InvalidArgument(
                "claim_imessage_number and imessage_number_id cannot be set together".into(),
            ));
        }
        if imessage_enabled == Some(false)
            && (claim_imessage_number == Some(true) || attaches_number_id)
        {
            return Err(crate::error::InkboxError::InvalidArgument(
                "iMessage number changes cannot be combined with disabling iMessage".into(),
            ));
        }
        if claim_imessage_number == Some(true) && idempotency_key.is_none() {
            return Err(crate::error::InkboxError::InvalidArgument(
                "idempotency_key is required when claim_imessage_number is set".into(),
            ));
        }
        if let Some(key) = idempotency_key {
            validate_idempotency_key(key)?;
        }
        let mut body = Map::new();
        if let Some(h) = new_handle {
            // Note: the body key is `agent_handle`, not `new_handle`.
            body.insert("agent_handle".into(), Value::String(h.to_string()));
        }
        if let Unset::Value(d) = &display_name {
            body.insert(
                "display_name".into(),
                match d {
                    Some(s) => Value::String(s.clone()),
                    None => Value::Null,
                },
            );
        }
        if let Unset::Value(d) = &description {
            body.insert(
                "description".into(),
                match d {
                    Some(s) => Value::String(s.clone()),
                    None => Value::Null,
                },
            );
        }
        if let Some(flag) = imessage_enabled {
            body.insert("imessage_enabled".into(), Value::Bool(flag));
        }
        if let Some(flag) = contact_sharing_enabled {
            body.insert("contact_sharing_enabled".into(), Value::Bool(flag));
        }
        if let Unset::Value(number_id) = imessage_number_id {
            body.insert(
                "imessage_number_id".into(),
                number_id
                    .map(|id| Value::String(id.to_string()))
                    .unwrap_or(Value::Null),
            );
        }
        if claim_imessage_number == Some(true) {
            body.insert("claim_imessage_number".into(), Value::Bool(true));
        }
        if let Some(mode) = imessage_filter_mode {
            body.insert(
                "imessage_filter_mode".into(),
                Value::String(mode.to_string()),
            );
        }
        if let Some(mode) = mail_filter_mode {
            body.insert("mail_filter_mode".into(), Value::String(mode.to_string()));
        }
        if let Some(mode) = phone_filter_mode {
            body.insert("phone_filter_mode".into(), Value::String(mode.to_string()));
        }
        let body = Value::Object(body);
        let path = format!("/{agent_handle}");
        let response = match idempotency_key {
            Some(key) => {
                let headers = [("Idempotency-Key", key)];
                self.http.patch_with_headers(&path, &body, &headers)
            }
            None => self.http.patch(&path, &body),
        };
        let data = response.map_err(map_identity_conflict_error)?;
        AgentIdentityData::from_value(data)
    }

    /// Delete an identity.
    ///
    /// Cascades: flips the linked mailbox to `deleted`, force-finalizes the
    /// linked tunnel to `deleted`, revokes any identity-scoped API keys, and
    /// releases any linked phone number (vendor + local).
    pub fn delete(&self, agent_handle: &str) -> Result<()> {
        self.http.delete(&format!("/{agent_handle}"))
    }

    /// Release the identity's phone number (vendor + local).
    ///
    /// Released at the carrier; the number is not available for reassignment
    /// afterwards.
    pub fn release_phone_number(&self, agent_handle: &str) -> Result<()> {
        self.http.delete(&format!("/{agent_handle}/phone_number"))
    }
}

#[cfg(test)]
mod tests {
    use httpmock::prelude::*;
    use serde_json::json;

    use super::*;
    use crate::client::Inkbox;
    use crate::imessage::types::IdentityIMessageNumber;

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    fn identity_json() -> serde_json::Value {
        json!({
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_test",
            "agent_handle": "support-bot",
            "created_at": "2026-07-01T00:00:00+00:00",
            "updated_at": "2026-07-01T00:00:00+00:00",
            "imessage_enabled": true,
            "imessage_number": {
                "id": "22222222-2222-2222-2222-222222222222",
                "number": "+15550001111",
                "type": "dedicated_outbound",
            }
        })
    }

    fn identity_list_detail_json() -> serde_json::Value {
        let mut identity = identity_json();
        let object = identity.as_object_mut().unwrap();
        object.insert(
            "mailbox".into(),
            json!({
                "id": "33333333-3333-3333-3333-333333333333",
                "email_address": "support-bot@inkbox.ai",
                "created_at": "2026-07-01T00:00:00+00:00",
                "updated_at": "2026-07-01T00:00:00+00:00"
            }),
        );
        object.insert(
            "tunnel".into(),
            json!({
                "id": "44444444-4444-4444-4444-444444444444",
                "tunnel_name": "support-bot",
                "agent_identity_id": "11111111-1111-1111-1111-111111111111",
                "tls_mode": "edge",
                "status": "active",
                "public_host": "support-bot.inkboxwire.com",
                "zone": "inkboxwire.com",
                "created_at": "2026-07-01T00:00:00+00:00",
                "updated_at": "2026-07-01T00:00:00+00:00"
            }),
        );
        identity
    }

    #[test]
    fn list_preserves_hydrated_fields() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/");
            then.status(200)
                .json_body(json!([identity_list_detail_json()]));
        });

        let identities = client(&server).identities().list().unwrap();

        mock.assert();
        assert_eq!(
            identities[0].mailbox.as_ref().unwrap().email_address,
            "support-bot@inkbox.ai"
        );
        assert_eq!(
            identities[0].tunnel.as_ref().unwrap().tunnel_name,
            "support-bot"
        );
    }

    #[test]
    fn list_accepts_older_summary_response() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(GET).path("/api/v1/identities/");
            then.status(200).json_body(json!([identity_json()]));
        });

        let identities = client(&server).identities().list().unwrap();

        mock.assert();
        assert_eq!(identities[0].agent_handle, "support-bot");
        assert!(identities[0].contact_sharing_enabled);
        assert!(identities[0].mailbox.is_none());
        assert!(identities[0].tunnel.is_none());
    }

    #[test]
    fn updates_contact_sharing_without_changing_existing_update_signatures() {
        let server = MockServer::start();
        let mut response = identity_list_detail_json();
        response["contact_sharing_enabled"] = json!(false);
        let mock = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path("/api/v1/identities/support-bot")
                .json_body(json!({ "contact_sharing_enabled": false }));
            then.status(200).json_body(response);
        });

        let data = client(&server)
            .identities()
            .set_contact_sharing_enabled("support-bot", false)
            .unwrap();

        mock.assert();
        assert!(!data.contact_sharing_enabled);
    }

    #[test]
    fn create_with_imessage_number_sends_claim_and_parses_detail() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/identities/")
                .json_body(json!({
                    "agent_handle": "support-bot",
                    "imessage_enabled": true,
                    "contact_sharing_enabled": false,
                    "claim_imessage_number": true
                }));
            then.status(201).json_body(identity_json());
        });

        let data = client(&server)
            .identities()
            .create_with_contact_sharing_and_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Some(true),
                Some(false),
                None,
                None,
                None,
                None,
                Some(true),
            )
            .unwrap();
        mock.assert();
        let number: IdentityIMessageNumber = data.imessage_number.clone().unwrap();
        assert_eq!(number.r#type, "dedicated_outbound");
    }

    #[test]
    fn create_with_false_claim_is_rejected() {
        let server = MockServer::start();

        let error = client(&server)
            .identities()
            .create_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                None,
                None,
                None,
                None,
                None,
                Some(false),
            )
            .unwrap_err();
        assert!(matches!(
            error,
            crate::error::InkboxError::InvalidArgument(message)
                if message.contains("only accepts true")
        ));
    }

    #[test]
    fn update_with_false_claim_is_rejected() {
        let server = MockServer::start();

        let error = client(&server)
            .identities()
            .update_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                None,
                None,
                None,
                None,
                Unset::Omit,
                Some(false),
                None,
            )
            .unwrap_err();
        assert!(matches!(
            error,
            crate::error::InkboxError::InvalidArgument(message)
                if message.contains("only accepts true")
        ));
    }

    #[test]
    fn update_can_attach_owned_imessage_number() {
        let server = MockServer::start();
        let number_id = Uuid::parse_str("22222222-2222-2222-2222-222222222222").unwrap();
        let mock = server.mock(|when, then| {
            when.method("PATCH")
                .path("/api/v1/identities/support-bot")
                .json_body(json!({ "imessage_number_id": number_id }));
            then.status(200).json_body(identity_json());
        });

        client(&server)
            .identities()
            .update_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                None,
                None,
                None,
                None,
                Unset::Value(Some(number_id)),
                None,
                None,
            )
            .unwrap();
        mock.assert();
    }

    #[test]
    fn update_can_claim_or_clear_imessage_number() {
        let server = MockServer::start();
        let claim = server.mock(|when, then| {
            when.method("PATCH")
                .path("/api/v1/identities/support-bot")
                .header("Idempotency-Key", "identity-claim-123")
                .json_body(json!({
                    "claim_imessage_number": true
                }));
            then.status(200).json_body(identity_json());
        });
        client(&server)
            .identities()
            .update_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                None,
                None,
                None,
                None,
                Unset::Omit,
                Some(true),
                Some("identity-claim-123"),
            )
            .unwrap();
        claim.assert();

        let clear = server.mock(|when, then| {
            when.method("PATCH")
                .path("/api/v1/identities/support-bot")
                .json_body(json!({
                    "imessage_enabled": false,
                    "imessage_number_id": null
                }));
            then.status(200).json_body(identity_json());
        });
        client(&server)
            .identities()
            .update_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                Some(false),
                None,
                None,
                None,
                Unset::Value(None),
                None,
                None,
            )
            .unwrap();
        clear.assert();
    }

    #[test]
    fn update_can_atomically_claim_with_contact_sharing_disabled() {
        let server = MockServer::start();
        let mock = server.mock(|when, then| {
            when.method("PATCH")
                .path("/api/v1/identities/support-bot")
                .header("Idempotency-Key", "identity-claim-contact-sharing-123")
                .json_body(json!({
                    "contact_sharing_enabled": false,
                    "claim_imessage_number": true
                }));
            then.status(200).json_body(identity_json());
        });

        client(&server)
            .identities()
            .update_with_contact_sharing_and_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                None,
                Some(false),
                None,
                None,
                None,
                Unset::Omit,
                Some(true),
                Some("identity-claim-contact-sharing-123"),
            )
            .unwrap();
        mock.assert();
    }

    #[test]
    fn update_claim_requires_idempotency_key() {
        let server = MockServer::start();
        let error = client(&server)
            .identities()
            .update_with_imessage_number(
                "support-bot",
                None,
                Unset::Omit,
                Unset::Omit,
                None,
                None,
                None,
                None,
                Unset::Omit,
                Some(true),
                None,
            )
            .unwrap_err();
        assert!(matches!(
            error,
            crate::error::InkboxError::InvalidArgument(_)
        ));
    }
}

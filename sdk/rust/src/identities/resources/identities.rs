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
use crate::http::HttpTransport;
use crate::identities::exceptions::map_identity_conflict_error;
use crate::identities::types::{
    AgentIdentityData, AgentIdentitySummary, IdentityAccess, IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions, IdentityTunnelCreateOptions, Unset, VaultSecretIds,
};

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
    /// * `imessage_enabled` - Whether the identity can be reached over the
    ///   shared iMessage service. `None` omits the key (server default `false`).
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

    /// List all identities for your organisation.
    pub fn list(&self) -> Result<Vec<AgentIdentitySummary>> {
        let data = self.http.get("/", crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Get an identity with its linked channels (mailbox, phone number, tunnel).
    pub fn get(&self, agent_handle: &str) -> Result<AgentIdentityData> {
        let data = self
            .http
            .get(&format!("/{agent_handle}"), crate::http::NO_QUERY)?;
        AgentIdentityData::from_value(data)
    }

    /// Update an identity's handle, display name, description, iMessage
    /// reachability, and/or status.
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
    /// * `imessage_enabled` - Toggle shared-iMessage reachability.
    /// * `imessage_filter_mode` - `"whitelist"` or `"blacklist"` (admin-only).
    /// * `status` - `"active"` or `"paused"`. Call [`Self::delete`] to remove an
    ///   identity; `"deleted"` is rejected here.
    #[allow(clippy::too_many_arguments)]
    pub fn update(
        &self,
        agent_handle: &str,
        new_handle: Option<&str>,
        display_name: Unset<String>,
        description: Unset<String>,
        imessage_enabled: Option<bool>,
        imessage_filter_mode: Option<&str>,
        status: Option<&str>,
    ) -> Result<AgentIdentitySummary> {
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
        if let Some(mode) = imessage_filter_mode {
            body.insert(
                "imessage_filter_mode".into(),
                Value::String(mode.to_string()),
            );
        }
        if let Some(s) = status {
            body.insert("status".into(), Value::String(s.to_string()));
        }

        let body = Value::Object(body);
        let data = self
            .http
            .patch(&format!("/{agent_handle}"), &body)
            .map_err(map_identity_conflict_error)?;
        Ok(serde_json::from_value(data)?)
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

    /// List who can see this identity (agent visibility).
    ///
    /// Returns either a single wildcard row (`viewer_identity_id=None` — every
    /// active identity in the org sees it) or explicit per-viewer rows. An empty
    /// list means no scoped agent can see this identity (humans and admins
    /// always see it).
    ///
    /// Requires an admin-scoped API key; agent-scoped keys get a 403.
    pub fn list_access(&self, agent_handle: &str) -> Result<Vec<IdentityAccess>> {
        let data = self
            .http
            .get(&format!("/{agent_handle}/access"), crate::http::NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Grant visibility on this identity.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the target identity.
    /// * `viewer_identity_id` - UUID of the viewer identity to grant, or `None`
    ///   to reset the target to the org-wide wildcard (every active identity in
    ///   the org sees it).
    ///
    /// Deliberately NOT wrapped in `map_identity_conflict_error` (unlike create
    /// / update): this route's 409s are not handle collisions, and the wrapper
    /// would downgrade the `RedundantContactAccessGrant` error the transport
    /// already raised.
    pub fn grant_access(
        &self,
        agent_handle: &str,
        viewer_identity_id: Option<&str>,
    ) -> Result<IdentityAccess> {
        let body = serde_json::json!({
            "viewer_identity_id": viewer_identity_id,
        });
        let data = self.http.post(
            &format!("/{agent_handle}/access"),
            Some(&body),
            crate::http::NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Revoke one viewer's visibility on this identity.
    ///
    /// # Arguments
    /// * `agent_handle` - Handle of the target identity.
    /// * `viewer_identity_id` - UUID of the viewer identity to drop. This is the
    ///   viewer identity's UUID, not an access-row id.
    pub fn revoke_access(&self, agent_handle: &str, viewer_identity_id: &str) -> Result<()> {
        self.http
            .delete(&format!("/{agent_handle}/access/{viewer_identity_id}"))
    }
}

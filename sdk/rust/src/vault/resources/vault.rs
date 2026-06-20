//! `VaultResource`: org-level vault operations.
//! `UnlockedVault`: crypto-enabled wrapper for secret CRUD after unlock.
//!
//! Port of `inkbox/vault/resources/vault.py`.

use std::sync::{Arc, Mutex};

use serde_json::{Map, Value};
use uuid::Uuid;

use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};
use crate::vault::crypto::{
    compute_auth_hash, decrypt_payload, derive_master_key, derive_salt, encrypt_payload,
    generate_org_encryption_key, generate_recovery_code, generate_vault_key_material,
    unwrap_org_key,
};
use crate::vault::totp::{generate_totp, parse_totp_uri, TOTPCode, TOTPConfig};
use crate::vault::types::{
    AccessRule, DecryptedVaultSecret, SecretPayload, VaultInfo, VaultInitializeResult, VaultKey,
    VaultKeyType, VaultSecret, VaultSecretDetail,
};

/// Org-level vault operations.
///
/// Obtain via `inkbox.vault`. Most read-only operations work without
/// unlocking. To create, read, or update secret *payloads* call
/// [`VaultResource::unlock`] first.
pub struct VaultResource {
    http: Arc<HttpTransport>,
    api_http: Arc<HttpTransport>,
    // Cached unlocked vault, so `identity.credentials` has the full set to
    // filter from even when `unlock` was called with an `identity_id`.
    unlocked: Mutex<Option<UnlockedVault>>,
}

impl VaultResource {
    /// Create a vault resource.
    ///
    /// # Arguments
    /// * `http` - Transport rooted at the vault API sub-base.
    /// * `api_http` - Transport rooted at the root API sub-base (used by
    ///   [`VaultResource::initialize`] to resolve the organisation ID via
    ///   `/whoami`). Mirrors Python's `VaultResource(self._vault_http,
    ///   api_http=self._root_api_http)`.
    pub fn new(http: Arc<HttpTransport>, api_http: Arc<HttpTransport>) -> Self {
        Self {
            http,
            api_http,
            unlocked: Mutex::new(None),
        }
    }

    // -- Vault metadata --

    /// The cached [`UnlockedVault`], or `None` if not yet unlocked.
    pub fn unlocked(&self) -> Option<UnlockedVault> {
        self.unlocked.lock().unwrap().clone()
    }

    /// Get vault metadata for the caller's organisation.
    ///
    /// # Returns
    /// [`VaultInfo`], or `None` if the vault has not been initialized yet.
    pub fn info(&self) -> Result<Option<VaultInfo>> {
        match self.http.get("/info", NO_QUERY) {
            Ok(data) => Ok(Some(serde_json::from_value(data)?)),
            // A 404 means the vault has not been initialized yet.
            Err(InkboxError::Api {
                status_code: 404, ..
            }) => Ok(None),
            Err(e) => Err(e),
        }
    }

    /// Fetch the organisation ID via `/whoami` (on the API transport).
    fn fetch_organization_id(&self) -> Result<String> {
        let data = self.api_http.get("/whoami", NO_QUERY)?;
        match data.get("organization_id").and_then(|v| v.as_str()) {
            Some(org_id) if !org_id.is_empty() => Ok(org_id.to_string()),
            _ => Err(InkboxError::InvalidArgument(
                "Could not determine organization ID from API key".into(),
            )),
        }
    }

    /// Initialize a new vault for the organisation.
    ///
    /// Generates a random org encryption key, wraps it with the provided vault
    /// key, and creates four recovery codes. All cryptographic material is
    /// generated client-side; the server only receives ciphertexts and
    /// identifiers.
    ///
    /// # Arguments
    /// * `vault_key` - The vault key (password) protecting the vault. Must be
    ///   at least 16 characters with uppercase, lowercase, digit, and special
    ///   character.
    ///
    /// # Returns
    /// [`VaultInitializeResult`] with the vault ID, primary key ID, and
    /// recovery codes. The recovery codes cannot be retrieved again.
    pub fn initialize(&self, vault_key: &str) -> Result<VaultInitializeResult> {
        let organization_id = self.fetch_organization_id()?;

        let org_encryption_key = generate_org_encryption_key();

        let primary_material = generate_vault_key_material(
            vault_key,
            &organization_id,
            &org_encryption_key,
            VaultKeyType::Primary,
        )?;

        // Generate four recovery codes and collect their wire material.
        let mut recovery_codes: Vec<String> = Vec::new();
        let mut recovery_wires: Vec<Value> = Vec::new();
        for _ in 0..4 {
            let (code, material) = generate_recovery_code(&organization_id, &org_encryption_key)?;
            recovery_codes.push(code);
            recovery_wires.push(material.to_wire());
        }

        let body = serde_json::json!({
            "vault_key": primary_material.to_wire(),
            "recovery_keys": recovery_wires,
        });
        let data = self.http.post("/initialize", Some(&body), NO_QUERY)?;

        Ok(VaultInitializeResult {
            vault_id: parse_uuid(&data, "vault_id")?,
            vault_key_id: parse_uuid(&data, "vault_key_id")?,
            recovery_key_count: data
                .get("recovery_key_count")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            recovery_codes,
        })
    }

    /// Replace the primary vault key (change the vault password).
    ///
    /// Exactly one of `current_vault_key` or `recovery_code` must be provided
    /// to authenticate the change. In both cases a new primary key is created
    /// from `new_vault_key`.
    ///
    /// # Arguments
    /// * `new_vault_key` - The new vault key (password).
    /// * `current_vault_key` - Current primary vault key (normal update).
    /// * `recovery_code` - A recovery code (recovery update).
    pub fn update_key(
        &self,
        new_vault_key: &str,
        current_vault_key: Option<&str>,
        recovery_code: Option<&str>,
    ) -> Result<VaultKey> {
        let has_current = current_vault_key.is_some();
        let has_recovery = recovery_code.is_some();
        if has_current == has_recovery {
            return Err(InkboxError::InvalidArgument(
                "Exactly one of current_vault_key or recovery_code must be provided".into(),
            ));
        }

        let auth_key = if has_current {
            current_vault_key.unwrap()
        } else {
            recovery_code.unwrap()
        };

        // Fetch org_id (vault must already exist).
        let vault_info = self
            .info()?
            .ok_or_else(|| InkboxError::InvalidArgument("Vault has not been initialized".into()))?;
        let salt = derive_salt(&vault_info.organization_id);

        // Derive master key + auth hash from the authenticating key.
        let auth_master_key = derive_master_key(auth_key, &salt)?;
        let auth_auth_hash = compute_auth_hash(&auth_master_key);

        // Fetch wrapped org encryption key.
        let unlock_data = self
            .http
            .get("/unlock", &[("auth_hash", auth_auth_hash.clone())])?;
        let wrapped = unlock_data
            .get("wrapped_org_encryption_key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                InkboxError::InvalidArgument(
                    "No vault key matched. Check that the vault key or recovery code is correct."
                        .into(),
                )
            })?;

        // Unwrap org encryption key (try each active key ID as AAD).
        let org_key = self.unwrap_with_any_key(&auth_master_key, wrapped)?;

        // Generate new primary key material.
        let new_material = generate_vault_key_material(
            new_vault_key,
            &vault_info.organization_id,
            &org_key,
            VaultKeyType::Primary,
        )?;

        // Build the PUT body, choosing the auth-hash field by update mode.
        let mut body = Map::new();
        body.insert("id".into(), Value::String(new_material.id.to_string()));
        body.insert(
            "wrapped_org_encryption_key".into(),
            Value::String(new_material.wrapped_org_encryption_key.clone()),
        );
        body.insert("auth_hash".into(), Value::String(new_material.auth_hash));
        if has_current {
            body.insert("current_auth_hash".into(), Value::String(auth_auth_hash));
        } else {
            body.insert("recovery_auth_hash".into(), Value::String(auth_auth_hash));
        }

        let data = self.http.put("/keys/primary", &Value::Object(body))?;
        Ok(serde_json::from_value(data)?)
    }

    // -- Keys (read-only via API key) --

    /// List vault keys (metadata only, no wrapped key material).
    ///
    /// # Arguments
    /// * `key_type` - Optional filter: `"primary"` or `"recovery"`.
    pub fn list_keys(&self, key_type: Option<&str>) -> Result<Vec<VaultKey>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(kt) = key_type {
            params.push(("type", kt.to_string()));
        }
        let data = self.http.get("/keys", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a vault key by auth hash.
    pub fn delete_key(&self, auth_hash: &str) -> Result<()> {
        self.http.delete(&format!("/keys/{auth_hash}"))
    }

    // -- Secrets (metadata-only operations) --

    /// List vault secrets (metadata only, no encrypted payload).
    ///
    /// # Arguments
    /// * `secret_type` - Optional filter: `"login"`, `"ssh_key"`, `"api_key"`,
    ///   `"key_pair"`, or `"other"`.
    pub fn list_secrets(&self, secret_type: Option<&str>) -> Result<Vec<VaultSecret>> {
        let mut params: Vec<(&str, String)> = Vec::new();
        if let Some(st) = secret_type {
            params.push(("secret_type", st.to_string()));
        }
        let data = self.http.get("/secrets", &params)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a vault secret.
    pub fn delete_secret(&self, secret_id: &str) -> Result<()> {
        self.http.delete(&format!("/secrets/{secret_id}"))
    }

    // -- Access rules --

    /// List identity access rules for a vault secret.
    pub fn list_access_rules(&self, secret_id: &str) -> Result<Vec<AccessRule>> {
        let data = self
            .http
            .get(&format!("/secrets/{secret_id}/access"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Grant an identity access to a vault secret.
    pub fn grant_access(&self, secret_id: &str, identity_id: &str) -> Result<AccessRule> {
        let body = serde_json::json!({ "identity_id": identity_id });
        let data = self.http.post(
            &format!("/secrets/{secret_id}/access"),
            Some(&body),
            NO_QUERY,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Revoke an identity's access to a vault secret.
    pub fn revoke_access(&self, secret_id: &str, identity_id: &str) -> Result<()> {
        self.http
            .delete(&format!("/secrets/{secret_id}/access/{identity_id}"))
    }

    // -- Unlock --

    /// Unlock the vault with a vault key.
    ///
    /// Derives the encryption key from the provided vault key, fetches and
    /// decrypts all vault secrets.
    ///
    /// # Arguments
    /// * `vault_key` - Vault key or recovery code.
    /// * `identity_id` - Optional agent identity UUID. When provided, only
    ///   secrets that this identity has been granted access to are included in
    ///   [`UnlockedVault::secrets`].
    ///
    /// # Returns
    /// [`UnlockedVault`] with decrypted secrets and methods for secret CRUD.
    pub fn unlock(&self, vault_key: &str, identity_id: Option<&str>) -> Result<UnlockedVault> {
        // Step 1: get org_id for salt derivation.
        let vault_info = self
            .info()?
            .ok_or_else(|| InkboxError::InvalidArgument("Vault has not been initialized".into()))?;
        let salt = derive_salt(&vault_info.organization_id);

        // Step 2: derive master key → auth hash.
        let master_key = derive_master_key(vault_key, &salt)?;
        let auth_hash = compute_auth_hash(&master_key);

        // Step 3: fetch wrapped key + encrypted secrets. We always send
        // auth_hash, so the server returns the singular
        // wrapped_org_encryption_key for the matching vault key.
        let data = self.http.get("/unlock", &[("auth_hash", auth_hash)])?;

        let wrapped = data
            .get("wrapped_org_encryption_key")
            .and_then(|v| v.as_str())
            .ok_or_else(|| {
                InkboxError::InvalidArgument(
                    "No vault key matched. Check that the vault key is correct and has not been \
                     deleted."
                        .into(),
                )
            })?;

        // Step 4: unwrap the org encryption key. The wrapped key was encrypted
        // with the vault key UUID as AAD; try each key ID until one works.
        let org_key = self.unwrap_with_any_key(&master_key, wrapped)?;

        // Step 5: decrypt all secrets from the unlock bundle.
        let mut decrypted: Vec<DecryptedVaultSecret> = Vec::new();
        if let Some(secrets) = data.get("encrypted_secrets").and_then(|v| v.as_array()) {
            for raw in secrets {
                let detail: VaultSecretDetail = serde_json::from_value(raw.clone())?;
                let payload_dict =
                    decrypt_payload(&org_key, &detail.encrypted_payload, &detail.id.to_string())?;
                let payload = SecretPayload::from_value(&detail.secret_type, payload_dict)?;
                decrypted.push(DecryptedVaultSecret {
                    id: detail.id,
                    name: detail.name,
                    secret_type: detail.secret_type,
                    created_at: detail.created_at,
                    updated_at: detail.updated_at,
                    payload,
                    description: detail.description,
                });
            }
        }

        // Always cache the unfiltered vault so `identity.credentials` has the
        // full set to filter from, even when `identity_id` is provided.
        let full = UnlockedVault::new(self.http.clone(), org_key.clone(), decrypted.clone());
        *self.unlocked.lock().unwrap() = Some(full.clone());

        // Step 6 (optional): filter by identity access rules.
        if let Some(id_str) = identity_id {
            let mut filtered: Vec<DecryptedVaultSecret> = Vec::new();
            for secret in &decrypted {
                let access_rules = self
                    .http
                    .get(&format!("/secrets/{}/access", secret.id), NO_QUERY)?;
                let granted = access_rules
                    .as_array()
                    .map(|rules| {
                        rules
                            .iter()
                            .any(|r| r.get("identity_id").and_then(|v| v.as_str()) == Some(id_str))
                    })
                    .unwrap_or(false);
                if granted {
                    filtered.push(secret.clone());
                }
            }
            return Ok(UnlockedVault::new(self.http.clone(), org_key, filtered));
        }

        Ok(full)
    }

    /// Fetch all key IDs and try each as AAD to unwrap the org key. Primary key
    /// IDs are tried before recovery key IDs (matching Python's ordering).
    fn unwrap_with_any_key(&self, master_key: &[u8], wrapped: &str) -> Result<Vec<u8>> {
        let keys_data = self.http.get("/keys", NO_QUERY)?;
        let keys = keys_data.as_array().cloned().unwrap_or_default();
        let id_of = |k: &Value| k.get("id").and_then(|v| v.as_str()).map(str::to_string);
        let mut all_key_ids: Vec<String> = keys
            .iter()
            .filter(|k| k.get("key_type").and_then(|v| v.as_str()) == Some("primary"))
            .filter_map(id_of)
            .collect();
        all_key_ids.extend(
            keys.iter()
                .filter(|k| k.get("key_type").and_then(|v| v.as_str()) == Some("recovery"))
                .filter_map(id_of),
        );

        for key_id in &all_key_ids {
            if let Ok(org_key) = unwrap_org_key(master_key, wrapped, key_id) {
                return Ok(org_key);
            }
        }
        Err(InkboxError::InvalidArgument(
            "Failed to unwrap org encryption key. Check that the vault key is correct.".into(),
        ))
    }
}

/// A vault unlocked with a valid vault key.
///
/// Provides transparent encrypt/decrypt for secret CRUD operations. Obtain via
/// [`VaultResource::unlock`].
///
/// Cloneable: clones share the underlying transport (`Arc`) and copy the
/// decrypted secrets cache so `identity.credentials` can hold an independent
/// filtered view.
#[derive(Clone)]
pub struct UnlockedVault {
    http: Arc<HttpTransport>,
    org_key: Vec<u8>,
    secrets_cache: Vec<DecryptedVaultSecret>,
}

impl UnlockedVault {
    fn new(
        http: Arc<HttpTransport>,
        org_key: Vec<u8>,
        secrets_cache: Vec<DecryptedVaultSecret>,
    ) -> Self {
        Self {
            http,
            org_key,
            secrets_cache,
        }
    }

    /// All vault secrets decrypted from the unlock response.
    pub fn secrets(&self) -> Vec<DecryptedVaultSecret> {
        self.secrets_cache.clone()
    }

    /// Re-fetch, decrypt, and update a single secret in the cache. Best-effort —
    /// if the re-fetch fails the cache is left unchanged.
    fn refresh_cached_secret(&mut self, secret_id: &str) {
        if let Ok(updated) = self.get_secret(secret_id) {
            for s in &mut self.secrets_cache {
                if s.id.to_string() == secret_id {
                    *s = updated.clone();
                }
            }
        }
    }

    // -- Encrypted CRUD --

    /// Fetch and decrypt a single vault secret.
    pub fn get_secret(&self, secret_id: &str) -> Result<DecryptedVaultSecret> {
        let data = self.http.get(&format!("/secrets/{secret_id}"), NO_QUERY)?;
        let detail: VaultSecretDetail = serde_json::from_value(data)?;
        let payload_dict = decrypt_payload(
            &self.org_key,
            &detail.encrypted_payload,
            &detail.id.to_string(),
        )?;
        let payload = SecretPayload::from_value(&detail.secret_type, payload_dict)?;
        Ok(DecryptedVaultSecret {
            id: detail.id,
            name: detail.name,
            secret_type: detail.secret_type,
            created_at: detail.created_at,
            updated_at: detail.updated_at,
            payload,
            description: detail.description,
        })
    }

    /// Encrypt and store a new secret. The `secret_type` is inferred from the
    /// payload type.
    ///
    /// # Arguments
    /// * `name` - Display name (max 255 characters).
    /// * `payload` - The structured payload to encrypt.
    /// * `description` - Optional description.
    ///
    /// # Returns
    /// [`VaultSecret`] metadata (no payload).
    pub fn create_secret(
        &mut self,
        name: &str,
        payload: &SecretPayload,
        description: Option<&str>,
    ) -> Result<VaultSecret> {
        let secret_type = payload.secret_type();

        // Generate the UUID client-side so we can use it as AAD for encryption
        // in the same request.
        let secret_id = Uuid::new_v4().to_string();
        let encrypted = encrypt_payload(&self.org_key, &payload.to_value()?, &secret_id)?;

        let mut body = Map::new();
        body.insert("id".into(), Value::String(secret_id.clone()));
        body.insert("name".into(), Value::String(name.to_string()));
        body.insert(
            "secret_type".into(),
            Value::String(secret_type.as_str().to_string()),
        );
        body.insert("encrypted_payload".into(), Value::String(encrypted));
        if let Some(desc) = description {
            body.insert("description".into(), Value::String(desc.to_string()));
        }
        let data = self
            .http
            .post("/secrets", Some(&Value::Object(body)), NO_QUERY)?;
        let result: VaultSecret = serde_json::from_value(data)?;

        // Append the new secret to the cache so it's immediately visible
        // (best-effort).
        if let Ok(decrypted) = self.get_secret(&result.id.to_string()) {
            self.secrets_cache.push(decrypted);
        }
        Ok(result)
    }

    /// Update a vault secret's name, description, and/or encrypted payload. Only
    /// provided arguments are sent to the server.
    ///
    /// The `secret_type` is immutable after creation. If a payload is provided
    /// it must be the **same type** as the original.
    ///
    /// Each argument uses an outer `Option` as the omit sentinel (Python's
    /// `_UNSET`): `None` omits the key; `Some(..)` sends it. `description` adds
    /// an inner `Option` so `Some(None)` clears it (sends `null`).
    ///
    /// # Arguments
    /// * `secret_id` - UUID of the secret to update.
    /// * `name` - New display name (`None` to omit).
    /// * `description` - Omit (`None`), clear (`Some(None)`), or set
    ///   (`Some(Some(..))`).
    /// * `payload` - New payload of the **same type** as the original (`None` to
    ///   omit); re-encrypted before sending.
    pub fn update_secret(
        &mut self,
        secret_id: &str,
        name: Option<&str>,
        description: Option<Option<&str>>,
        payload: Option<&SecretPayload>,
    ) -> Result<VaultSecret> {
        let mut body = Map::new();
        if let Some(name) = name {
            body.insert("name".into(), Value::String(name.to_string()));
        }
        if let Some(desc) = description {
            body.insert(
                "description".into(),
                match desc {
                    Some(d) => Value::String(d.to_string()),
                    None => Value::Null,
                },
            );
        }
        if let Some(payload) = payload {
            // Enforce secret_type immutability; the server treats the payload as
            // opaque ciphertext and cannot check this itself.
            let current_raw = self.http.get(&format!("/secrets/{secret_id}"), NO_QUERY)?;
            let current: VaultSecret = serde_json::from_value(current_raw)?;
            let new_type = payload.secret_type();
            if new_type.as_str() != current.secret_type {
                return Err(InkboxError::InvalidArgument(format!(
                    "Cannot update a {:?} secret with a {:?} payload. Delete and recreate instead.",
                    current.secret_type,
                    new_type.as_str()
                )));
            }
            body.insert(
                "encrypted_payload".into(),
                Value::String(encrypt_payload(
                    &self.org_key,
                    &payload.to_value()?,
                    secret_id,
                )?),
            );
        }
        let data = self
            .http
            .patch(&format!("/secrets/{secret_id}"), &Value::Object(body))?;
        // Refresh the cache so subsequent reads are consistent.
        self.refresh_cached_secret(secret_id);
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a vault secret.
    pub fn delete_secret(&mut self, secret_id: &str) -> Result<()> {
        self.http.delete(&format!("/secrets/{secret_id}"))?;
        self.secrets_cache.retain(|s| s.id.to_string() != secret_id);
        Ok(())
    }

    // -- TOTP helpers --

    /// Add or replace the TOTP configuration on a login secret.
    ///
    /// # Arguments
    /// * `secret_id` - UUID of the login secret.
    /// * `totp` - A [`TOTPConfig`].
    pub fn set_totp(&mut self, secret_id: &str, totp: TOTPConfig) -> Result<VaultSecret> {
        let secret = self.get_secret(secret_id)?;
        let mut login = match secret.payload {
            SecretPayload::Login(login) => login,
            _ => {
                return Err(InkboxError::InvalidArgument(format!(
                    "Cannot set TOTP on a {:?} secret — only login secrets support TOTP",
                    secret.secret_type
                )))
            }
        };
        login.totp = Some(totp);
        self.update_secret(secret_id, None, None, Some(&SecretPayload::Login(login)))
    }

    /// Add or replace TOTP from an `otpauth://totp/...` URI string.
    pub fn set_totp_uri(&mut self, secret_id: &str, uri: &str) -> Result<VaultSecret> {
        let totp = parse_totp_uri(uri)?;
        self.set_totp(secret_id, totp)
    }

    /// Remove TOTP configuration from a login secret.
    pub fn remove_totp(&mut self, secret_id: &str) -> Result<VaultSecret> {
        let secret = self.get_secret(secret_id)?;
        let mut login = match secret.payload {
            SecretPayload::Login(login) => login,
            _ => {
                return Err(InkboxError::InvalidArgument(format!(
                    "Cannot remove TOTP from a {:?} secret — only login secrets support TOTP",
                    secret.secret_type
                )))
            }
        };
        login.totp = None;
        self.update_secret(secret_id, None, None, Some(&SecretPayload::Login(login)))
    }

    /// Generate the current TOTP code for a login secret.
    pub fn get_totp_code(&self, secret_id: &str) -> Result<TOTPCode> {
        let secret = self.get_secret(secret_id)?;
        let login = match &secret.payload {
            SecretPayload::Login(login) => login,
            _ => {
                return Err(InkboxError::InvalidArgument(format!(
                    "Cannot generate TOTP for a {:?} secret — only login secrets support TOTP",
                    secret.secret_type
                )))
            }
        };
        match &login.totp {
            Some(config) => generate_totp(config),
            None => Err(InkboxError::InvalidArgument(format!(
                "Login secret {secret_id:?} has no TOTP configured"
            ))),
        }
    }
}

/// Parse a UUID out of a JSON object field (helper for response decoding).
fn parse_uuid(data: &Value, field: &str) -> Result<Uuid> {
    use serde::de::Error as _;
    data.get(field)
        .and_then(|v| v.as_str())
        .and_then(|s| Uuid::parse_str(s).ok())
        .ok_or_else(|| {
            InkboxError::Decode(serde_json::Error::custom(format!(
                "missing/invalid {field}"
            )))
        })
}

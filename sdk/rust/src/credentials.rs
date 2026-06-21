//! Agent-facing credential access, typed and identity-scoped.
//!
//! Port of `inkbox/credentials.py`. This is the *runtime* surface for agents
//! that need their credentials. The vault remains the *admin* surface for
//! creating secrets, managing keys, and configuring access rules.
//!
//! Python raises `KeyError` (credential not found) and `TypeError` (wrong
//! credential type); both are local validation failures, so they map onto
//! [`InkboxError::InvalidArgument`].

use std::collections::HashMap;

use crate::error::{InkboxError, Result};
use crate::vault::totp::{generate_totp, TOTPCode};
use crate::vault::types::{
    APIKeyPayload, DecryptedVaultSecret, KeyPairPayload, LoginPayload, SSHKeyPayload,
    SecretPayload, VaultSecretType,
};

/// Agent-facing credential access — typed, identity-scoped.
///
/// Wraps a pre-filtered list of [`DecryptedVaultSecret`] objects and provides
/// typed accessors so agents can retrieve credentials without dealing with
/// vault internals.
///
/// Obtain via `AgentIdentity::credentials` after unlocking the vault.
pub struct Credentials {
    secrets: Vec<DecryptedVaultSecret>,
    by_id: HashMap<String, usize>,
}

impl Credentials {
    /// Build from a list of decrypted secrets.
    pub fn new(secrets: Vec<DecryptedVaultSecret>) -> Self {
        // Index by string UUID so `get` is O(1), matching Python's `_by_id`.
        let by_id = secrets
            .iter()
            .enumerate()
            .map(|(i, s)| (s.id.to_string(), i))
            .collect();
        Self { secrets, by_id }
    }

    /// Number of credentials accessible to this identity (Python's `__len__`).
    pub fn len(&self) -> usize {
        self.secrets.len()
    }

    /// Whether this identity has no accessible credentials.
    pub fn is_empty(&self) -> bool {
        self.secrets.is_empty()
    }

    // -- Discovery; return full DecryptedVaultSecret for name/metadata --

    /// List all credentials this identity has access to.
    pub fn list(&self) -> Vec<DecryptedVaultSecret> {
        self.secrets.clone()
    }

    /// List login credentials (username/password).
    pub fn list_logins(&self) -> Vec<DecryptedVaultSecret> {
        self.filter_by_type(VaultSecretType::Login)
    }

    /// List API key credentials.
    pub fn list_api_keys(&self) -> Vec<DecryptedVaultSecret> {
        self.filter_by_type(VaultSecretType::ApiKey)
    }

    /// List key pair credentials (access key + secret key).
    pub fn list_key_pairs(&self) -> Vec<DecryptedVaultSecret> {
        self.filter_by_type(VaultSecretType::KeyPair)
    }

    /// List SSH key credentials.
    pub fn list_ssh_keys(&self) -> Vec<DecryptedVaultSecret> {
        self.filter_by_type(VaultSecretType::SshKey)
    }

    fn filter_by_type(&self, ty: VaultSecretType) -> Vec<DecryptedVaultSecret> {
        self.secrets
            .iter()
            .filter(|s| s.secret_type == ty.as_str())
            .cloned()
            .collect()
    }

    // -- Access by UUID; return typed payload directly --

    /// Get any credential by UUID.
    ///
    /// Returns [`InkboxError::InvalidArgument`] (Python `KeyError`) if no
    /// credential with this UUID is accessible.
    pub fn get(&self, secret_id: &str) -> Result<DecryptedVaultSecret> {
        match self.by_id.get(secret_id) {
            Some(&i) => Ok(self.secrets[i].clone()),
            None => Err(InkboxError::InvalidArgument(format!(
                "No credential with id {secret_id:?} is accessible to this identity"
            ))),
        }
    }

    /// Look up a secret by UUID and verify its type, returning the payload.
    /// Mirrors Python's `_get_typed`.
    fn get_typed(&self, secret_id: &str, expected: VaultSecretType) -> Result<SecretPayload> {
        let secret = self.get(secret_id)?;
        if secret.secret_type != expected.as_str() {
            // Python raises TypeError → InvalidArgument.
            return Err(InkboxError::InvalidArgument(format!(
                "Credential {:?} is a {:?} secret, not {:?}",
                secret_id,
                secret.secret_type,
                expected.as_str()
            )));
        }
        Ok(secret.payload)
    }

    /// Get a login credential's payload by UUID.
    pub fn get_login(&self, secret_id: &str) -> Result<LoginPayload> {
        match self.get_typed(secret_id, VaultSecretType::Login)? {
            SecretPayload::Login(p) => Ok(p),
            _ => unreachable!("type checked in get_typed"),
        }
    }

    /// Get an API key credential's payload by UUID.
    pub fn get_api_key(&self, secret_id: &str) -> Result<APIKeyPayload> {
        match self.get_typed(secret_id, VaultSecretType::ApiKey)? {
            SecretPayload::ApiKey(p) => Ok(p),
            _ => unreachable!("type checked in get_typed"),
        }
    }

    /// Get a key pair credential's payload by UUID.
    pub fn get_key_pair(&self, secret_id: &str) -> Result<KeyPairPayload> {
        match self.get_typed(secret_id, VaultSecretType::KeyPair)? {
            SecretPayload::KeyPair(p) => Ok(p),
            _ => unreachable!("type checked in get_typed"),
        }
    }

    /// Get an SSH key credential's payload by UUID.
    pub fn get_ssh_key(&self, secret_id: &str) -> Result<SSHKeyPayload> {
        match self.get_typed(secret_id, VaultSecretType::SshKey)? {
            SecretPayload::SshKey(p) => Ok(p),
            _ => unreachable!("type checked in get_typed"),
        }
    }

    /// Generate the current TOTP code for a login credential.
    ///
    /// Returns [`InkboxError::InvalidArgument`] if the credential is not found
    /// (Python `KeyError`), is not a login (`TypeError`), or has no TOTP
    /// configured (`ValueError`).
    pub fn get_totp_code(&self, secret_id: &str) -> Result<TOTPCode> {
        let payload = self.get_login(secret_id)?;
        match payload.totp {
            Some(config) => generate_totp(&config),
            None => Err(InkboxError::InvalidArgument(format!(
                "Login {secret_id:?} has no TOTP configured"
            ))),
        }
    }
}

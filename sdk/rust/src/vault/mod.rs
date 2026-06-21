//! Vault domain: encrypted, org-scoped credential storage.
//!
//! Port of `inkbox/vault/`. Provides client-side cryptography (Argon2id KDF +
//! AES-256-GCM envelope encryption), TOTP generation, structured secret
//! payloads, and the [`VaultResource`] / [`UnlockedVault`] API surface.
//!
//! All cryptographic material is generated client-side; the server only ever
//! sees ciphertexts and identifiers.

pub mod crypto;
pub mod exceptions;
pub mod resources;
pub mod totp;
pub mod types;

pub use crypto::{
    generate_org_encryption_key, generate_recovery_code, generate_vault_key_material,
    VaultKeyMaterial,
};
pub use resources::vault::{UnlockedVault, VaultResource};
pub use totp::{generate_totp, parse_totp_uri, TOTPAlgorithm, TOTPCode, TOTPConfig};
pub use types::{
    APIKeyPayload, AbstractSecretPayload, AccessRule, DecryptedVaultSecret, KeyPairPayload,
    LoginPayload, OtherPayload, SSHKeyPayload, SecretPayload, VaultInfo, VaultInitializeResult,
    VaultKey, VaultKeyType, VaultSecret, VaultSecretDetail, VaultSecretType,
};

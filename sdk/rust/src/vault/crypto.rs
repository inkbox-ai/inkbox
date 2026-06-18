//! Client-side cryptography for the encrypted vault.
//!
//! Port of `inkbox/vault/crypto.py`.
//!
//! - **Key derivation:** Argon2id (vault key → 256-bit master key).
//! - **Encryption:** AES-256-GCM, blob layout `ciphertext || nonce || tag`.
//! - **Hashing:** SHA-256 (auth hash = `SHA-256(masterKey)` hex digest).
//!
//! ## Salt derivation
//!
//! The Argon2id salt is the raw UTF-8 encoding of the organisation ID, so that
//! both the dashboard (vault init) and the SDK (vault unlock) compute the same
//! master key from the same vault key without a round-trip:
//!
//! ```text
//! salt = org_id.as_bytes()
//! ```
//!
//! ## Cryptographic parameters (MUST match Python/TS byte-for-byte)
//!
//! | Parameter            | Value                              |
//! |----------------------|------------------------------------|
//! | Argon2 type          | Argon2id                           |
//! | Argon2 version       | 0x13 (19)                          |
//! | Argon2 time cost     | 3 iterations                       |
//! | Argon2 memory cost   | 65536 KiB (64 MiB)                 |
//! | Argon2 parallelism   | 1                                  |
//! | Argon2 hash length   | 32 bytes (256-bit master key)      |
//! | AES key length       | 32 bytes (AES-256)                 |
//! | AES-GCM nonce length | 12 bytes                           |
//! | AES-GCM tag length   | 16 bytes                           |
//! | Blob layout          | `ciphertext \|\| nonce \|\| tag`   |
//! | AAD                  | UTF-8 of key/secret id, else none  |
//! | Wrapped key encoding | base64 (standard, padded)          |
//! | Auth hash encoding   | lowercase hex                      |

use aes_gcm::aead::{Aead, KeyInit, Payload};
use aes_gcm::{Aes256Gcm, Nonce};
use argon2::{Algorithm, Argon2, Params, Version};
use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use rand::{Rng, RngCore};
use serde_json::Value;
use sha2::{Digest, Sha256};
use uuid::Uuid;
use zeroize::Zeroize;

use crate::error::{InkboxError, Result};
use crate::vault::types::VaultKeyType;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARGON2_TIME_COST: u32 = 3;
const ARGON2_MEMORY_COST: u32 = 65_536; // 64 MiB, in KiB
const ARGON2_PARALLELISM: u32 = 1;
const ARGON2_HASH_LEN: usize = 32; // 256-bit master key

const AES_KEY_BYTES: usize = 32;
const AES_IV_BYTES: usize = 12;
const AES_TAG_BYTES: usize = 16;

/// Recovery code alphabet (unambiguous uppercase + digits, no `0/O/1/I/L`).
const RC_ALPHABET: &[u8] = b"23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const RC_GROUP_LEN: usize = 4;
const RC_GROUPS: usize = 8; // 8 groups × 4 chars ≈ 120 bits of entropy

// ---------------------------------------------------------------------------
// Vault key validation
// ---------------------------------------------------------------------------

/// Enforce minimum vault key requirements (≥16 chars, upper, lower, digit,
/// special). Mirrors `_validate_vault_key`.
fn validate_vault_key(vault_key: &str) -> Result<()> {
    if vault_key.chars().count() < 16 {
        return Err(InkboxError::VaultKey(
            "Vault key must be at least 16 characters".into(),
        ));
    }
    if !vault_key.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(InkboxError::VaultKey(
            "Vault key must contain at least one uppercase letter".into(),
        ));
    }
    if !vault_key.chars().any(|c| c.is_ascii_lowercase()) {
        return Err(InkboxError::VaultKey(
            "Vault key must contain at least one lowercase letter".into(),
        ));
    }
    if !vault_key.chars().any(|c| c.is_ascii_digit()) {
        return Err(InkboxError::VaultKey(
            "Vault key must contain at least one digit".into(),
        ));
    }
    // Special character = anything that is not ASCII alphanumeric (matches the
    // Python regex `[^A-Za-z0-9]`).
    if !vault_key.chars().any(|c| !c.is_ascii_alphanumeric()) {
        return Err(InkboxError::VaultKey(
            "Vault key must contain at least one special character".into(),
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Salt derivation
// ---------------------------------------------------------------------------

/// Derive the Argon2id salt from the organisation ID (its raw UTF-8 bytes).
///
/// Deterministic so both vault init and vault unlock reach the same master key
/// from the same vault key.
pub fn derive_salt(organization_id: &str) -> Vec<u8> {
    organization_id.as_bytes().to_vec()
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/// Derive a 256-bit master key from a vault key using Argon2id.
///
/// # Arguments
/// * `vault_key` - User-provided vault key or recovery code.
/// * `salt` - Salt bytes from [`derive_salt`].
///
/// # Returns
/// 32-byte master key.
pub fn derive_master_key(vault_key: &str, salt: &[u8]) -> Result<Vec<u8>> {
    // Build Argon2 with the exact (m_cost, t_cost, p_cost, output_len) the
    // Python/TS SDKs use; version is 0x13 (the argon2-cffi/hash-wasm default).
    let params = Params::new(
        ARGON2_MEMORY_COST,
        ARGON2_TIME_COST,
        ARGON2_PARALLELISM,
        Some(ARGON2_HASH_LEN),
    )
    .map_err(|e| InkboxError::VaultKey(format!("invalid Argon2 params: {e}")))?;
    let argon2 = Argon2::new(Algorithm::Argon2id, Version::V0x13, params);

    let mut out = vec![0u8; ARGON2_HASH_LEN];
    argon2
        .hash_password_into(vault_key.as_bytes(), salt, &mut out)
        .map_err(|e| InkboxError::VaultKey(format!("Argon2id derivation failed: {e}")))?;
    Ok(out)
}

/// Compute `SHA-256(masterKey)` as a lowercase hex digest.
pub fn compute_auth_hash(master_key: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(master_key);
    hex::encode(hasher.finalize())
}

// ---------------------------------------------------------------------------
// AES-256-GCM wrapping / unwrapping
// ---------------------------------------------------------------------------

/// Encrypt with AES-256-GCM. Returns `ciphertext || nonce || tag`.
///
/// The `aes-gcm` crate appends the 16-byte tag to the ciphertext, so the
/// concatenation order is `ciphertext_with_tag[..-16] || nonce || tag`.
fn aes_gcm_encrypt(key: &[u8], plaintext: &[u8], aad: &str) -> Result<Vec<u8>> {
    // Random 12-byte nonce.
    let mut iv = [0u8; AES_IV_BYTES];
    rand::thread_rng().fill_bytes(&mut iv);

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| InkboxError::VaultKey(format!("invalid AES key: {e}")))?;
    let nonce = Nonce::from_slice(&iv);

    // AAD is the UTF-8 of the id when non-empty, else absent (empty AAD).
    let ct_and_tag = cipher
        .encrypt(
            nonce,
            Payload {
                msg: plaintext,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|e| InkboxError::VaultKey(format!("AES-GCM encryption failed: {e}")))?;

    // `ct_and_tag` is `ciphertext || tag`. Re-order to `ciphertext || nonce || tag`.
    let split = ct_and_tag.len() - AES_TAG_BYTES;
    let (ct, tag) = ct_and_tag.split_at(split);
    let mut out = Vec::with_capacity(ct.len() + AES_IV_BYTES + AES_TAG_BYTES);
    out.extend_from_slice(ct);
    out.extend_from_slice(&iv);
    out.extend_from_slice(tag);
    Ok(out)
}

/// Decrypt an AES-256-GCM blob formatted as `ciphertext || nonce || tag`.
fn aes_gcm_decrypt(key: &[u8], blob: &[u8], aad: &str) -> Result<Vec<u8>> {
    if blob.len() < AES_IV_BYTES + AES_TAG_BYTES {
        return Err(InkboxError::VaultKey("ciphertext blob too short".into()));
    }
    // Slice out the three sections (mirrors the Python negative-index slicing).
    let total = blob.len();
    let ct = &blob[..total - (AES_IV_BYTES + AES_TAG_BYTES)];
    let nonce_bytes = &blob[total - (AES_IV_BYTES + AES_TAG_BYTES)..total - AES_TAG_BYTES];
    let tag = &blob[total - AES_TAG_BYTES..];

    let cipher = Aes256Gcm::new_from_slice(key)
        .map_err(|e| InkboxError::VaultKey(format!("invalid AES key: {e}")))?;
    let nonce = Nonce::from_slice(nonce_bytes);

    // `aes-gcm` expects `ciphertext || tag`; reassemble before decrypting.
    let mut ct_and_tag = Vec::with_capacity(ct.len() + tag.len());
    ct_and_tag.extend_from_slice(ct);
    ct_and_tag.extend_from_slice(tag);

    cipher
        .decrypt(
            nonce,
            Payload {
                msg: &ct_and_tag,
                aad: aad.as_bytes(),
            },
        )
        .map_err(|e| InkboxError::VaultKey(format!("AES-GCM decryption failed: {e}")))
}

/// Wrap the org encryption key with a master key.
///
/// # Returns
/// Base64-encoded blob `(ciphertext || nonce || tag)`.
pub fn wrap_org_key(master_key: &[u8], org_key: &[u8], vault_key_id: &str) -> Result<String> {
    let blob = aes_gcm_encrypt(master_key, org_key, vault_key_id)?;
    Ok(BASE64.encode(blob))
}

/// Unwrap the org encryption key using a master key.
///
/// # Returns
/// 32-byte org encryption key.
pub fn unwrap_org_key(master_key: &[u8], wrapped_b64: &str, vault_key_id: &str) -> Result<Vec<u8>> {
    let blob = BASE64
        .decode(wrapped_b64)
        .map_err(|e| InkboxError::VaultKey(format!("invalid base64 wrapped key: {e}")))?;
    aes_gcm_decrypt(master_key, &blob, vault_key_id)
}

// ---------------------------------------------------------------------------
// Secret payload encryption / decryption
// ---------------------------------------------------------------------------

/// Serialize a payload value to compact JSON and encrypt with the org key.
///
/// Matches Python's `json.dumps(payload, separators=(",", ":"))` — `serde_json`
/// produces the same separator-free compact form.
///
/// # Returns
/// Base64-encoded ciphertext blob.
pub fn encrypt_payload(org_key: &[u8], payload: &Value, secret_id: &str) -> Result<String> {
    let plaintext = serde_json::to_vec(payload)?;
    let blob = aes_gcm_encrypt(org_key, &plaintext, secret_id)?;
    Ok(BASE64.encode(blob))
}

/// Decrypt a base64 ciphertext blob and parse the JSON payload.
///
/// # Returns
/// The decrypted payload as a JSON value.
pub fn decrypt_payload(org_key: &[u8], encrypted_b64: &str, secret_id: &str) -> Result<Value> {
    let blob = BASE64
        .decode(encrypted_b64)
        .map_err(|e| InkboxError::VaultKey(format!("invalid base64 ciphertext: {e}")))?;
    let plaintext = aes_gcm_decrypt(org_key, &blob, secret_id)?;
    Ok(serde_json::from_slice(&plaintext)?)
}

// ---------------------------------------------------------------------------
// Vault key material generation (used by dashboard / init code)
// ---------------------------------------------------------------------------

/// Generate a random 256-bit org encryption key.
pub fn generate_org_encryption_key() -> Vec<u8> {
    let mut key = vec![0u8; AES_KEY_BYTES];
    rand::thread_rng().fill_bytes(&mut key);
    key
}

/// Cryptographic material for registering a vault key with the server.
///
/// Call [`VaultKeyMaterial::to_wire`] to get a JSON-serializable value suitable
/// for `POST /vault/initialize` or `POST /vault/keys`.
#[derive(Debug, Clone)]
pub struct VaultKeyMaterial {
    /// Client-generated UUID (database primary key).
    pub id: Uuid,
    /// Base64-encoded AES-256-GCM ciphertext wrapping the org encryption key.
    pub wrapped_org_encryption_key: String,
    /// `SHA-256(masterKey)` hex digest.
    pub auth_hash: String,
    /// `"primary"` or `"recovery"`.
    pub key_type: VaultKeyType,
}

impl VaultKeyMaterial {
    /// Return a JSON object matching the API's expected snake_case schema.
    pub fn to_wire(&self) -> Value {
        serde_json::json!({
            "id": self.id.to_string(),
            "wrapped_org_encryption_key": self.wrapped_org_encryption_key,
            "auth_hash": self.auth_hash,
            "key_type": self.key_type.as_str(),
        })
    }
}

/// Generate vault key material from a vault key.
///
/// Derives a master key via Argon2id and wraps the org encryption key.
///
/// # Arguments
/// * `vault_key` - User-chosen vault key or recovery code string.
/// * `organization_id` - Organisation ID (used as salt basis).
/// * `org_encryption_key` - 32-byte org encryption key to wrap.
/// * `key_type` - [`VaultKeyType::Primary`] or [`VaultKeyType::Recovery`].
///
/// # Returns
/// [`VaultKeyMaterial`] ready to send to the server.
pub fn generate_vault_key_material(
    vault_key: &str,
    organization_id: &str,
    org_encryption_key: &[u8],
    key_type: VaultKeyType,
) -> Result<VaultKeyMaterial> {
    validate_vault_key(vault_key)?;
    let salt = derive_salt(organization_id);
    let mut master_key = derive_master_key(vault_key, &salt)?;
    let auth_hash = compute_auth_hash(&master_key);
    let key_id = Uuid::new_v4();
    let wrapped = wrap_org_key(&master_key, org_encryption_key, &key_id.to_string())?;
    master_key.zeroize();

    Ok(VaultKeyMaterial {
        id: key_id,
        wrapped_org_encryption_key: wrapped,
        auth_hash,
        key_type,
    })
}

/// Generate a random recovery code and its vault key material.
///
/// The recovery code is a human-readable string of the form
/// `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (~120 bits of entropy).
///
/// # Arguments
/// * `organization_id` - Organisation ID (used as salt basis).
/// * `org_encryption_key` - 32-byte org encryption key to wrap.
///
/// # Returns
/// A `(code_string, VaultKeyMaterial)` tuple. The code string must be stored
/// securely — it cannot be recovered.
pub fn generate_recovery_code(
    organization_id: &str,
    org_encryption_key: &[u8],
) -> Result<(String, VaultKeyMaterial)> {
    // Build 8 groups of 4 chars drawn uniformly from the unambiguous alphabet.
    let mut rng = rand::thread_rng();
    let mut groups: Vec<String> = Vec::with_capacity(RC_GROUPS);
    for _ in 0..RC_GROUPS {
        let mut group = String::with_capacity(RC_GROUP_LEN);
        for _ in 0..RC_GROUP_LEN {
            // Unbiased uniform index into the alphabet (matches `secrets.choice`;
            // `gen_range` uses rejection sampling so there is no modulo bias).
            let idx = rng.gen_range(0..RC_ALPHABET.len());
            group.push(RC_ALPHABET[idx] as char);
        }
        groups.push(group);
    }
    let code = groups.join("-");

    // Recovery codes bypass `validate_vault_key`; derive directly.
    let salt = derive_salt(organization_id);
    let mut master_key = derive_master_key(&code, &salt)?;
    let auth_hash = compute_auth_hash(&master_key);
    let key_id = Uuid::new_v4();
    let wrapped = wrap_org_key(&master_key, org_encryption_key, &key_id.to_string())?;
    master_key.zeroize();

    let material = VaultKeyMaterial {
        id: key_id,
        wrapped_org_encryption_key: wrapped,
        auth_hash,
        key_type: VaultKeyType::Recovery,
    };
    Ok((code, material))
}

// ---------------------------------------------------------------------------
// Tests
//
// Exact mimics of the Python (`tests/test_vault_crypto.py`) and TypeScript
// (`tests/vault/crypto.test.ts`) suites, ported to the Rust API. Same inputs,
// same assertions, and the same cross-SDK `auth_hash` vector — so vault key
// material derived here stays byte-for-byte interoperable with the other SDKs.
// ---------------------------------------------------------------------------
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const VALID_VAULT_KEY: &str = "Test-Passw0rd!xy";

    // ---- validate_vault_key (TestValidateVaultKey) ----

    #[test]
    fn valid_key_passes() {
        validate_vault_key(VALID_VAULT_KEY).unwrap();
    }

    #[test]
    fn too_short() {
        let e = validate_vault_key("Short-Pass0rd!").unwrap_err();
        assert!(e.to_string().contains("at least 16 characters"));
    }

    #[test]
    fn no_uppercase() {
        let e = validate_vault_key("test-passw0rd!xy").unwrap_err();
        assert!(e.to_string().contains("uppercase letter"));
    }

    #[test]
    fn no_lowercase() {
        let e = validate_vault_key("TEST-PASSW0RD!XY").unwrap_err();
        assert!(e.to_string().contains("lowercase letter"));
    }

    #[test]
    fn no_digit() {
        let e = validate_vault_key("Test-Password!xy").unwrap_err();
        assert!(e.to_string().contains("digit"));
    }

    #[test]
    fn no_special() {
        let e = validate_vault_key("TestPassw0rdxyxy").unwrap_err();
        assert!(e.to_string().contains("special character"));
    }

    // ---- derive_salt (TestDeriveSalt) ----

    #[test]
    fn salt_deterministic() {
        assert_eq!(derive_salt("org_test_123"), derive_salt("org_test_123"));
    }

    #[test]
    fn salt_different_orgs_differ() {
        assert_ne!(derive_salt("org_a"), derive_salt("org_b"));
    }

    #[test]
    fn salt_length_matches_org_id() {
        assert_eq!(derive_salt("org_test_123"), b"org_test_123".to_vec());
    }

    // ---- derive_master_key + compute_auth_hash (TestDeriveAndHash) ----

    #[test]
    fn same_password_same_salt_same_key() {
        let salt = derive_salt("org_test_123");
        let k1 = derive_master_key("password", &salt).unwrap();
        let k2 = derive_master_key("password", &salt).unwrap();
        assert_eq!(k1, k2);
    }

    #[test]
    fn different_passwords_different_keys() {
        let salt = derive_salt("org_test_123");
        let k1 = derive_master_key("password_a", &salt).unwrap();
        let k2 = derive_master_key("password_b", &salt).unwrap();
        assert_ne!(k1, k2);
    }

    #[test]
    fn master_key_length() {
        let salt = derive_salt("org_test_123");
        assert_eq!(derive_master_key("pw", &salt).unwrap().len(), 32);
    }

    #[test]
    fn auth_hash_is_hex_64() {
        let salt = derive_salt("org_test_123");
        let mk = derive_master_key("pw", &salt).unwrap();
        let h = compute_auth_hash(&mk);
        assert_eq!(h.len(), 64);
        assert!(h.chars().all(|c| c.is_ascii_hexdigit())); // valid hex
    }

    // ---- wrap_org_key / unwrap_org_key (TestWrapUnwrapOrgKey) ----

    #[test]
    fn wrap_unwrap_roundtrip() {
        let mk = derive_master_key("pw", &derive_salt("org_test_wrap")).unwrap();
        let org_key = generate_org_encryption_key();
        let wrapped = wrap_org_key(&mk, &org_key, "").unwrap();
        let recovered = unwrap_org_key(&mk, &wrapped, "").unwrap();
        assert_eq!(recovered, org_key);
    }

    #[test]
    fn wrap_wrong_key_fails() {
        let salt = derive_salt("org_test_wrap");
        let mk1 = derive_master_key("right", &salt).unwrap();
        let mk2 = derive_master_key("wrong", &salt).unwrap();
        let org_key = generate_org_encryption_key();
        let wrapped = wrap_org_key(&mk1, &org_key, "").unwrap();
        assert!(unwrap_org_key(&mk2, &wrapped, "").is_err());
    }

    // ---- encrypt_payload / decrypt_payload (TestEncryptDecryptPayload) ----

    #[test]
    fn payload_roundtrip() {
        let org_key = generate_org_encryption_key();
        let payload = json!({"username": "admin", "password": "s3cret", "url": "https://x.com"});
        let enc = encrypt_payload(&org_key, &payload, "").unwrap();
        let dec = decrypt_payload(&org_key, &enc, "").unwrap();
        assert_eq!(dec, payload);
    }

    #[test]
    fn payload_different_keys_fail() {
        let k1 = generate_org_encryption_key();
        let k2 = generate_org_encryption_key();
        let enc = encrypt_payload(&k1, &json!({"a": 1}), "").unwrap();
        assert!(decrypt_payload(&k2, &enc, "").is_err());
    }

    // ---- generate_vault_key_material (TestGenerateVaultKeyMaterial) ----

    #[test]
    fn material_roundtrip() {
        let org_key = generate_org_encryption_key();
        let mat = generate_vault_key_material(
            VALID_VAULT_KEY,
            "org_test_123",
            &org_key,
            VaultKeyType::Primary,
        )
        .unwrap();
        assert_eq!(mat.key_type, VaultKeyType::Primary);
        // Re-derive and verify.
        let salt = derive_salt("org_test_123");
        let mk = derive_master_key(VALID_VAULT_KEY, &salt).unwrap();
        assert_eq!(compute_auth_hash(&mk), mat.auth_hash);
        let recovered =
            unwrap_org_key(&mk, &mat.wrapped_org_encryption_key, &mat.id.to_string()).unwrap();
        assert_eq!(recovered, org_key);
    }

    #[test]
    fn material_type_override() {
        let org_key = generate_org_encryption_key();
        let mat = generate_vault_key_material(
            VALID_VAULT_KEY,
            "org_test_123",
            &org_key,
            VaultKeyType::Recovery,
        )
        .unwrap();
        assert_eq!(mat.key_type, VaultKeyType::Recovery);
    }

    #[test]
    fn material_rejects_weak_key() {
        let org_key = generate_org_encryption_key();
        let e = generate_vault_key_material("short", "org_test_123", &org_key, VaultKeyType::Primary)
            .unwrap_err();
        assert!(e.to_string().contains("at least 16 characters"));
    }

    // ---- generate_recovery_code (TestGenerateRecoveryCode) ----

    #[test]
    fn recovery_code_format() {
        let org_key = generate_org_encryption_key();
        let (code, mat) = generate_recovery_code("org_test_123", &org_key).unwrap();
        let parts: Vec<&str> = code.split('-').collect();
        assert_eq!(parts.len(), 8);
        assert!(parts.iter().all(|p| p.len() == 4));
        assert_eq!(mat.key_type, VaultKeyType::Recovery);
    }

    #[test]
    fn recovery_code_roundtrip() {
        let org_key = generate_org_encryption_key();
        let (code, mat) = generate_recovery_code("org_test_123", &org_key).unwrap();
        let salt = derive_salt("org_test_123");
        let mk = derive_master_key(&code, &salt).unwrap();
        assert_eq!(compute_auth_hash(&mk), mat.auth_hash);
        let recovered =
            unwrap_org_key(&mk, &mat.wrapped_org_encryption_key, &mat.id.to_string()).unwrap();
        assert_eq!(recovered, org_key);
    }

    #[test]
    fn recovery_codes_are_unique() {
        let org_key = generate_org_encryption_key();
        let (c1, _) = generate_recovery_code("org_test_123", &org_key).unwrap();
        let (c2, _) = generate_recovery_code("org_test_123", &org_key).unwrap();
        assert_ne!(c1, c2);
    }

    // ---- cross-SDK compatibility (mirrors TS "cross-SDK compatibility") ----

    #[test]
    fn cross_sdk_auth_hash_for_known_inputs() {
        // This prefix was verified against the Python and TypeScript SDKs:
        // SHA-256(Argon2id("test-password", salt = "org_test_123")) must match
        // byte-for-byte across all three, or vault keys are not interoperable.
        let salt = derive_salt("org_test_123");
        let mk = derive_master_key("test-password", &salt).unwrap();
        let hash = compute_auth_hash(&mk);
        assert!(hash.starts_with("056863c98cd0759f"), "got {hash}");
    }
}

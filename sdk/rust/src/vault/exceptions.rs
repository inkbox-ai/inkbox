//! Vault-domain exceptions.
//!
//! Port of `inkbox/vault/exceptions.py`, which re-exports
//! `InkboxAPIError`/`InkboxError`/`InkboxVaultKeyError` from the canonical
//! `inkbox.exceptions` module. In Rust the whole hierarchy collapses into the
//! single [`InkboxError`] enum, so vault key failures map onto
//! [`InkboxError::VaultKey`] and the `ValueError`/`TypeError` validation
//! failures the Python code raises map onto [`InkboxError::InvalidArgument`].

pub use crate::error::InkboxError;

/// Construct the `InkboxVaultKeyError` equivalent: a vault key validation or
/// crypto failure mapped onto [`InkboxError::VaultKey`].
pub fn vault_key_error(message: impl Into<String>) -> InkboxError {
    InkboxError::VaultKey(message.into())
}

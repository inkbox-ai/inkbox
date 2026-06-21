//! Mail-domain exceptions.
//!
//! Re-exports the canonical error types from [`crate::error`] for parity with
//! the Python `inkbox/mail/exceptions.py`, which re-exports
//! `InkboxAPIError`/`InkboxError` from `inkbox.exceptions`. In Rust the whole
//! hierarchy collapses into the single [`InkboxError`] enum.

pub use crate::error::InkboxError;

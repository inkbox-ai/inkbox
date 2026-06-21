//! Phone-domain exception aliases.
//!
//! Mirrors `inkbox/phone/exceptions.py`, which re-exports the canonical error
//! types for backward compatibility. In Rust the single [`InkboxError`] enum
//! stands in for both `InkboxError` and `InkboxAPIError`.

pub use crate::error::InkboxError;

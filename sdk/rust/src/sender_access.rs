//! Admission of a specific inbound message, not trust or command permission.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SenderAccess {
    /// Passed contact rules at receipt, including allowed by default.
    Direct,
    /// Default-filtered at receipt and admitted through conversation sponsorship.
    Sponsored,
}

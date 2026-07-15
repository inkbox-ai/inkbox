//! Resource models for the Tunnels SDK surface.
//!
//! Ported from `inkbox/tunnels/types.py`. The wire shape (JSON field names,
//! enum string values) matches the Python source exactly.

use std::collections::BTreeMap;

use serde_json::Value;
use uuid::Uuid;

use crate::error::{InkboxError, Result};

/// How TLS termination is performed for inbound third-party traffic.
///
/// - `edge`: TLS terminates at Inkbox's edge using a managed cert; the agent
///   forwards plaintext to your local handler. Default.
/// - `passthrough`: you hold the cert + private key and terminate TLS in your
///   own client. Obtain a per-tunnel cert via [`TunnelsResource::sign_csr`].
///
/// [`TunnelsResource::sign_csr`]: crate::tunnels::resources::TunnelsResource::sign_csr
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TLSMode {
    /// TLS terminates at Inkbox's edge using a managed cert. Default.
    Edge,
    /// You terminate TLS in your own client with a per-tunnel signed cert.
    Passthrough,
}

/// Lifecycle state of a tunnel.
///
/// - `awaiting_cert`: passthrough-only intermediate state — the tunnel exists
///   but no cert has been signed yet. Inbound TLS handshakes fail until you
///   call [`TunnelsResource::sign_csr`].
/// - `active`: routable end-to-end.
/// - `deleted`: terminal. The tunnel is offline. Tunnels are deleted
///   exclusively via the identity-delete cascade — there is no direct
///   tunnel-delete surface.
///
/// [`TunnelsResource::sign_csr`]: crate::tunnels::resources::TunnelsResource::sign_csr
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TunnelStatus {
    /// Passthrough-only intermediate state; awaiting a signed cert.
    AwaitingCert,
    /// Routable end-to-end.
    Active,
    /// Terminal. The tunnel is offline.
    Deleted,
}

/// A tunnel's lifecycle state: a known [`TunnelStatus`] for any value the SDK
/// recognizes, otherwise the raw server string.
///
/// New lifecycle states added server-side surface unmodified rather than
/// getting silently coerced — comparisons against a [`TunnelStatus`] member
/// correctly fail for an unknown value, prompting an SDK update. Mirrors the
/// Python `TunnelStatus | str` union on [`Tunnel::status`].
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(untagged)]
pub enum TunnelStatusValue {
    /// A status the SDK knows about.
    Known(TunnelStatus),
    /// An unknown future status — the raw server string, preserved verbatim.
    Unknown(String),
}

/// Public view of a tunnel record.
///
/// `status` is a [`TunnelStatus`] for any value the SDK knows about, otherwise
/// the raw server string (see [`TunnelStatusValue`]).
///
/// `public_host` and `zone` are guaranteed non-empty for live tunnels; the
/// parser ([`Tunnel::from_value`]) errors on missing values.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Tunnel {
    pub id: Uuid,
    pub organization_id: String,
    pub tunnel_name: String,
    /// Owning identity id (tunnels are 1:1 with identities). `None` only for
    /// pre-coupling tombstone rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    pub tls_mode: TLSMode,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_pem: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_fingerprint_sha256: Option<String>,
    /// ISO-8601 timestamp; `None` when the tunnel has no cert.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cert_expires_at: Option<String>,
    pub status: TunnelStatusValue,
    /// ISO-8601 timestamp; `None` if the tunnel has never connected.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_connected_ip_addr: Option<String>,
    pub currently_connected: bool,
    /// Customer-facing hostname (e.g. `my-agent.inkboxwire.com`). Non-empty
    /// for live tunnels.
    pub public_host: String,
    /// Zone endpoint for the data-plane. Non-empty for live tunnels.
    pub zone: String,
    pub metadata: BTreeMap<String, Value>,
    /// ISO-8601 timestamp.
    pub created_at: String,
    /// ISO-8601 timestamp.
    pub updated_at: String,
}

impl Tunnel {
    /// Parse a raw server JSON object into a [`Tunnel`].
    ///
    /// Mirrors Python's `Tunnel._from_dict`: an unknown `status` is preserved
    /// as a raw string rather than coerced, and missing/empty `public_host`
    /// or `zone` raise an error (the fields are guaranteed for live tunnels).
    ///
    /// # Arguments
    /// * `data` - The raw JSON object from the server.
    ///
    /// # Returns
    /// The parsed [`Tunnel`].
    pub fn from_value(data: &Value) -> Result<Tunnel> {
        let obj = data
            .as_object()
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel response was not an object")))?;

        // `id`: UUID parsed from its string form (matches `UUID(str(...))`).
        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel response missing valid 'id'")))?;

        let organization_id = str_field(obj, "organization_id")?;
        let tunnel_name = str_field(obj, "tunnel_name")?;

        let agent_identity_id = obj
            .get("agent_identity_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());

        // `tls_mode`: a closed enum — coerce the raw string through serde.
        let tls_mode: TLSMode =
            serde_json::from_value(obj.get("tls_mode").cloned().unwrap_or(Value::Null))?;

        // `status`: known member if recognized, else the raw string (no
        // fail-open coercion — future states surface unmodified).
        let raw_status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel response missing 'status'")))?;
        let status = match serde_json::from_value::<TunnelStatus>(Value::String(raw_status.into()))
        {
            Ok(known) => TunnelStatusValue::Known(known),
            Err(_) => TunnelStatusValue::Unknown(raw_status.to_string()),
        };

        // `metadata`: any non-object (or absent) value collapses to `{}`.
        let metadata: BTreeMap<String, Value> = match obj.get("metadata") {
            Some(Value::Object(m)) => m.clone().into_iter().collect(),
            _ => BTreeMap::new(),
        };

        // `public_host` / `zone`: required and non-empty for live tunnels.
        let public_host = match obj.get("public_host").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                return Err(InkboxError::Decode(de_err(
                    "tunnel response missing required field 'public_host'",
                )))
            }
        };
        let zone = match obj.get("zone").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                return Err(InkboxError::Decode(de_err(
                    "tunnel response missing required field 'zone'",
                )))
            }
        };

        Ok(Tunnel {
            id,
            organization_id,
            tunnel_name,
            agent_identity_id,
            tls_mode,
            cert_pem: opt_str(obj, "cert_pem"),
            cert_fingerprint_sha256: opt_str(obj, "cert_fingerprint_sha256"),
            cert_expires_at: opt_str(obj, "cert_expires_at"),
            status,
            last_connected_at: opt_str(obj, "last_connected_at"),
            last_connected_ip_addr: opt_str(obj, "last_connected_ip_addr"),
            // `bool(data.get("currently_connected", False))`.
            currently_connected: obj
                .get("currently_connected")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            public_host,
            zone,
            metadata,
            created_at: str_field(obj, "created_at")?,
            updated_at: str_field(obj, "updated_at")?,
        })
    }
}


/// Durable-config projection of a tunnel, embedded in identity payloads.
///
/// Carries the routing and lifecycle facts identity views need, plus the ids
/// to reach the full tunnel. Excludes runtime state (`currently_connected`)
/// and cert material — fetch the full [`Tunnel`] via `tunnels().get(...)` for
/// those; the tunnels endpoints always resolve connection state live.
///
/// `status` follows the same unknown-value contract as [`Tunnel`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct TunnelSummary {
    pub id: Uuid,
    pub tunnel_name: String,
    /// Owning identity id (tunnels are 1:1 with identities). `None` only for
    /// pre-coupling tombstone rows.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub agent_identity_id: Option<Uuid>,
    pub tls_mode: TLSMode,
    pub status: TunnelStatusValue,
    /// Customer-facing hostname (e.g. `my-agent.inkboxwire.com`). Non-empty
    /// for live tunnels.
    pub public_host: String,
    /// Zone endpoint for the data-plane. Non-empty for live tunnels.
    pub zone: String,
    /// ISO-8601 timestamp.
    pub created_at: String,
    /// ISO-8601 timestamp.
    pub updated_at: String,
}

impl TunnelSummary {
    /// Parse a raw server JSON object into a [`TunnelSummary`].
    ///
    /// Same contracts as [`Tunnel::from_value`]: unknown `status` values are
    /// preserved as raw strings, and missing/empty `public_host` or `zone`
    /// error.
    ///
    /// # Arguments
    /// * `data` - The raw JSON object from the server.
    ///
    /// # Returns
    /// The parsed [`TunnelSummary`].
    pub fn from_value(data: &Value) -> Result<TunnelSummary> {
        let obj = data
            .as_object()
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel summary was not an object")))?;

        let id = obj
            .get("id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok())
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel summary missing valid 'id'")))?;

        let tunnel_name = str_field(obj, "tunnel_name")?;

        let agent_identity_id = obj
            .get("agent_identity_id")
            .and_then(|v| v.as_str())
            .and_then(|s| Uuid::parse_str(s).ok());

        let tls_mode: TLSMode =
            serde_json::from_value(obj.get("tls_mode").cloned().unwrap_or(Value::Null))?;

        let raw_status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .ok_or_else(|| InkboxError::Decode(de_err("tunnel summary missing 'status'")))?;
        let status = match serde_json::from_value::<TunnelStatus>(Value::String(raw_status.into()))
        {
            Ok(known) => TunnelStatusValue::Known(known),
            Err(_) => TunnelStatusValue::Unknown(raw_status.to_string()),
        };

        let public_host = match obj.get("public_host").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                return Err(InkboxError::Decode(de_err(
                    "tunnel summary missing required field 'public_host'",
                )))
            }
        };
        let zone = match obj.get("zone").and_then(|v| v.as_str()) {
            Some(s) if !s.is_empty() => s.to_string(),
            _ => {
                return Err(InkboxError::Decode(de_err(
                    "tunnel summary missing required field 'zone'",
                )))
            }
        };

        Ok(TunnelSummary {
            id,
            tunnel_name,
            agent_identity_id,
            tls_mode,
            status,
            public_host,
            zone,
            created_at: str_field(obj, "created_at")?,
            updated_at: str_field(obj, "updated_at")?,
        })
    }
}

/// Result of [`TunnelsResource::sign_csr`] (passthrough only).
///
/// [`TunnelsResource::sign_csr`]: crate::tunnels::resources::TunnelsResource::sign_csr
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct SignedCert {
    pub cert_pem: String,
    pub chain_pem: String,
    pub cert_fingerprint_sha256: String,
    /// ISO-8601 timestamp.
    pub cert_expires_at: String,
}

impl SignedCert {
    /// Parse a raw server JSON object into a [`SignedCert`]. Mirrors Python's
    /// `SignedCert._from_dict`; all four fields are required.
    ///
    /// # Arguments
    /// * `data` - The raw JSON object from the server.
    ///
    /// # Returns
    /// The parsed [`SignedCert`].
    pub fn from_value(data: &Value) -> Result<SignedCert> {
        let obj = data
            .as_object()
            .ok_or_else(|| InkboxError::Decode(de_err("signed-cert response was not an object")))?;
        Ok(SignedCert {
            cert_pem: str_field(obj, "cert_pem")?,
            chain_pem: str_field(obj, "chain_pem")?,
            cert_fingerprint_sha256: str_field(obj, "cert_fingerprint_sha256")?,
            cert_expires_at: str_field(obj, "cert_expires_at")?,
        })
    }
}

// --- Parsing helpers -----------------------------------------------------

/// Build a `serde_json` decode error carrying `msg` (so parser failures map
/// onto [`InkboxError::Decode`], matching the contract for malformed bodies).
fn de_err(msg: &str) -> serde_json::Error {
    serde::de::Error::custom(msg)
}

/// Required string field, coerced via `str(...)` semantics (must be present
/// and a JSON string).
fn str_field(obj: &serde_json::Map<String, Value>, key: &str) -> Result<String> {
    obj.get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| InkboxError::Decode(de_err(&format!("tunnel response missing '{key}'"))))
}

/// Optional string field: `None` when absent or JSON null.
fn opt_str(obj: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    obj.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
}

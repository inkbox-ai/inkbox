//! Directional communication access and atomic contact-policy edits.

use super::resources::communication_policy::*;
use super::types::ContactChannelAccess;
use crate::ContactRuleDirection;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(from = "ChannelAccessWire")]
pub struct DirectionalContactChannelAccess {
    pub access: ContactChannelAccess,
    pub inbound_contactable: Vec<String>,
    pub outbound_contactable: Vec<String>,
}

#[derive(Deserialize)]
struct ChannelAccessWire {
    #[serde(flatten)]
    access: ContactChannelAccess,
    inbound_contactable: Option<Vec<String>>,
    outbound_contactable: Option<Vec<String>>,
}

impl From<ChannelAccessWire> for DirectionalContactChannelAccess {
    fn from(wire: ChannelAccessWire) -> Self {
        Self {
            inbound_contactable: wire
                .inbound_contactable
                .unwrap_or_else(|| wire.access.contactable.clone()),
            outbound_contactable: wire
                .outbound_contactable
                .unwrap_or_else(|| wire.access.contactable.clone()),
            access: wire.access,
        }
    }
}

impl std::ops::Deref for DirectionalContactChannelAccess {
    type Target = ContactChannelAccess;
    fn deref(&self) -> &Self::Target {
        &self.access
    }
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
pub struct DirectionalContactAccessSettings {
    pub email: DirectionalContactChannelAccess,
    pub phone: DirectionalContactChannelAccess,
    pub profile: bool,
    pub memories: bool,
}

/// Empty lists deny all current addresses on the named side; omitted lists preserve it.
#[derive(Debug, Clone, Default, Serialize)]
pub struct DirectionalContactChannelAccessUpdate {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible: Option<bool>,
    /// Legacy writes set both sides. Do not combine with directional lists.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub contactable: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inbound_contactable: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub outbound_contactable: Option<Vec<String>>,
}

impl DirectionalContactChannelAccessUpdate {
    fn enabled(&self) -> bool {
        self.visible == Some(true) || self.has_addresses()
    }
    fn has_addresses(&self) -> bool {
        [
            &self.contactable,
            &self.inbound_contactable,
            &self.outbound_contactable,
        ]
        .iter()
        .any(|v| v.as_ref().is_some_and(|v| !v.is_empty()))
    }
    fn validate(&self) -> crate::Result<()> {
        if self.contactable.is_some()
            && (self.inbound_contactable.is_some() || self.outbound_contactable.is_some())
        {
            return Err(crate::InkboxError::InvalidArgument(
                "contactable and directional lists cannot be combined for the same group".into(),
            ));
        }
        if self.visible == Some(false) && self.has_addresses() {
            return Err(crate::InkboxError::InvalidArgument(
                "hidden groups cannot have contactable addresses".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct UpdateDirectionalContactAccess {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<DirectionalContactChannelAccessUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone: Option<DirectionalContactChannelAccessUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub memories: Option<bool>,
}

impl UpdateDirectionalContactAccess {
    pub(crate) fn validate(&self) -> crate::Result<()> {
        for group in [&self.email, &self.phone].into_iter().flatten() {
            group.validate()?;
        }
        if self.profile == Some(false)
            && (self.memories == Some(true)
                || [&self.email, &self.phone]
                    .into_iter()
                    .flatten()
                    .any(|g| g.enabled()))
        {
            return Err(crate::InkboxError::InvalidArgument(
                "Profile cannot be disabled while email, phone, or memories is enabled".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct DirectionalContactCreatePermissions {
    pub identity_id: uuid::Uuid,
    #[serde(flatten)]
    pub access: UpdateDirectionalContactAccess,
}

/// Pair-aware optimistic edit. Omitted direction retains the Both default.
#[derive(Debug, Clone, Serialize)]
pub struct DirectionalContactAddressUpdate {
    pub kind: ContactAddressKind,
    pub value: String,
    pub action: ContactDecision,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<ContactRuleDirection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_action: Option<ContactDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_inbound_action: Option<ContactDecision>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub expected_outbound_action: Option<ContactDecision>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplaceDirectionalContactCommunicationPolicy {
    pub expected_revision: u64,
    pub identity_id: uuid::Uuid,
    pub addresses: Vec<DirectionalContactAddressUpdate>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visibility: Option<ContactVisibilityPolicy>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct DirectionalContactCommunicationPolicy {
    pub contact_id: uuid::Uuid,
    pub revision: u64,
    pub identity_id: Option<uuid::Uuid>,
    pub addresses: Vec<DirectionalContactAddressPermission>,
    pub effective_visibility: Option<ContactVisibilityResult>,
    pub visibility: ContactVisibilityPolicy,
}

#[derive(Debug, Clone)]
pub struct DirectionalContactAddressPermission {
    pub permission: ContactAddressPermission,
    pub inbound_action: ContactDecision,
    pub outbound_action: ContactDecision,
    pub allowed_inbound: bool,
    pub allowed_outbound: bool,
}

impl<'de> Deserialize<'de> for DirectionalContactAddressPermission {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        let permission: ContactAddressPermission =
            serde_json::from_value(v.clone()).map_err(serde::de::Error::custom)?;
        macro_rules! field {
            ($key:literal, $fallback:expr) => {
                v.get($key)
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(serde::de::Error::custom)?
                    .unwrap_or($fallback)
            };
        }
        Ok(Self {
            inbound_action: field!("inbound_action", permission.action),
            outbound_action: field!("outbound_action", permission.action),
            allowed_inbound: field!("allowed_inbound", permission.allowed),
            allowed_outbound: field!("allowed_outbound", permission.allowed),
            permission,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DirectionalContactPermissionEntry {
    pub contact: ContactPermissionSummary,
    pub revision: u64,
    pub visibility: ContactPermissionVisibility,
    pub effective: DirectionalContactPermissionEffective,
    pub access: Option<DirectionalContactAccessSettings>,
}

#[derive(Debug, Clone)]
pub struct DirectionalContactPermissionEffective {
    pub effective: ContactPermissionEffective,
    pub inbound_email: IdentifierPermission,
    pub outbound_email: IdentifierPermission,
    pub inbound_phone: IdentifierPermission,
    pub outbound_phone: IdentifierPermission,
}

impl<'de> Deserialize<'de> for DirectionalContactPermissionEffective {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        let effective: ContactPermissionEffective =
            serde_json::from_value(v.clone()).map_err(serde::de::Error::custom)?;
        macro_rules! field {
            ($key:literal, $fallback:expr) => {
                v.get($key)
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(serde::de::Error::custom)?
                    .unwrap_or($fallback)
            };
        }
        Ok(Self {
            inbound_email: field!("inbound_email", effective.email),
            outbound_email: field!("outbound_email", effective.email),
            inbound_phone: field!("inbound_phone", effective.phone),
            outbound_phone: field!("outbound_phone", effective.phone),
            effective,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DirectionalContactPermissionPage {
    pub items: Vec<DirectionalContactPermissionEntry>,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

#[derive(Debug, Clone)]
pub struct DirectionalContactCommunicationPreview {
    pub preview: ContactCommunicationPreview,
    pub inbound_email: Option<bool>,
    pub outbound_email: Option<bool>,
    pub inbound_phone: Option<bool>,
    pub outbound_phone: Option<bool>,
}

impl<'de> Deserialize<'de> for DirectionalContactCommunicationPreview {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = serde_json::Value::deserialize(d)?;
        let preview: ContactCommunicationPreview =
            serde_json::from_value(v.clone()).map_err(serde::de::Error::custom)?;
        macro_rules! field {
            ($key:literal, $fallback:expr) => {
                v.get($key)
                    .cloned()
                    .map(serde_json::from_value)
                    .transpose()
                    .map_err(serde::de::Error::custom)?
                    .unwrap_or($fallback)
            };
        }
        Ok(Self {
            inbound_email: field!("inbound_email", None),
            outbound_email: field!("outbound_email", None),
            inbound_phone: field!("inbound_phone", None),
            outbound_phone: field!("outbound_phone", None),
            preview,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct DirectionalContactCommunicationPolicyPage {
    pub items: Vec<DirectionalContactCommunicationPreview>,
    pub limit: u64,
    pub offset: u64,
    pub has_more: bool,
}

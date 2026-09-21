//! Effective directional modes without changing legacy identity models.

use super::types::{AgentIdentityData, AgentIdentitySummary, IdentityMailbox, IdentityPhoneNumber};
use crate::mail::types::FilterMode;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize)]
pub struct DirectionalChannel<T> {
    #[serde(flatten)]
    pub channel: T,
    pub inbound_filter_mode: FilterMode,
    pub outbound_filter_mode: FilterMode,
}

impl<'de, T: serde::de::DeserializeOwned> Deserialize<'de> for DirectionalChannel<T> {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        let shared = value
            .get("filter_mode")
            .cloned()
            .unwrap_or(serde_json::json!("blacklist"));
        Ok(Self {
            inbound_filter_mode: serde_json::from_value(
                value
                    .get("inbound_filter_mode")
                    .cloned()
                    .unwrap_or(shared.clone()),
            )
            .map_err(serde::de::Error::custom)?,
            outbound_filter_mode: serde_json::from_value(
                value.get("outbound_filter_mode").cloned().unwrap_or(shared),
            )
            .map_err(serde::de::Error::custom)?,
            channel: serde_json::from_value(value).map_err(serde::de::Error::custom)?,
        })
    }
}

/// Legacy summary plus effective modes and enriched linked channels.
#[derive(Debug, Clone)]
pub struct DirectionalAgentIdentitySummary {
    pub summary: AgentIdentitySummary,
    pub mail_inbound_filter_mode: FilterMode,
    pub mail_outbound_filter_mode: FilterMode,
    pub phone_inbound_filter_mode: FilterMode,
    pub phone_outbound_filter_mode: FilterMode,
    pub mailbox: Option<DirectionalChannel<IdentityMailbox>>,
    pub phone_number: Option<DirectionalChannel<IdentityPhoneNumber>>,
}

impl std::ops::Deref for DirectionalAgentIdentitySummary {
    type Target = AgentIdentitySummary;
    fn deref(&self) -> &Self::Target {
        &self.summary
    }
}

impl<'de> Deserialize<'de> for DirectionalAgentIdentitySummary {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let value = Value::deserialize(d)?;
        let summary =
            AgentIdentitySummary::from_value(value.clone()).map_err(serde::de::Error::custom)?;
        let mode = |key: &str, fallback: FilterMode| -> Result<FilterMode, D::Error> {
            value
                .get(key)
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(serde::de::Error::custom)
                .map(|v| v.unwrap_or(fallback))
        };
        let mut mailbox: Option<DirectionalChannel<IdentityMailbox>> = value
            .get("mailbox")
            .cloned()
            .map(serde_json::from_value)
            .transpose()
            .map_err(serde::de::Error::custom)?
            .flatten();
        if let (Some(channel), Some(normalized)) = (&mut mailbox, &summary.mailbox) {
            channel.channel = normalized.clone();
        }
        Ok(Self {
            mail_inbound_filter_mode: mode("mail_inbound_filter_mode", summary.mail_filter_mode)?,
            mail_outbound_filter_mode: mode("mail_outbound_filter_mode", summary.mail_filter_mode)?,
            phone_inbound_filter_mode: mode(
                "phone_inbound_filter_mode",
                summary.phone_filter_mode,
            )?,
            phone_outbound_filter_mode: mode(
                "phone_outbound_filter_mode",
                summary.phone_filter_mode,
            )?,
            mailbox,
            phone_number: value
                .get("phone_number")
                .cloned()
                .map(serde_json::from_value)
                .transpose()
                .map_err(serde::de::Error::custom)?
                .flatten(),
            summary,
        })
    }
}

impl Serialize for DirectionalAgentIdentitySummary {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut value = serde_json::to_value(&self.summary).map_err(serde::ser::Error::custom)?;
        for (key, mode) in [
            ("mail_inbound_filter_mode", self.mail_inbound_filter_mode),
            ("mail_outbound_filter_mode", self.mail_outbound_filter_mode),
            ("phone_inbound_filter_mode", self.phone_inbound_filter_mode),
            (
                "phone_outbound_filter_mode",
                self.phone_outbound_filter_mode,
            ),
        ] {
            value[key] = serde_json::to_value(mode).map_err(serde::ser::Error::custom)?;
        }
        value["mailbox"] =
            serde_json::to_value(&self.mailbox).map_err(serde::ser::Error::custom)?;
        value["phone_number"] =
            serde_json::to_value(&self.phone_number).map_err(serde::ser::Error::custom)?;
        value.serialize(serializer)
    }
}

pub type DirectionalAgentIdentityData = DirectionalAgentIdentitySummary;

impl DirectionalAgentIdentitySummary {
    pub fn into_legacy(self) -> AgentIdentityData {
        AgentIdentityData {
            summary: self.summary,
        }
    }
}

/// Omitted modes are preserved; shared writes set both directions.
#[derive(Debug, Clone, Default, Serialize)]
pub struct IdentityFilterModeOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imessage_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_inbound_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mail_outbound_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_inbound_filter_mode: Option<FilterMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub phone_outbound_filter_mode: Option<FilterMode>,
}

impl IdentityFilterModeOptions {
    pub(crate) fn validate(&self) -> crate::Result<()> {
        if (self.mail_filter_mode.is_some()
            && (self.mail_inbound_filter_mode.is_some()
                || self.mail_outbound_filter_mode.is_some()))
            || ((self.phone_filter_mode.is_some() || self.imessage_filter_mode.is_some())
                && (self.phone_inbound_filter_mode.is_some()
                    || self.phone_outbound_filter_mode.is_some()))
        {
            return Err(crate::InkboxError::InvalidArgument(
                "shared and directional modes cannot be combined for the same channel".into(),
            ));
        }
        if let (Some(phone), Some(imessage)) = (self.phone_filter_mode, self.imessage_filter_mode) {
            if phone != imessage {
                return Err(crate::InkboxError::InvalidArgument(
                    "phone and iMessage modes must agree".into(),
                ));
            }
        }
        Ok(())
    }
}

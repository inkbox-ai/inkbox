//! Types for the org-scoped Contacts API.
//!
//! Port of `inkbox/contacts/types.py`. Each contact sub-object has a distinct
//! wire shape (phones use `value_e164`, websites use `url`, addresses use
//! `postal`) so the structs carry explicit serde renames and a `to_wire()`
//! helper that omits `None`/default keys exactly like the Python `to_wire`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

/// An email address on a contact card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactEmail {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    pub value: String,
    #[serde(default)]
    pub is_primary: bool,
}

impl ContactEmail {
    /// Build the wire dict, omitting `label` when None and `is_primary` when false.
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        body.insert("value".into(), json!(self.value));
        if let Some(label) = &self.label {
            body.insert("label".into(), json!(label));
        }
        if self.is_primary {
            body.insert("is_primary".into(), json!(true));
        }
        Value::Object(body)
    }
}

/// A phone number on a contact card (stored E.164).
///
/// The wire field is `value_e164`; the SDK exposes it as `value`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactPhone {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "value_e164")]
    pub value: String,
    #[serde(default)]
    pub is_primary: bool,
}

impl ContactPhone {
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        body.insert("value_e164".into(), json!(self.value));
        if let Some(label) = &self.label {
            body.insert("label".into(), json!(label));
        }
        if self.is_primary {
            body.insert("is_primary".into(), json!(true));
        }
        Value::Object(body)
    }
}

/// A website on a contact card. The wire field is `url`; exposed as `value`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactWebsite {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "url")]
    pub value: String,
}

impl ContactWebsite {
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        body.insert("url".into(), json!(self.value));
        if let Some(label) = &self.label {
            body.insert("label".into(), json!(label));
        }
        Value::Object(body)
    }
}

/// A labelled date on a contact card. The wire field is `date`; the value is an
/// ISO date string (`YYYY-MM-DD`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactDate {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(rename = "date")]
    pub value: String,
}

impl ContactDate {
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        body.insert("date".into(), json!(self.value));
        if let Some(label) = &self.label {
            body.insert("label".into(), json!(label));
        }
        Value::Object(body)
    }
}

/// A postal address on a contact card. The wire field for the postcode is
/// `postal`; the SDK exposes it as `postal_code`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactAddress {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub street: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub city: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub region: Option<String>,
    #[serde(rename = "postal", default, skip_serializing_if = "Option::is_none")]
    pub postal_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub country: Option<String>,
}

impl ContactAddress {
    pub fn to_wire(&self) -> Value {
        let mut body = Map::new();
        // Python emits label/street/city/region/country under their own names,
        // then postal_code under the `postal` key — all omitted when None.
        if let Some(label) = &self.label {
            body.insert("label".into(), json!(label));
        }
        if let Some(street) = &self.street {
            body.insert("street".into(), json!(street));
        }
        if let Some(city) = &self.city {
            body.insert("city".into(), json!(city));
        }
        if let Some(region) = &self.region {
            body.insert("region".into(), json!(region));
        }
        if let Some(country) = &self.country {
            body.insert("country".into(), json!(country));
        }
        if let Some(postal) = &self.postal_code {
            body.insert("postal".into(), json!(postal));
        }
        Value::Object(body)
    }
}

/// A free-form labelled custom field on a contact card.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactCustomField {
    pub label: String,
    pub value: String,
}

impl ContactCustomField {
    pub fn to_wire(&self) -> Value {
        json!({ "label": self.label, "value": self.value })
    }
}

/// A single access grant on a contact.
///
/// `identity_id == None` means the grant is a wildcard — every active identity
/// can see the contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactAccess {
    pub id: Uuid,
    pub contact_id: Uuid,
    #[serde(default)]
    pub identity_id: Option<Uuid>,
    /// ISO-8601 timestamp string.
    pub created_at: String,
}

/// A contact (address-book entry) owned by your organisation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Contact {
    pub id: Uuid,
    #[serde(default)]
    pub preferred_name: Option<String>,
    #[serde(default)]
    pub name_prefix: Option<String>,
    #[serde(default)]
    pub given_name: Option<String>,
    #[serde(default)]
    pub middle_name: Option<String>,
    #[serde(default)]
    pub family_name: Option<String>,
    #[serde(default)]
    pub name_suffix: Option<String>,
    #[serde(default)]
    pub company_name: Option<String>,
    #[serde(default)]
    pub job_title: Option<String>,
    /// ISO date (`YYYY-MM-DD`), or None.
    #[serde(default)]
    pub birthday: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub emails: Vec<ContactEmail>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub phones: Vec<ContactPhone>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub websites: Vec<ContactWebsite>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub dates: Vec<ContactDate>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub addresses: Vec<ContactAddress>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub custom_fields: Vec<ContactCustomField>,
    #[serde(default, deserialize_with = "null_as_default")]
    pub access: Vec<ContactAccess>,
    #[serde(default)]
    pub organization_id: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    /// ISO-8601 timestamp string.
    pub created_at: String,
    /// ISO-8601 timestamp string.
    pub updated_at: String,
}

/// One card's result inside a bulk vCard import response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactImportResultItem {
    /// 0-based position within the uploaded vCard stream.
    pub index: i64,
    /// `"created"` if the card was stored, `"error"` otherwise.
    pub status: String,
    /// The resulting contact when `status == "created"`; None otherwise.
    #[serde(default)]
    pub contact: Option<Contact>,
    /// The rejection reason when `status == "error"`; None otherwise.
    #[serde(default)]
    pub error: Option<String>,
}

/// Result of a bulk vCard import (always 200 when the request parsed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactImportResult {
    /// Number of cards that were stored.
    pub created_count: i64,
    /// Number of cards that failed to parse / validate.
    pub error_count: i64,
    /// Per-card outcome in submission order.
    #[serde(default, deserialize_with = "null_as_default")]
    pub results: Vec<ContactImportResultItem>,
}

impl ContactImportResult {
    /// IDs of successfully-created contacts, in submission order.
    pub fn created_ids(&self) -> Vec<Uuid> {
        self.results
            .iter()
            .filter_map(|item| item.contact.as_ref().map(|c| c.id))
            .collect()
    }

    /// Only the items whose `status == "error"`.
    pub fn errors(&self) -> Vec<&ContactImportResultItem> {
        self.results
            .iter()
            .filter(|item| item.status == "error")
            .collect()
    }
}

/// Deserialize a list field that the server may send as `null` into an empty
/// `Vec` (mirrors Python's `d.get(...) or []`).
fn null_as_default<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    let opt: Option<Vec<T>> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

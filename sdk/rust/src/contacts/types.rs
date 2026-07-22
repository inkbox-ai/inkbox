//! Types for the org-scoped Contacts API.
//!
//! Port of `inkbox/contacts/types.py`. Each contact sub-object has a distinct
//! wire shape (phones use `value_e164`, websites use `url`, addresses use
//! `postal`) so the structs carry explicit serde renames and a `to_wire()`
//! helper that omits `None`/default keys exactly like the Python `to_wire`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use uuid::Uuid;

/// How a contact was created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ContactCreationSource {
    Manual,
    Vcard,
    Communication,
    #[default]
    Backfill,
}

/// Contact review state.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ContactReviewStatus {
    Unreviewed,
    #[default]
    Confirmed,
}

impl ContactReviewStatus {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Unreviewed => "unreviewed",
            Self::Confirmed => "confirmed",
        }
    }
}

/// Source used to select a contact's preferred name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum ContactNameSource {
    #[default]
    Manual,
    Vcard,
    Provider,
    MailHeader,
    IdentifierFallback,
}

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

/// Deprecated read-only compatibility metadata for a contact.
///
/// These records do not restrict organization-wide contact visibility.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactAccess {
    pub id: Uuid,
    pub contact_id: Uuid,
    /// `None` is the legacy wildcard sentinel.
    #[serde(default)]
    pub identity_id: Option<Uuid>,
    /// ISO-8601 timestamp string.
    pub created_at: String,
}

/// The most recently updated active memory for a contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactMemorySummary {
    pub id: Uuid,
    pub content: String,
    /// ISO-8601 timestamp string.
    pub updated_at: String,
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
    pub creation_source: ContactCreationSource,
    #[serde(default)]
    pub review_status: ContactReviewStatus,
    #[serde(default)]
    pub reviewed_at: Option<String>,
    #[serde(default)]
    pub reviewed_by: Option<String>,
    #[serde(default)]
    pub preferred_name_source: ContactNameSource,
    #[serde(default)]
    pub preferred_name_locked_at: Option<String>,
    #[serde(default)]
    pub created_by_identity_id: Option<Uuid>,
    #[serde(default)]
    pub merged_into_contact_id: Option<Uuid>,
    #[serde(default)]
    pub is_auto_created: bool,
    #[serde(default = "default_true")]
    pub is_confirmed: bool,
    #[serde(default)]
    pub memory_count: Option<u64>,
    #[serde(default)]
    pub latest_memory: Option<ContactMemorySummary>,
    #[serde(default)]
    pub status: Option<String>,
    /// ISO-8601 timestamp string.
    pub created_at: String,
    /// ISO-8601 timestamp string.
    pub updated_at: String,
}

/// Availability of a fact's source to the current caller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactFactCitationAvailability {
    Available,
    Purged,
    SourceUnavailableToCaller,
}

/// A citation supporting a contact fact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactFactCitation {
    pub source_type: String,
    pub availability: ContactFactCitationAvailability,
    #[serde(default)]
    pub source_id: Option<Uuid>,
    #[serde(default)]
    pub source_url: Option<String>,
    #[serde(default)]
    pub source_locator: Option<Value>,
}

/// How a contact fact was created.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactFactOrigin {
    Generated,
    User,
}

/// A fact remembered about a contact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactFact {
    pub id: Uuid,
    pub contact_id: Uuid,
    pub content: String,
    #[serde(default, deserialize_with = "f64_from_number_or_string")]
    pub confidence: Option<f64>,
    pub origin: ContactFactOrigin,
    #[serde(default)]
    pub locked_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default, deserialize_with = "null_as_default")]
    pub citations: Vec<ContactFactCitation>,
}

/// Resolved details for a fact citation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactFactCitationDetail {
    pub source_type: String,
    pub source_id: Uuid,
    pub source_locator: Value,
    #[serde(default)]
    pub source_url: Option<String>,
}

/// Result of deleting one contact fact.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactFactDeleteResult {
    pub deleted_fact_id: Uuid,
    pub memory_count: u64,
    #[serde(default)]
    pub latest_memory: Option<ContactMemorySummary>,
}

/// Outcome for one card in a bulk vCard import.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactImportStatus {
    Created,
    Conflict,
    Error,
}

/// One card's result inside a bulk vCard import response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactImportResultItem {
    /// 0-based position within the uploaded vCard stream.
    pub index: i64,
    pub status: ContactImportStatus,
    /// The resulting contact when `status == "created"`; None otherwise.
    #[serde(default)]
    pub contact: Option<Contact>,
    /// The rejection reason when the card was not created.
    #[serde(default)]
    pub error: Option<String>,
    /// Existing contact that owns a conflicting identifier.
    #[serde(default)]
    pub conflicting_contact_id: Option<Uuid>,
}

/// Result of a bulk vCard import (always 200 when the request parsed).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactImportResult {
    /// Number of cards that were stored.
    pub created_count: i64,
    /// Number of cards that conflicted or failed validation.
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
            .filter(|item| item.status == ContactImportStatus::Error)
            .collect()
    }

    /// Only the items whose `status == "conflict"`.
    pub fn conflicts(&self) -> Vec<&ContactImportResultItem> {
        self.results
            .iter()
            .filter(|item| item.status == ContactImportStatus::Conflict)
            .collect()
    }
}

/// Outcome for one contact in a bulk deletion request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactBulkDeleteStatus {
    Deleted,
    Error,
}

/// One row in a bulk contact deletion result.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactBulkDeleteResultItem {
    pub contact_id: Uuid,
    pub status: ContactBulkDeleteStatus,
    #[serde(default)]
    pub error: Option<String>,
}

/// Result of deleting multiple contacts.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactBulkDeleteResult {
    pub deleted_count: u64,
    pub error_count: u64,
    #[serde(default)]
    pub results: Vec<ContactBulkDeleteResultItem>,
}

/// A bounded multi-contact vCard document.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContactVCardExportResult {
    pub content_type: String,
    pub contact_count: u64,
    pub vcard: String,
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

const fn default_true() -> bool {
    true
}

/// Deserialize an optional float the server may encode as a JSON string
/// (decimal fields arrive as e.g. `"0.90"` to preserve precision).
fn f64_from_number_or_string<'de, D>(deserializer: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<Value> = Option::deserialize(deserializer)?;
    match value {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(number)) => number
            .as_f64()
            .map(Some)
            .ok_or_else(|| serde::de::Error::custom("number out of f64 range")),
        Some(Value::String(text)) => text
            .parse::<f64>()
            .map(Some)
            .map_err(serde::de::Error::custom),
        Some(other) => Err(serde::de::Error::custom(format!(
            "expected number or string, got {other}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{Contact, ContactFact, ContactImportResult, ContactImportStatus};

    #[test]
    fn parses_confidence_from_string_or_number() {
        let fact = |confidence: serde_json::Value| -> ContactFact {
            serde_json::from_value(json!({
                "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                "contact_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "content": "Prefers email",
                "confidence": confidence,
                "origin": "generated",
                "locked_at": null,
                "created_at": "2026-07-20T12:00:00Z",
                "updated_at": "2026-07-20T12:00:00Z",
                "citations": []
            }))
            .unwrap()
        };

        assert_eq!(fact(json!("0.90")).confidence, Some(0.90));
        assert_eq!(fact(json!(0.90)).confidence, Some(0.90));
        assert_eq!(fact(json!(null)).confidence, None);
    }

    #[test]
    fn defaults_contact_lifecycle_fields() {
        let contact: Contact = serde_json::from_value(json!({
            "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "preferred_name": "Alex",
            "given_name": "Alex",
            "family_name": null,
            "company_name": null,
            "job_title": null,
            "notes": null,
            "emails": [],
            "phones": [],
            "websites": [],
            "dates": [],
            "addresses": [],
            "custom_fields": [],
            "access": [],
            "memory_count": 1,
            "latest_memory": {
                "id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                "content": "Prefers email",
                "updated_at": "2026-07-20T12:00:00Z"
            },
            "created_at": "2026-07-20T12:00:00Z",
            "updated_at": "2026-07-20T12:00:00Z"
        }))
        .unwrap();

        assert_eq!(
            contact.creation_source,
            super::ContactCreationSource::Backfill
        );
        assert_eq!(contact.review_status, super::ContactReviewStatus::Confirmed);
        assert!(contact.is_confirmed);
        assert_eq!(contact.memory_count, Some(1));
        assert_eq!(contact.latest_memory.unwrap().content, "Prefers email");
    }

    #[test]
    fn parses_vcard_identifier_conflict() {
        let result: ContactImportResult = serde_json::from_value(json!({
            "created_count": 0,
            "error_count": 1,
            "results": [{
                "index": 0,
                "status": "conflict",
                "contact": null,
                "error": "duplicate contact identifier",
                "conflicting_contact_id": "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
            }]
        }))
        .unwrap();

        assert_eq!(result.results[0].status, ContactImportStatus::Conflict);
        assert!(result.results[0].conflicting_contact_id.is_some());
        assert_eq!(result.conflicts().len(), 1);
        assert!(result.errors().is_empty());
    }
}

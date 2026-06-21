//! Contacts CRUD + search + lookup.
//!
//! Port of `inkbox/contacts/resources/contacts.py`.

use std::sync::Arc;

use serde_json::{Map, Value};

use crate::contacts::resources::contact_access::ContactAccessResource;
use crate::contacts::resources::vcards::VCardsResource;
use crate::contacts::types::{
    Contact, ContactAddress, ContactCustomField, ContactDate, ContactEmail, ContactPhone,
    ContactWebsite,
};
use crate::error::{InkboxError, Result};
use crate::http::{HttpTransport, NO_QUERY};

const BASE: &str = "/contacts";

/// How to seed access grants when creating a contact.
///
/// Mirrors the Python `access_identity_ids` tri-state:
/// * `Wildcard` (default) — omit the key; one wildcard row, every active
///   identity sees the contact.
/// * `Null` — send `access_identity_ids: null` (same as wildcard server-side).
/// * `Ids(vec)` — explicit per-identity grants. `[]` means zero grants (only
///   admin + human callers see it). Capped at 500 entries server-side.
#[derive(Debug, Clone, Default)]
pub enum AccessIdentityIds {
    #[default]
    Wildcard,
    Null,
    Ids(Vec<String>),
}

/// Optional filters for [`ContactsResource::list`]. All fields default to None
/// (the key is omitted from the query string).
#[derive(Debug, Clone, Default)]
pub struct ListContactsParams {
    /// Case-insensitive substring filter across preferred_name, given_name,
    /// family_name, company_name, job_title, and notes. Max 100 chars.
    pub q: Option<String>,
    /// `"name"` or `"recent"` sort order (server default applies).
    pub order: Option<String>,
    /// Max rows to return.
    pub limit: Option<i64>,
    /// Offset for paging.
    pub offset: Option<i64>,
}

/// Fields for [`ContactsResource::create`]. Each `None` scalar is omitted; each
/// `Some` list is sent (encoded to its wire shape).
#[derive(Debug, Clone, Default)]
pub struct CreateContactParams {
    pub preferred_name: Option<String>,
    pub name_prefix: Option<String>,
    pub given_name: Option<String>,
    pub middle_name: Option<String>,
    pub family_name: Option<String>,
    pub name_suffix: Option<String>,
    pub company_name: Option<String>,
    pub job_title: Option<String>,
    /// ISO date (`YYYY-MM-DD`).
    pub birthday: Option<String>,
    pub notes: Option<String>,
    pub emails: Option<Vec<ContactEmail>>,
    pub phones: Option<Vec<ContactPhone>>,
    pub websites: Option<Vec<ContactWebsite>>,
    pub dates: Option<Vec<ContactDate>>,
    pub addresses: Option<Vec<ContactAddress>>,
    pub custom_fields: Option<Vec<ContactCustomField>>,
    /// Access grants at create time (defaults to `Wildcard`).
    pub access_identity_ids: AccessIdentityIds,
}

/// Fields for [`ContactsResource::update`] (JSON-merge-patch).
///
/// Every field is `Option<Option<T>>`: outer `None` omits the key (leave
/// unchanged), `Some(None)` sends an explicit JSON `null` (clear it), and
/// `Some(Some(v))` sends the value. This mirrors the Python `_UNSET` sentinel.
#[derive(Debug, Clone, Default)]
pub struct UpdateContactParams {
    pub preferred_name: Option<Option<String>>,
    pub name_prefix: Option<Option<String>>,
    pub given_name: Option<Option<String>>,
    pub middle_name: Option<Option<String>>,
    pub family_name: Option<Option<String>>,
    pub name_suffix: Option<Option<String>>,
    pub company_name: Option<Option<String>>,
    pub job_title: Option<Option<String>>,
    /// ISO date (`YYYY-MM-DD`) or explicit null to clear.
    pub birthday: Option<Option<String>>,
    pub notes: Option<Option<String>>,
    pub emails: Option<Option<Vec<ContactEmail>>>,
    pub phones: Option<Option<Vec<ContactPhone>>>,
    pub websites: Option<Option<Vec<ContactWebsite>>>,
    pub dates: Option<Option<Vec<ContactDate>>>,
    pub addresses: Option<Option<Vec<ContactAddress>>>,
    pub custom_fields: Option<Option<Vec<ContactCustomField>>>,
}

/// Org-wide contacts list with per-identity access control.
pub struct ContactsResource {
    http: Arc<HttpTransport>,
    access: ContactAccessResource,
    vcards: VCardsResource,
}

impl ContactsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self {
            access: ContactAccessResource::new(http.clone()),
            vcards: VCardsResource::new(http.clone()),
            http,
        }
    }

    /// Per-contact access grant management.
    pub fn access(&self) -> &ContactAccessResource {
        &self.access
    }

    /// vCard import / export.
    pub fn vcards(&self) -> &VCardsResource {
        &self.vcards
    }

    /// List contacts with optional substring search.
    pub fn list(&self, params: &ListContactsParams) -> Result<Vec<Contact>> {
        // Build the query string, omitting keys whose value is None.
        let mut query: Vec<(&str, String)> = Vec::new();
        if let Some(q) = &params.q {
            query.push(("q", q.clone()));
        }
        if let Some(order) = &params.order {
            query.push(("order", order.clone()));
        }
        if let Some(limit) = params.limit {
            query.push(("limit", limit.to_string()));
        }
        if let Some(offset) = params.offset {
            query.push(("offset", offset.to_string()));
        }
        let data = self.http.get(BASE, &query)?;
        let items = unwrap_items(data);
        Ok(serde_json::from_value(items)?)
    }

    /// Reverse-lookup contacts by a single field.
    ///
    /// Exactly one of the five arguments must be supplied; passing zero or more
    /// than one raises `InvalidArgument` before hitting the server.
    pub fn lookup(
        &self,
        email: Option<&str>,
        email_contains: Option<&str>,
        email_domain: Option<&str>,
        phone: Option<&str>,
        phone_contains: Option<&str>,
    ) -> Result<Vec<Contact>> {
        // Collect the supplied (key, value) pairs in declaration order.
        let supplied: [(&str, Option<&str>); 5] = [
            ("email", email),
            ("email_contains", email_contains),
            ("email_domain", email_domain),
            ("phone", phone),
            ("phone_contains", phone_contains),
        ];
        let query: Vec<(&str, String)> = supplied
            .iter()
            .filter_map(|(k, v)| v.map(|val| (*k, val.to_string())))
            .collect();
        if query.len() != 1 {
            return Err(InkboxError::InvalidArgument(
                "lookup() requires exactly one of: email, email_contains, \
                 email_domain, phone, phone_contains."
                    .into(),
            ));
        }
        let data = self.http.get(&format!("{BASE}/lookup"), &query)?;
        let items = unwrap_items(data);
        Ok(serde_json::from_value(items)?)
    }

    /// Fetch a single contact by id.
    pub fn get(&self, contact_id: &str) -> Result<Contact> {
        let data = self.http.get(&format!("{BASE}/{contact_id}"), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Create a new contact.
    pub fn create(&self, params: &CreateContactParams) -> Result<Contact> {
        let mut body = Map::new();
        // Scalar fields: emit only when present.
        insert_opt_str(&mut body, "preferred_name", &params.preferred_name);
        insert_opt_str(&mut body, "name_prefix", &params.name_prefix);
        insert_opt_str(&mut body, "given_name", &params.given_name);
        insert_opt_str(&mut body, "middle_name", &params.middle_name);
        insert_opt_str(&mut body, "family_name", &params.family_name);
        insert_opt_str(&mut body, "name_suffix", &params.name_suffix);
        insert_opt_str(&mut body, "company_name", &params.company_name);
        insert_opt_str(&mut body, "job_title", &params.job_title);
        insert_opt_str(&mut body, "notes", &params.notes);
        if let Some(birthday) = &params.birthday {
            body.insert("birthday".into(), Value::String(birthday.clone()));
        }
        // List fields: emit the wire-encoded array only when Some.
        if let Some(emails) = &params.emails {
            body.insert("emails".into(), wire_list(emails, ContactEmail::to_wire));
        }
        if let Some(phones) = &params.phones {
            body.insert("phones".into(), wire_list(phones, ContactPhone::to_wire));
        }
        if let Some(websites) = &params.websites {
            body.insert(
                "websites".into(),
                wire_list(websites, ContactWebsite::to_wire),
            );
        }
        if let Some(dates) = &params.dates {
            body.insert("dates".into(), wire_list(dates, ContactDate::to_wire));
        }
        if let Some(addresses) = &params.addresses {
            body.insert(
                "addresses".into(),
                wire_list(addresses, ContactAddress::to_wire),
            );
        }
        if let Some(custom_fields) = &params.custom_fields {
            body.insert(
                "custom_fields".into(),
                wire_list(custom_fields, ContactCustomField::to_wire),
            );
        }
        // Access tri-state: Wildcard omits the key entirely.
        match &params.access_identity_ids {
            AccessIdentityIds::Wildcard => {}
            AccessIdentityIds::Null => {
                body.insert("access_identity_ids".into(), Value::Null);
            }
            AccessIdentityIds::Ids(ids) => {
                body.insert(
                    "access_identity_ids".into(),
                    Value::Array(ids.iter().map(|i| Value::String(i.clone())).collect()),
                );
            }
        }
        let data = self.http.post(BASE, Some(&Value::Object(body)), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// JSON-merge-patch update.
    ///
    /// Only provided fields are sent; omit a field to leave it unchanged. Pass
    /// a scalar as `Some(None)` to clear it.
    pub fn update(&self, contact_id: &str, params: &UpdateContactParams) -> Result<Contact> {
        let mut body = Map::new();
        // Scalar fields: outer Some => emit (None scalar becomes JSON null).
        insert_patch_str(&mut body, "preferred_name", &params.preferred_name);
        insert_patch_str(&mut body, "name_prefix", &params.name_prefix);
        insert_patch_str(&mut body, "given_name", &params.given_name);
        insert_patch_str(&mut body, "middle_name", &params.middle_name);
        insert_patch_str(&mut body, "family_name", &params.family_name);
        insert_patch_str(&mut body, "name_suffix", &params.name_suffix);
        insert_patch_str(&mut body, "company_name", &params.company_name);
        insert_patch_str(&mut body, "job_title", &params.job_title);
        insert_patch_str(&mut body, "birthday", &params.birthday);
        insert_patch_str(&mut body, "notes", &params.notes);
        // List fields: outer Some => emit; inner None => JSON null, else array.
        insert_patch_list(&mut body, "emails", &params.emails, ContactEmail::to_wire);
        insert_patch_list(&mut body, "phones", &params.phones, ContactPhone::to_wire);
        insert_patch_list(
            &mut body,
            "websites",
            &params.websites,
            ContactWebsite::to_wire,
        );
        insert_patch_list(&mut body, "dates", &params.dates, ContactDate::to_wire);
        insert_patch_list(
            &mut body,
            "addresses",
            &params.addresses,
            ContactAddress::to_wire,
        );
        insert_patch_list(
            &mut body,
            "custom_fields",
            &params.custom_fields,
            ContactCustomField::to_wire,
        );
        let data = self
            .http
            .patch(&format!("{BASE}/{contact_id}"), &Value::Object(body))?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a contact.
    pub fn delete(&self, contact_id: &str) -> Result<()> {
        self.http.delete(&format!("{BASE}/{contact_id}"))
    }
}

/// Mirror Python's `data["items"] if "items" in data else data`.
fn unwrap_items(data: Value) -> Value {
    match data {
        Value::Object(mut map) if map.contains_key("items") => {
            map.remove("items").unwrap_or(Value::Null)
        }
        other => other,
    }
}

/// Insert a scalar key only when the value is present (create semantics).
fn insert_opt_str(body: &mut Map<String, Value>, key: &str, value: &Option<String>) {
    if let Some(v) = value {
        body.insert(key.into(), Value::String(v.clone()));
    }
}

/// Insert a scalar patch key: outer Some emits the value (inner None => null).
fn insert_patch_str(body: &mut Map<String, Value>, key: &str, value: &Option<Option<String>>) {
    if let Some(inner) = value {
        body.insert(
            key.into(),
            match inner {
                Some(v) => Value::String(v.clone()),
                None => Value::Null,
            },
        );
    }
}

/// Insert a list patch key: outer Some emits; inner None => null, else array.
fn insert_patch_list<T, F>(
    body: &mut Map<String, Value>,
    key: &str,
    value: &Option<Option<Vec<T>>>,
    to_wire: F,
) where
    F: Fn(&T) -> Value,
{
    if let Some(inner) = value {
        body.insert(
            key.into(),
            match inner {
                Some(items) => Value::Array(items.iter().map(&to_wire).collect()),
                None => Value::Null,
            },
        );
    }
}

/// Encode a slice of contact sub-objects to a JSON array via their `to_wire`.
fn wire_list<T, F>(items: &[T], to_wire: F) -> Value
where
    F: Fn(&T) -> Value,
{
    Value::Array(items.iter().map(&to_wire).collect())
}

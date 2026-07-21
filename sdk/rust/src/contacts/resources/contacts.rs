//! Contacts CRUD + search + lookup.
//!
//! Port of `inkbox/contacts/resources/contacts.py`.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::contacts::resources::contact_access::ContactAccessResource;
use crate::contacts::resources::contact_facts::ContactFactsResource;
use crate::contacts::resources::correspondence::ContactCorrespondenceResource;
use crate::contacts::resources::vcards::VCardsResource;
use crate::contacts::types::{
    Contact, ContactAddress, ContactBulkDeleteResult, ContactCustomField, ContactDate,
    ContactEmail, ContactPhone, ContactReviewStatus, ContactWebsite,
};
use crate::error::{InkboxError, Result};
use crate::http::{validate_idempotency_key, HttpTransport, NO_HEADERS, NO_QUERY};

const BASE: &str = "/contacts";

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
    /// Offset for paging, from 0 through 10,000.
    pub offset: Option<i64>,
    /// Review states to include. Omit for active contacts awaiting or completing review.
    pub review_status: Vec<ContactReviewStatus>,
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
    pub review_status: Option<ContactReviewStatus>,
}

/// Fields for merging contacts into a surviving contact.
#[derive(Debug, Clone, Default)]
pub struct MergeContactsParams {
    pub losing_contact_ids: Vec<String>,
    pub field_sources: HashMap<String, String>,
}

/// Organization-wide contacts and contact memory.
pub struct ContactsResource {
    http: Arc<HttpTransport>,
    access: ContactAccessResource,
    facts: ContactFactsResource,
    correspondence: ContactCorrespondenceResource,
    vcards: VCardsResource,
}

impl ContactsResource {
    pub fn new(http: Arc<HttpTransport>) -> Self {
        Self {
            access: ContactAccessResource::new(http.clone()),
            facts: ContactFactsResource::new(http.clone()),
            correspondence: ContactCorrespondenceResource::new(http.clone()),
            vcards: VCardsResource::new(http.clone()),
            http,
        }
    }

    /// Compatibility access rows for a contact.
    pub fn access(&self) -> &ContactAccessResource {
        &self.access
    }

    /// Facts remembered about contacts.
    pub fn facts(&self) -> &ContactFactsResource {
        &self.facts
    }

    /// Unified correspondence across supported channels.
    pub fn correspondence(&self) -> &ContactCorrespondenceResource {
        &self.correspondence
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
        for status in &params.review_status {
            query.push(("review_status", status.as_str().to_string()));
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
        self.create_with_idempotency_key(params, None)
    }

    /// Create a contact with an optional retry-safe idempotency key.
    pub fn create_with_idempotency_key(
        &self,
        params: &CreateContactParams,
        idempotency_key: Option<&str>,
    ) -> Result<Contact> {
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
        let idempotency_header;
        let headers = if let Some(key) = idempotency_key {
            validate_idempotency_key(key)?;
            idempotency_header = [("Idempotency-Key", key)];
            idempotency_header.as_slice()
        } else {
            NO_HEADERS
        };
        let data =
            self.http
                .post_with_headers(BASE, Some(&Value::Object(body)), NO_QUERY, headers)?;
        Ok(serde_json::from_value(data)?)
    }

    /// JSON-merge-patch update.
    ///
    /// Only provided fields are sent; omit a field to leave it unchanged. Pass
    /// a scalar as `Some(None)` to clear it.
    pub fn update(&self, contact_id: &str, params: &UpdateContactParams) -> Result<Contact> {
        self.update_with_idempotency_key(contact_id, params, None)
    }

    /// Update a contact with an optional retry-safe idempotency key.
    pub fn update_with_idempotency_key(
        &self,
        contact_id: &str,
        params: &UpdateContactParams,
        idempotency_key: Option<&str>,
    ) -> Result<Contact> {
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
        if let Some(review_status) = params.review_status {
            body.insert(
                "review_status".into(),
                Value::String(review_status.as_str().to_string()),
            );
        }
        let idempotency_header;
        let headers = if let Some(key) = idempotency_key {
            validate_idempotency_key(key)?;
            idempotency_header = [("Idempotency-Key", key)];
            idempotency_header.as_slice()
        } else {
            NO_HEADERS
        };
        let data = self.http.patch_with_headers(
            &format!("{BASE}/{contact_id}"),
            &Value::Object(body),
            headers,
        )?;
        Ok(serde_json::from_value(data)?)
    }

    /// Delete a contact.
    pub fn delete(&self, contact_id: &str) -> Result<()> {
        self.delete_with_idempotency_key(contact_id, None)
    }

    /// Delete a contact with an optional retry-safe idempotency key.
    pub fn delete_with_idempotency_key(
        &self,
        contact_id: &str,
        idempotency_key: Option<&str>,
    ) -> Result<()> {
        let idempotency_header;
        let headers = if let Some(key) = idempotency_key {
            validate_idempotency_key(key)?;
            idempotency_header = [("Idempotency-Key", key)];
            idempotency_header.as_slice()
        } else {
            NO_HEADERS
        };
        self.http
            .delete_with_headers(&format!("{BASE}/{contact_id}"), headers)
    }

    /// Delete multiple contacts and return per-contact outcomes.
    pub fn bulk_delete(&self, contact_ids: &[String]) -> Result<ContactBulkDeleteResult> {
        let body = serde_json::json!({ "contact_ids": contact_ids });
        let data = self
            .http
            .post(&format!("{BASE}/bulk-delete"), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
    }

    /// Merge contacts into `contact_id`, which remains as the survivor.
    pub fn merge(&self, contact_id: &str, params: &MergeContactsParams) -> Result<Contact> {
        let body = serde_json::json!({
            "losing_contact_ids": params.losing_contact_ids,
            "field_sources": params.field_sources,
        });
        let data = self
            .http
            .post(&format!("{BASE}/{contact_id}/merge"), Some(&body), NO_QUERY)?;
        Ok(serde_json::from_value(data)?)
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

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use httpmock::prelude::*;
    use serde_json::json;

    use super::{
        CreateContactParams, ListContactsParams, MergeContactsParams, UpdateContactParams,
    };
    use crate::client::Inkbox;
    use crate::contacts::ContactReviewStatus;

    const CONTACT_ID: &str = "11111111-1111-1111-1111-111111111111";
    const LOSING_ID: &str = "22222222-2222-2222-2222-222222222222";

    fn client(server: &MockServer) -> std::sync::Arc<Inkbox> {
        Inkbox::builder("test-key")
            .base_url(server.base_url())
            .build()
            .unwrap()
    }

    fn contact() -> serde_json::Value {
        json!({
            "id": CONTACT_ID,
            "organization_id": "org_123",
            "preferred_name": "Ada",
            "name_prefix": null,
            "given_name": "Ada",
            "middle_name": null,
            "family_name": null,
            "name_suffix": null,
            "company_name": null,
            "job_title": null,
            "birthday": null,
            "notes": null,
            "emails": [],
            "phones": [],
            "websites": [],
            "dates": [],
            "addresses": [],
            "custom_fields": [],
            "access": [],
            "creation_source": "communication",
            "review_status": "unreviewed",
            "reviewed_at": null,
            "reviewed_by": null,
            "preferred_name_source": "mail_header",
            "preferred_name_locked_at": null,
            "created_by_identity_id": null,
            "merged_into_contact_id": null,
            "is_auto_created": true,
            "is_confirmed": false,
            "status": "active",
            "created_at": "2026-07-20T12:00:00Z",
            "updated_at": "2026-07-20T12:00:00Z"
        })
    }

    #[test]
    fn sends_review_status_list_params_and_gets_contact() {
        let server = MockServer::start();
        let list = server.mock(|when, then| {
            when.method(GET)
                .path("/api/v1/contacts")
                .query_param("review_status", "unreviewed");
            then.status(200).json_body(json!([]));
        });
        let get = server.mock(|when, then| {
            when.method(GET)
                .path(format!("/api/v1/contacts/{CONTACT_ID}"));
            then.status(200).json_body(contact());
        });

        let sdk = client(&server);
        sdk.contacts()
            .list(&ListContactsParams {
                review_status: vec![ContactReviewStatus::Unreviewed],
                ..Default::default()
            })
            .unwrap();
        let result = sdk.contacts().get(CONTACT_ID).unwrap();

        list.assert();
        get.assert();
        assert!(result.is_auto_created);
        assert_eq!(result.review_status, ContactReviewStatus::Unreviewed);
    }

    #[test]
    fn create_omits_access_restrictions() {
        let server = MockServer::start();
        let request = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts")
                .json_body(json!({"preferred_name": "Ada"}));
            then.status(201).json_body(contact());
        });

        client(&server)
            .contacts()
            .create(&CreateContactParams {
                preferred_name: Some("Ada".into()),
                ..Default::default()
            })
            .unwrap();

        request.assert();
    }

    #[test]
    fn sends_review_update_and_merge() {
        let server = MockServer::start();
        let update = server.mock(|when, then| {
            when.method(httpmock::Method::PATCH)
                .path(format!("/api/v1/contacts/{CONTACT_ID}"))
                .json_body(json!({"review_status": "confirmed"}));
            then.status(200).json_body(contact());
        });
        let merge = server.mock(|when, then| {
            when.method(POST)
                .path(format!("/api/v1/contacts/{CONTACT_ID}/merge"))
                .json_body(json!({
                    "losing_contact_ids": [LOSING_ID],
                    "field_sources": {"notes": LOSING_ID}
                }));
            then.status(200).json_body(contact());
        });

        let sdk = client(&server);
        sdk.contacts()
            .update(
                CONTACT_ID,
                &UpdateContactParams {
                    review_status: Some(ContactReviewStatus::Confirmed),
                    ..Default::default()
                },
            )
            .unwrap();
        sdk.contacts()
            .merge(
                CONTACT_ID,
                &MergeContactsParams {
                    losing_contact_ids: vec![LOSING_ID.into()],
                    field_sources: HashMap::from([("notes".into(), LOSING_ID.into())]),
                },
            )
            .unwrap();

        update.assert();
        merge.assert();
    }

    #[test]
    fn supports_idempotent_create_and_bulk_delete() {
        let server = MockServer::start();
        let create = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts")
                .header("Idempotency-Key", "create-contact-1");
            then.status(201).json_body(contact());
        });
        let bulk_delete = server.mock(|when, then| {
            when.method(POST)
                .path("/api/v1/contacts/bulk-delete")
                .json_body(json!({"contact_ids": [CONTACT_ID]}));
            then.status(200).json_body(json!({
                "deleted_count": 1,
                "error_count": 0,
                "results": [{"contact_id": CONTACT_ID, "status": "deleted"}]
            }));
        });

        let sdk = client(&server);
        sdk.contacts()
            .create_with_idempotency_key(
                &CreateContactParams {
                    preferred_name: Some("Ada".into()),
                    ..Default::default()
                },
                Some("create-contact-1"),
            )
            .unwrap();
        let result = sdk.contacts().bulk_delete(&[CONTACT_ID.into()]).unwrap();

        create.assert();
        bulk_delete.assert();
        assert_eq!(result.deleted_count, 1);
    }
}

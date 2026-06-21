//! Org-scoped Contacts API: contacts CRUD, per-contact access grants, and
//! vCard import / export.
//!
//! Port of the Python `inkbox/contacts/` package.

pub mod resources;
pub mod types;

pub use resources::contact_access::ContactAccessResource;
pub use resources::contacts::{
    AccessIdentityIds, ContactsResource, CreateContactParams, ListContactsParams,
    UpdateContactParams,
};
pub use resources::vcards::VCardsResource;
pub use types::{
    Contact, ContactAccess, ContactAddress, ContactCustomField, ContactDate, ContactEmail,
    ContactImportResult, ContactImportResultItem, ContactPhone, ContactWebsite,
};

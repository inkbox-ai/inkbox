//! Org-scoped contacts, memory, correspondence, and vCard import/export.

pub mod correspondence;
pub mod resources;
pub mod types;

pub use correspondence::{
    CallCorrespondenceItem, ContactCorrespondence, CorrespondenceAttachmentMetadata,
    CorrespondenceChannel, CorrespondenceChannelResult, CorrespondenceChannelStatus,
    CorrespondenceContentMode, CorrespondenceDirection, CorrespondenceItem, CorrespondenceItemBase,
    CorrespondenceMediaMetadata, CorrespondenceOrder, CorrespondenceTranscriptEntry,
    CorrespondenceTranscriptMarker, CorrespondenceTranscriptMode, EmailCorrespondenceItem,
    IMessageCorrespondenceItem, SmsCorrespondenceItem,
};
pub use resources::contact_access::ContactAccessResource;
pub use resources::contact_facts::ContactFactsResource;
pub use resources::contacts::{
    ContactsResource, CreateContactParams, ListContactsParams, MergeContactsParams,
    UpdateContactParams,
};
pub use resources::correspondence::{ContactCorrespondenceResource, CorrespondenceQuery};
pub use resources::vcards::VCardsResource;
pub use types::{
    Contact, ContactAccess, ContactAddress, ContactCreationSource, ContactCustomField, ContactDate,
    ContactEmail, ContactFact, ContactFactCitation, ContactFactCitationAvailability,
    ContactFactCitationDetail, ContactFactOrigin, ContactImportResult, ContactImportResultItem,
    ContactImportStatus, ContactNameSource, ContactPhone, ContactReviewStatus, ContactWebsite,
};

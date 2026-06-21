//! Mail-domain resource modules. One module per Python resource file.

pub mod contact_rules;
pub mod domains;
pub mod mailboxes;
pub mod messages;
pub mod threads;

pub use contact_rules::MailContactRulesResource;
pub use domains::DomainsResource;
pub use mailboxes::MailboxesResource;
pub use messages::{Attachment, MessagesResource};
pub use threads::ThreadsResource;

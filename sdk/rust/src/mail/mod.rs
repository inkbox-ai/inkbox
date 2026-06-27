//! The Inkbox **mail** domain: mailboxes, messages, threads, contact rules,
//! and custom sending domains.
//!
//! Ported from `inkbox/mail/` in the Python SDK. The wire shape (JSON field
//! names, enum string values, request bodies, query params, paths) matches the
//! Python source exactly.

pub mod exceptions;
pub mod resources;
pub mod types;

// Re-export the public types.
pub use types::{
    ContactRuleStatus, Domain, FilterMode, FilterModeChangeNotice, ForwardMode, MailContactRule,
    MailRuleAction, MailRuleMatchType, Mailbox, Message, MessageDetail, MessageDirection,
    ReplyAllRecipients, SendingDomainStatus, Thread, ThreadDetail, ThreadFolder,
};

// Re-export the resources.
pub use resources::{
    Attachment, DomainsResource, MailContactRulesResource, MailboxesResource, MessagesResource,
    ThreadsResource,
};

//! Inkbox iMessage messaging and dedicated number management.
//!
//! Messages and conversations are identity-scoped. One-to-one conversations may
//! carry assignment state; groups require a dedicated outbound number.
//! Organization-owned dedicated numbers are listed and claimed through
//! [`IMessagesResource`].

pub mod resources;
pub mod types;

pub use resources::{IMessageContactRulesResource, IMessagesResource};
pub use types::{
    ContactRuleStatus, IMessage, IMessageAssignment, IMessageAssignmentStatus, IMessageContactRule,
    IMessageConversation, IMessageConversationSummary, IMessageDeliveryStatus,
    IMessageMarkReadResult, IMessageMediaItem, IMessageMediaUpload, IMessageMessageReaction,
    IMessageNumber, IMessageNumberStatus, IMessageNumberType, IMessageReaction,
    IMessageReactionType, IMessageRecipient, IMessageRuleAction, IMessageRuleMatchType,
    IMessageSendStyle, IMessageService, IMessageTriageNumber, IdentityIMessageNumber,
};

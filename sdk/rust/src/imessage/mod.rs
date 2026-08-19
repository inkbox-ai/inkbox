//! Inkbox iMessage messaging and dedicated line management.
//!
//! Messages and conversations are identity-scoped. One-to-one conversations may
//! carry assignment state; groups require a dedicated line.
//! Organization-owned dedicated lines are listed and claimed through
//! [`IMessagesResource`].

pub mod resources;
pub mod types;

pub use resources::{IMessageContactRulesResource, IMessagesResource};
pub use types::{
    ContactRuleStatus, IMessage, IMessageAssignment, IMessageAssignmentStatus, IMessageContactRule,
    IMessageConversation, IMessageConversationSummary, IMessageDeliveryStatus,
    IMessageGroupCreationStatus, IMessageMarkReadResult, IMessageMediaItem, IMessageMediaUpload,
    IMessageMessageReaction, IMessageNumber, IMessageNumberStatus, IMessageReaction,
    IMessageReactionType, IMessageRecipient, IMessageRuleAction, IMessageRuleMatchType,
    IMessageSendStyle, IMessageService, IMessageTriageNumber, IdentityIMessageNumber,
};

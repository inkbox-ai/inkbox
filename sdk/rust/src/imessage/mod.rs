//! Inkbox iMessage domain: assignment-routed messaging over a shared pool.
//!
//! iMessage routes by assignment, not by a number the org owns: a recipient is
//! connected to an agent identity over a shared pool line, and every
//! agent-facing shape is keyed by `conversation_id` / `remote_number`.

pub mod resources;
pub mod types;

pub use resources::{IMessageContactRulesResource, IMessagesResource};
pub use types::{
    ContactRuleStatus, IMessage, IMessageAssignment, IMessageAssignmentStatus, IMessageContactRule,
    IMessageConversation, IMessageConversationSummary, IMessageDeliveryStatus,
    IMessageMarkReadResult, IMessageMediaItem, IMessageMediaUpload, IMessageMessageReaction,
    IMessageReaction, IMessageReactionType, IMessageRecipient, IMessageRuleAction,
    IMessageRuleMatchType, IMessageSendStyle, IMessageService, IMessageTriageNumber,
};

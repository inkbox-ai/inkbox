//! Agent-to-agent task and context history.

mod resource;
mod types;

pub use resource::A2AResource;
pub use types::{
    A2ACaller, A2AContext, A2AContextListOptions, A2AContextPage, A2AHistoryDirection,
    A2AHistoryMessage, A2AHistoryMessagePage, A2AMessage, A2AMessageListOptions, A2AMessageRole,
    A2ASentTaskListOptions, A2ATarget, A2ATask, A2ATaskListOptions, A2ATaskPage,
};

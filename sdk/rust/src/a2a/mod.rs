//! Agent-to-agent task and context history.

mod resource;
mod types;

pub use resource::A2AResource;
pub use types::{
    A2ACaller, A2AContext, A2AContextPage, A2AMessage, A2ATarget, A2ATask, A2ATaskPage,
    A2ATransition,
};

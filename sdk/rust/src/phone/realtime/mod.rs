//! Live call observe + intervene control channel.
//!
//! The streaming client (`RealtimeResource` / `RealtimeControlSession`) is
//! compiled only with the `tunnels-runtime` feature, which supplies the async
//! runtime (`tokio` + `tokio-rustls`) and the shared WebSocket frame codec it
//! reuses. The typed observe events are always available.

pub mod events;

pub use events::{parse_event, PostCallAction, RealtimeEvent, TranscriptTurn};

#[cfg(feature = "tunnels-runtime")]
pub mod session;

#[cfg(feature = "tunnels-runtime")]
pub use session::{RealtimeControlSession, RealtimeResource};

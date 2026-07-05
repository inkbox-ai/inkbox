//! Observe + intervene frames for platform-hosted calls.
//!
//! These ride the one existing per-call WebSocket (the same connection the
//! platform opens to your app): decode inbound frames with [`parse_event`],
//! and build the outbound intervene frames with the helpers in
//! [`intervene`]. Both surfaces are always available (no feature gate) — they
//! are pure JSON codec, transport-agnostic.

pub mod events;
pub mod intervene;

pub use events::{parse_event, PostCallAction, RealtimeEvent, TranscriptTurn};

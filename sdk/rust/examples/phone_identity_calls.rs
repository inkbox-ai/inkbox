//! Live smoke check for the agent-identity-centered phone surface.
//!
//! Exercises the new identity-scoped call/transcript/incoming-call-action
//! surface against the real API. Requires `INKBOX_API_KEY` (and optionally
//! `INKBOX_BASE_URL`) in the environment.
//!
//! Run with:  cargo run --example phone_identity_calls

use inkbox::phone::{CallOrigin, IncomingCallAction};
use inkbox::Inkbox;

fn main() -> inkbox::Result<()> {
    let inkbox = Inkbox::from_env()?;

    // Who are we? (auth + transport round-trip)
    let who = inkbox.whoami()?;
    println!("whoami: {:?}", who);

    // Identity-scoped call listing (agent-scoped key resolves its own identity;
    // pass None here). Blocked rows are filtered server-side.
    let calls = inkbox.calls().list(None, 5, 0, None)?;
    println!("calls (agent-scoped): {}", calls.len());
    if let Some(call) = calls.first() {
        println!(
            "  first call id={} origin={:?} local={:?}",
            call.id, call.origin, call.local_phone_number
        );
        // Fold-in: transcripts now live on the calls resource.
        let transcripts = inkbox.calls().transcripts(&call.id.to_string())?;
        println!("  transcripts: {}", transcripts.len());
        // Get by id.
        let one = inkbox.calls().get(&call.id.to_string())?;
        println!("  get -> status={}", one.status);
    }

    // Inbound-call routing config (identity-scoped get).
    match inkbox.incoming_call_action().get(None) {
        Ok(cfg) => println!(
            "incoming-call-action: {:?} (ws={:?})",
            cfg.incoming_call_action, cfg.client_websocket_url
        ),
        Err(e) => println!("incoming-call-action get error (expected under admin/JWT): {e}"),
    }

    // Type references so the compiler exercises the new enums/signatures even
    // when we don't actually place a call in a smoke run.
    let _ = CallOrigin::DedicatedNumber;
    let _ = CallOrigin::SharedImessageNumber;
    let _ = IncomingCallAction::AutoAccept;
    let _place = |i: &Inkbox| {
        i.calls().place(
            "+15550000000",
            CallOrigin::DedicatedNumber,
            Some("+15551112222"),
            None,
            None,
        )
    };
    let _set = |i: &Inkbox| {
        i.incoming_call_action().set(
            IncomingCallAction::Webhook,
            None,
            None,
            Some("https://example.com/hook"),
        )
    };

    Ok(())
}

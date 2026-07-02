//! Acceptance harness for the identity-centered phone surface.
//!
//! Exercises all four surfaces (calls list/get/transcripts, incoming-call-action
//! get/set + validation, place-call dedicated + shared) against a live API.
//! Selects base via INKBOX_BASE_URL (falls back to the SDK default). Each surface
//! prints PASS/FAIL with the concrete status/field evidence instead of bailing,
//! so a single run reports every surface's outcome.
//!
//! Run:  INKBOX_BASE_URL=https://api.example.com cargo run --example phone_acceptance

use inkbox::error::InkboxError;
use inkbox::phone::{CallOrigin, IncomingCallAction};
use inkbox::Inkbox;

// Pull the HTTP status + detail out of an SDK error for evidence lines.
fn describe(e: &InkboxError) -> String {
    match e {
        InkboxError::Api {
            status_code,
            detail,
        } => {
            format!("Api status={status_code} detail={detail:?}")
        }
        other => format!("{other:?}"),
    }
}

fn main() {
    let inkbox = match Inkbox::from_env() {
        Ok(c) => c,
        Err(e) => {
            println!("CLIENT BUILD FAIL: {}", describe(&e));
            return;
        }
    };
    println!("base_url = {}", inkbox.base_url());

    // Auth round-trip.
    match inkbox.whoami() {
        Ok(w) => println!("whoami OK: {:?}", w),
        Err(e) => println!("whoami FAIL: {}", describe(&e)),
    }

    // Resolve an identity to scope admin calls by (agent keys can pass None).
    let identity_id: Option<String> = match inkbox.list_identities() {
        Ok(ids) => {
            println!("list_identities OK: {} identities", ids.len());
            ids.first().map(|i| i.id.to_string())
        }
        Err(e) => {
            println!("list_identities FAIL: {}", describe(&e));
            None
        }
    };
    let scope = identity_id.as_deref();

    // ---- Surface 1: calls.list ----
    match inkbox.calls().list(scope, 25, 0, None) {
        Ok(calls) => {
            println!(
                "[1] calls.list OK: {} calls (scope={:?})",
                calls.len(),
                scope
            );
            let mut ded = 0;
            let mut shared = 0;
            for c in &calls {
                match c.origin {
                    CallOrigin::DedicatedNumber => {
                        ded += 1;
                        if c.local_phone_number.is_none() {
                            println!(
                                "    WARN dedicated call {} has null local_phone_number",
                                c.id
                            );
                        }
                    }
                    CallOrigin::SharedImessageNumber => {
                        shared += 1;
                        if c.local_phone_number.is_some() {
                            println!(
                                "    WARN shared call {} has non-null local_phone_number",
                                c.id
                            );
                        }
                    }
                }
            }
            println!("    origins: dedicated={ded} shared={shared}");

            // ---- Surface 2: calls.get ----
            if let Some(first) = calls.first() {
                let id = first.id.to_string();
                match inkbox.calls().get(&id) {
                    Ok(one) => println!(
                        "[2] calls.get OK: id={} status={} origin={:?} local={:?}",
                        one.id, one.status, one.origin, one.local_phone_number
                    ),
                    Err(e) => println!("[2] calls.get FAIL: {}", describe(&e)),
                }
                // ---- Surface 3: transcripts ----
                match inkbox.calls().transcripts(&id) {
                    Ok(t) => println!("[3] transcripts OK: {} segments", t.len()),
                    Err(e) => println!("[3] transcripts FAIL: {}", describe(&e)),
                }
            } else {
                println!("[2/3] no calls returned; get/transcripts not exercised");
            }
        }
        Err(e) => println!("[1] calls.list FAIL: {}", describe(&e)),
    }

    // ---- Surface 4: incoming-call-action get + set + validation ----
    match inkbox.incoming_call_action().get(scope) {
        Ok(cfg) => println!(
            "[4a] incoming-call-action.get OK: action={:?} ws={:?} webhook={:?}",
            cfg.incoming_call_action, cfg.client_websocket_url, cfg.incoming_call_webhook_url
        ),
        Err(e) => println!("[4a] incoming-call-action.get FAIL: {}", describe(&e)),
    }
    // Valid set: auto_accept + wss url.
    match inkbox.incoming_call_action().set(
        IncomingCallAction::AutoAccept,
        scope,
        Some("wss://example.com/agent-audio"),
        None,
    ) {
        Ok(cfg) => println!(
            "[4b] incoming-call-action.set(auto_accept + wss) OK: action={:?} ws={:?}",
            cfg.incoming_call_action, cfg.client_websocket_url
        ),
        Err(e) => println!(
            "[4b] incoming-call-action.set(valid) FAIL: {}",
            describe(&e)
        ),
    }
    // Invalid: auto_accept without ws -> expect 422.
    match inkbox
        .incoming_call_action()
        .set(IncomingCallAction::AutoAccept, scope, None, None)
    {
        Ok(_) => println!("[4c] auto_accept-without-ws: UNEXPECTED 200 (validation NOT wired)"),
        Err(InkboxError::Api {
            status_code: 422,
            detail,
        }) => {
            println!("[4c] auto_accept-without-ws rejected 422 OK: {detail:?}")
        }
        Err(e) => println!("[4c] auto_accept-without-ws other error: {}", describe(&e)),
    }
    // Invalid: http:// webhook -> expect 422.
    match inkbox.incoming_call_action().set(
        IncomingCallAction::Webhook,
        scope,
        None,
        Some("http://insecure.example.com/hook"),
    ) {
        Ok(_) => println!("[4d] http-webhook: UNEXPECTED 200 (validation NOT wired)"),
        Err(InkboxError::Api {
            status_code: 422,
            detail,
        }) => {
            println!("[4d] http-webhook rejected 422 OK: {detail:?}")
        }
        Err(e) => println!("[4d] http-webhook other error: {}", describe(&e)),
    }

    // ---- Surface 5a: shared-origin wiring WITHOUT extra ringing ----
    // origination=shared to an unassigned number -> expect 409 no_shared_connection.
    match inkbox.calls().place(
        "+15555550006",
        CallOrigin::SharedImessageNumber,
        None,
        scope,
        None,
    ) {
        Ok(c) => println!("[5a] shared place-call: UNEXPECTED 200 id={}", c.call.id),
        Err(InkboxError::Api {
            status_code: 409,
            detail,
        }) => {
            println!("[5a] shared place-call rejected 409 OK (no_shared_connection): {detail:?}")
        }
        Err(e) => println!("[5a] shared place-call other error: {}", describe(&e)),
    }

    // ---- Surface 5b: REAL dedicated call (rings a phone) ----
    // Gated behind PLACE_REAL_CALL=1 + INKBOX_FROM_NUMBER + INKBOX_TO_NUMBER so
    // it never rings anyone by accident.
    if std::env::var("PLACE_REAL_CALL").as_deref() == Ok("1") {
        match (
            std::env::var("INKBOX_FROM_NUMBER"),
            std::env::var("INKBOX_TO_NUMBER"),
        ) {
            (Ok(from), Ok(to)) if !from.is_empty() && !to.is_empty() => {
                match inkbox.calls().place(
                    &to,
                    CallOrigin::DedicatedNumber,
                    Some(&from),
                    scope,
                    None,
                ) {
                    Ok(c) => println!(
                        "[5b] dedicated place-call OK: origin={:?} status={} local={:?} to={}",
                        c.call.origin,
                        c.call.status,
                        c.call.local_phone_number,
                        c.call.remote_phone_number
                    ),
                    Err(e) => println!("[5b] dedicated place-call FAIL: {}", describe(&e)),
                }
            }
            _ => println!("[5b] SKIPPED: INKBOX_FROM_NUMBER / INKBOX_TO_NUMBER not set"),
        }
    } else {
        println!("[5b] SKIPPED: set PLACE_REAL_CALL=1 + INKBOX_FROM_NUMBER + INKBOX_TO_NUMBER to ring a phone");
    }
}

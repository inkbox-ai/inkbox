//! Identity, email, and phone workflow for the Inkbox Rust SDK.
//!
//! Creates an agent identity (mailbox + tunnel are provisioned atomically),
//! sends an email, reads it back, optionally provisions a number and places a
//! call, then cleans up. Mirrors `examples/use-inkbox-cli/01-identity-and-email.sh`
//! and `03-phone-call.sh`.
//!
//! Run with:  cargo run          (or: cargo run --bin 01-identity-and-email)

use std::env;
use std::thread::sleep;
use std::time::Duration;

use inkbox::phone::CallOrigin;
use inkbox::whoami::WhoamiResponse;
use inkbox::{AgentIdentity, Inkbox};

/// How long to wait for the outbound message to land in the mailbox.
const INBOX_POLL_ATTEMPTS: u32 = 10;
const INBOX_POLL_INTERVAL: Duration = Duration::from_secs(3);

fn main() -> inkbox::Result<()> {
    // Resolves INKBOX_API_KEY (then ~/.inkbox/config); errors if no key is found.
    let inkbox = Inkbox::from_env()?;

    match inkbox.whoami()? {
        WhoamiResponse::ApiKey(info) => {
            println!("=> Authenticated as api_key ({:?})", info.auth_subtype);
        }
        WhoamiResponse::Jwt(info) => {
            println!("=> Authenticated as jwt ({:?})", info.email);
        }
    }

    let handle = env::var("INKBOX_AGENT_HANDLE").unwrap_or_else(|_| "rust-demo".to_string());

    println!("\n=> Creating identity: {handle} (mailbox + tunnel provisioned atomically)");
    let identity = inkbox.create_identity(&handle)?;
    let address = identity
        .email_address()
        .expect("create_identity always provisions a mailbox");
    println!("   {address}");
    if let Some(tunnel) = identity.tunnel() {
        println!("   https://{}", tunnel.public_host);
    }

    // Run the demo, then always tear down — a failed step should not leave a
    // live identity (and a billed phone number) behind.
    let outcome = run(&identity, &address);
    cleanup(&identity);
    outcome
}

fn run(identity: &AgentIdentity, address: &str) -> inkbox::Result<()> {
    // Default to mailing the agent itself so the example needs no extra config.
    let recipient = env::var("INKBOX_DEMO_EMAIL").unwrap_or_else(|_| address.to_string());

    println!("\n=> Sending a test email to {recipient}");
    let sent = identity.send_email(
        &[recipient],
        "Rust SDK demo",
        Some("Hello from the Inkbox Rust SDK!"),
        None,  // body_html
        None,  // cc
        None,  // bcc
        None,  // in_reply_to_message_id
        None,  // attachments
        false, // track_opens
    )?;
    println!("   sent {} ({})", sent.id, sent.status);

    println!("\n=> Polling the inbox for delivery");
    let inbound = poll_for_inbound(identity)?;
    match inbound {
        Some(message) => {
            println!(
                "   [{}] {}",
                message.from_address,
                message.subject.as_deref().unwrap_or("(no subject)")
            );

            // Fetching a single inbound message by id marks it read server-side;
            // iterating does not.
            let detail = identity.get_message(&message.id.to_string())?;
            let body = detail.body_text.unwrap_or_default();
            println!("   {}", body.lines().next().unwrap_or(""));
        }
        None => println!("   No messages yet (delivery can take a moment)."),
    }

    // Phone is opt-in: provisioning a number costs money, so only do it when a
    // destination is configured.
    let Ok(to_number) = env::var("INKBOX_DEMO_PHONE") else {
        println!("\n=> Skipping the call (set INKBOX_DEMO_PHONE to +1... to enable it)");
        return Ok(());
    };

    println!("\n=> Provisioning a local phone number");
    let phone =
        identity.provision_phone_number("local", env::var("INKBOX_DEMO_STATE").ok().as_deref())?;
    println!("   {} (sms_status={:?})", phone.number, phone.sms_status);

    println!("\n=> Placing a call to {to_number}");
    let placed = identity.place_call(
        &to_number,
        CallOrigin::DedicatedNumber,
        // Without a client WebSocket the call has no audio source; swap in
        // `place_hosted_call(&to_number, CallOrigin::DedicatedNumber, reason)`
        // to let Inkbox Voice AI drive the conversation instead.
        env::var("INKBOX_DEMO_WEBSOCKET").ok().as_deref(),
    )?;
    println!("   call {} ({})", placed.call.id, placed.call.status);
    if let Some(limit) = &placed.rate_limit {
        println!("   {} calls remaining this period", limit.calls_remaining);
    }

    println!("\n=> Transcript segments so far");
    let segments = identity.list_transcripts(&placed.call.id.to_string())?;
    if segments.is_empty() {
        println!("   (none yet — transcripts fill in as the call progresses)");
    }
    for segment in &segments {
        println!("   [{}] {}", segment.party, segment.text);
    }

    Ok(())
}

/// Fetch the inbox until an inbound message shows up, or the budget runs out.
fn poll_for_inbound(identity: &AgentIdentity) -> inkbox::Result<Option<inkbox::mail::Message>> {
    use inkbox::mail::MessageDirection;

    for attempt in 1..=INBOX_POLL_ATTEMPTS {
        // iter_emails drains every page eagerly and returns newest-first.
        let messages = identity.iter_emails(Some(10), Some(MessageDirection::Inbound))?;
        if let Some(message) = messages.into_iter().next() {
            return Ok(Some(message));
        }
        if attempt < INBOX_POLL_ATTEMPTS {
            sleep(INBOX_POLL_INTERVAL);
        }
    }
    Ok(None)
}

/// Release the number and delete the identity (cascades to mailbox + tunnel).
///
/// Best-effort: teardown failures are reported but never mask the real error.
fn cleanup(identity: &AgentIdentity) {
    if env::var("INKBOX_KEEP_IDENTITY").is_ok() {
        println!("\n=> INKBOX_KEEP_IDENTITY set — leaving the identity in place.");
        return;
    }

    println!("\n=> Cleaning up...");
    if identity.phone_number().is_some() {
        if let Err(e) = identity.release_phone_number() {
            eprintln!("   could not release the phone number: {e}");
        }
    }
    // identity delete cascades to the linked mailbox + tunnel
    if let Err(e) = identity.delete() {
        eprintln!("   could not delete the identity: {e}");
        return;
    }
    println!("   Done.");
}

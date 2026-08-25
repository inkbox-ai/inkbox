//! Agent self-signup — register, verify, check status, send welcome, clean up.
//!
//! Requires no pre-existing API key for registration. Most agents are claimed
//! with a 6-digit code; a matching email-bound invitation can claim immediately.
//! Mirrors `examples/use-inkbox-signup/agent_signup.py`.
//!
//! Environment variables:
//!   INKBOX_HUMAN_EMAIL        — human who owns or approves the agent (register)
//!   INKBOX_NOTE_TO_HUMAN      — message included in the verification email (register)
//!   INKBOX_AGENT_HANDLE       — optional base handle; a unique suffix is appended
//!   INKBOX_A2A_INVITATION     — optional A2A connection invitation link or token
//!   INKBOX_API_KEY            — one-time key returned by register (all other steps)
//!   INKBOX_AGENT_HANDLE_SAVED — handle returned by register (send-welcome, cleanup)
//!
//! Run with:
//!   cargo run --bin 07-signup -- register
//!   cargo run --bin 07-signup -- status
//!   cargo run --bin 07-signup -- verify --code 483921
//!   cargo run --bin 07-signup -- send-welcome
//!   cargo run --bin 07-signup -- cleanup

use std::env;
use std::process::exit;
use std::time::{SystemTime, UNIX_EPOCH};

use inkbox::agent_signup::{AgentSignupOptions, AgentSignupResponse, AgentSignupStatusResponse};
use inkbox::Inkbox;

fn main() -> inkbox::Result<()> {
    let argv: Vec<String> = env::args().skip(1).collect();
    let command = argv.first().map(String::as_str).unwrap_or("");

    match command {
        "register" => register(),
        "status" => status(),
        "verify" => verify(&argv),
        "resend" => resend(),
        "send-welcome" => send_welcome(),
        "cleanup" => cleanup(),
        "" => fail("Usage: 07-signup <register|status|verify|resend|send-welcome|cleanup>"),
        other => fail(&format!("Unknown command: {other}")),
    }
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

fn register() -> inkbox::Result<()> {
    let human_email = require_env("INKBOX_HUMAN_EMAIL");
    let note = env::var("INKBOX_NOTE_TO_HUMAN").unwrap_or_else(|_| {
        "Hey! This is my agent signing up via the Inkbox Rust signup example.".into()
    });
    let base_handle = env::var("INKBOX_AGENT_HANDLE").unwrap_or_else(|_| "signup-demo".into());
    let agent_handle = format!("{base_handle}-{}", unique_suffix());
    let invitation = env::var("INKBOX_A2A_INVITATION").ok();

    // signup_with carries the additive options; the positional `signup` covers
    // the common case. Neither needs a client — they are associated functions.
    let result = Inkbox::signup_with(
        &human_email,
        &note,
        AgentSignupOptions {
            display_name: Some("Signup Demo Agent"),
            agent_handle: Some(&agent_handle),
            email_local_part: Some(&agent_handle),
            harness: Some("claude-code"),
            invitation_token: invitation.as_deref(),
        },
        None,
        None,
    )?;

    println!("\nAgent registered successfully!\n");
    println!("  Email:    {}", result.email_address);
    println!("  Handle:   {}", result.agent_handle);
    println!("  Org:      {}", result.organization_id);
    println!("  Status:   {}", result.claim_status);
    if let Some(invitation) = &result.invitation {
        println!("  Invite:   {}", invitation.status);
    }
    println!("\n  API Key:  {}\n", result.api_key);
    println!("Save the API key — it is shown only once.");
    println!("{}\n", result.message);
    println!("Next steps:");
    println!("  1. Add INKBOX_API_KEY to your .env");
    println!(
        "  2. Add INKBOX_AGENT_HANDLE_SAVED={} to your .env",
        result.agent_handle
    );
    println!("  3. Run: cargo run --bin 07-signup -- status");
    if is_claimed(&result) {
        println!("  4. Already claimed; skip verification and run: cargo run --bin 07-signup -- send-welcome");
    } else {
        println!("  4. After the human shares the code: cargo run --bin 07-signup -- verify --code <code>");
    }
    Ok(())
}

fn status() -> inkbox::Result<()> {
    let api_key = require_env("INKBOX_API_KEY");
    let status = Inkbox::get_signup_status(&api_key, None, None)?;
    println!("Signup status:");
    print_status(&status);
    Ok(())
}

fn verify(argv: &[String]) -> inkbox::Result<()> {
    let api_key = require_env("INKBOX_API_KEY");
    let code = flag(argv, "--code")
        .or_else(|| env::var("INKBOX_VERIFICATION_CODE").ok())
        .unwrap_or_else(|| fail("Pass --code or set INKBOX_VERIFICATION_CODE."));

    let result = Inkbox::verify_signup(&api_key, &code, None, None)?;
    println!("\nVerification successful!");
    println!("  claim_status: {}", result.claim_status);
    println!("  org:          {}", result.organization_id);
    println!("  message:      {}", result.message);
    println!("\nNext: cargo run --bin 07-signup -- send-welcome");
    Ok(())
}

fn resend() -> inkbox::Result<()> {
    let api_key = require_env("INKBOX_API_KEY");
    let result = Inkbox::resend_signup_verification(&api_key, None, None)?;
    println!("\nVerification email resent.");
    println!("  claim_status: {}", result.claim_status);
    println!("  org:          {}", result.organization_id);
    println!("  message:      {}", result.message);
    Ok(())
}

fn send_welcome() -> inkbox::Result<()> {
    let api_key = require_env("INKBOX_API_KEY");
    let handle = require_env("INKBOX_AGENT_HANDLE_SAVED");

    let inkbox = Inkbox::new(&api_key)?;
    let identity = inkbox.get_identity(&handle)?;
    let status = Inkbox::get_signup_status(&api_key, None, None)?;

    let body = format!(
        "Hi! I'm {} ({}). I'm all set up and claimed.",
        identity.agent_handle(),
        identity.email_address().unwrap_or_default()
    );
    identity.send_email(
        std::slice::from_ref(&status.human_email),
        "Hello from your agent!",
        Some(&body),
        None,
        None,
        None,
        None,
        None,
        false,
    )?;
    println!("Sent welcome email to {}", status.human_email);
    println!("  from: {:?}", identity.email_address());
    Ok(())
}

fn cleanup() -> inkbox::Result<()> {
    let api_key = require_env("INKBOX_API_KEY");
    let handle = require_env("INKBOX_AGENT_HANDLE_SAVED");

    let inkbox = Inkbox::new(&api_key)?;
    inkbox.get_identity(&handle)?.delete()?;
    println!("Deleted identity: {handle}");
    Ok(())
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Signup already claimed the agent when an invitation was accepted, or when
/// the server reports the claimed status directly.
fn is_claimed(result: &AgentSignupResponse) -> bool {
    result
        .invitation
        .as_ref()
        .is_some_and(|i| i.status == "accepted")
        || result.claim_status == "agent_claimed"
}

fn print_status(status: &AgentSignupStatusResponse) {
    println!("  claim_status:         {}", status.claim_status);
    println!("  human_state:          {}", status.human_state);
    println!("  human_email:          {}", status.human_email);
    println!(
        "  max_sends_per_day:    {}",
        status.restrictions.max_sends_per_day
    );
    let allowed = status.restrictions.allowed_recipients.join(", ");
    println!(
        "  allowed_recipients:   {}",
        if allowed.is_empty() { "-" } else { &allowed }
    );
    println!(
        "  can_receive:          {}",
        status.restrictions.can_receive
    );
    println!(
        "  can_create_mailboxes: {}",
        status.restrictions.can_create_mailboxes
    );
}

/// Short unique suffix so repeated registrations do not collide on the handle.
/// Avoids pulling in a uuid dependency for a throwaway value.
fn unique_suffix() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    // Low 32 bits keep the suffix to exactly 8 hex characters.
    format!("{:08x}", nanos & 0xffff_ffff)
}

fn flag(argv: &[String], name: &str) -> Option<String> {
    argv.iter()
        .position(|a| a == name)
        .and_then(|i| argv.get(i + 1))
        .cloned()
}

fn require_env(name: &str) -> String {
    match env::var(name) {
        Ok(v) if !v.trim().is_empty() => v,
        _ => fail(&format!("ERROR: {name} is required.")),
    }
}

fn fail(msg: &str) -> ! {
    eprintln!("{msg}");
    exit(1);
}

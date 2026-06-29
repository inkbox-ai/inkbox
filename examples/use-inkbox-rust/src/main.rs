//! Identity & email workflow — create an identity, send and read email, clean up.
//!
//! Mirrors `examples/use-inkbox-cli/01-identity-and-email.sh`.
//!
//! Requires `INKBOX_API_KEY` in the environment (see `.env.example`).

use std::env;
use std::process;

use inkbox::Inkbox;

fn make_handle() -> String {
    let base = env::var("INKBOX_AGENT_HANDLE")
        .unwrap_or_else(|_| "rust-email-demo".to_string())
        .trim()
        .to_string();
    let suffix = uuid::Uuid::new_v4().simple().to_string()[..8].to_string();
    format!("{base}-{suffix}")
}

fn main() {
    dotenvy::dotenv().ok();

    let api_key = env::var("INKBOX_API_KEY").unwrap_or_else(|_| {
        eprintln!("ERROR: Set INKBOX_API_KEY before running this example.");
        process::exit(1);
    });

    let handle = make_handle();

    let inkbox = match Inkbox::new(api_key) {
        Ok(client) => client,
        Err(e) => {
            eprintln!("ERROR: Failed to create Inkbox client: {e}");
            process::exit(1);
        }
    };

    let identity = match inkbox.create_identity(&handle) {
        Ok(id) => id,
        Err(e) => {
            eprintln!("ERROR: Failed to create identity: {e}");
            process::exit(1);
        }
    };

    let mailbox = identity
        .email_address()
        .unwrap_or_else(|| format!("{handle}@inkboxmail.com"));

    println!(
        "=> Created identity: {} ({})",
        identity.agent_handle(),
        mailbox
    );

    println!("\n=> Sending a test email");
    if let Err(e) = identity.send_email(
        std::slice::from_ref(&mailbox),
        "Rust SDK demo",
        Some("Hello from the Inkbox Rust SDK!"),
        None,
        None,
        None,
        None,
        None,
    ) {
        eprintln!("ERROR: Failed to send email: {e}");
        let _ = identity.delete();
        process::exit(1);
    }

    println!("\n=> Listing emails");
    let messages = match identity.iter_emails(Some(5), None) {
        Ok(msgs) => msgs,
        Err(e) => {
            eprintln!("ERROR: Failed to list emails: {e}");
            let _ = identity.delete();
            process::exit(1);
        }
    };

    for msg in &messages {
        println!(
            "   id={} subject={:?} from={}",
            msg.id, msg.subject, msg.from_address
        );
    }

    if let Some(first) = messages.first() {
        println!("\n=> Reading the first message");
        match identity.get_message(&first.id.to_string()) {
            Ok(detail) => {
                let body = detail.body_text.as_deref().unwrap_or("(no body_text)");
                println!("   body_text: {}", body);
            }
            Err(e) => eprintln!("   Could not fetch message (delivery may be pending): {e}"),
        }

        println!("\n=> Marking message as read");
        if let Err(e) = identity.mark_emails_read(&[first.id.to_string()]) {
            eprintln!("ERROR: Failed to mark read: {e}");
            let _ = identity.delete();
            process::exit(1);
        }
        println!("   Marked {} as read.", first.id);
    } else {
        println!("   No messages found yet (delivery may take a moment).");
    }

    println!("\n=> Cleaning up");
    if let Err(e) = identity.delete() {
        eprintln!("ERROR: Failed to delete identity: {e}");
        process::exit(1);
    }
    println!("   Deleted identity: {}", handle);
    println!("   Done.");
}

//! Inbox monitor.
//!
//! Polls for unread emails at a regular interval — demonstrates an ongoing
//! automation pattern. Mirrors `examples/use-inkbox-cli/04-inbox-monitor.sh`.
//!
//! Run with:
//!   cargo run --bin 04-inbox-monitor -- --handle my-agent --interval 10 --max-checks 5
//!
//! Unlike the other examples this one creates nothing and deletes nothing — it
//! runs against an identity you already have.

use std::env;
use std::process::exit;
use std::thread::sleep;
use std::time::Duration;

use inkbox::Inkbox;

struct Args {
    handle: String,
    interval: Duration,
    /// 0 = unlimited.
    max_checks: u32,
}

fn parse_args() -> Args {
    let mut handle = env::var("INKBOX_AGENT_HANDLE").unwrap_or_else(|_| "rust-monitor-demo".into());
    let mut interval = 30u64;
    let mut max_checks = 0u32;

    let argv: Vec<String> = env::args().skip(1).collect();
    let mut i = 0;
    while i < argv.len() {
        let next = |i: usize| -> String {
            argv.get(i + 1)
                .cloned()
                .unwrap_or_else(|| fail(&format!("{} needs a value", argv[i])))
        };
        match argv[i].as_str() {
            "--handle" => {
                handle = next(i);
                i += 2;
            }
            "--interval" => {
                interval = next(i)
                    .parse()
                    .unwrap_or_else(|_| fail("--interval must be seconds"));
                i += 2;
            }
            "--max-checks" => {
                max_checks = next(i)
                    .parse()
                    .unwrap_or_else(|_| fail("--max-checks must be a count"));
                i += 2;
            }
            other => fail(&format!("Unknown option: {other}")),
        }
    }

    Args {
        handle,
        interval: Duration::from_secs(interval),
        max_checks,
    }
}

fn fail(msg: &str) -> ! {
    eprintln!("{msg}");
    exit(1);
}

fn main() -> inkbox::Result<()> {
    let args = parse_args();
    let inkbox = Inkbox::from_env()?;
    let identity = inkbox.get_identity(&args.handle)?;

    println!("Monitoring inbox for identity: {}", args.handle);
    println!(
        "Interval: {}s | Max checks: {}",
        args.interval.as_secs(),
        if args.max_checks == 0 {
            "unlimited".to_string()
        } else {
            args.max_checks.to_string()
        }
    );
    println!("Press Ctrl+C to stop.\n");

    let mut check = 0u32;
    loop {
        check += 1;
        if args.max_checks > 0 && check > args.max_checks {
            println!("Reached max checks ({}). Exiting.", args.max_checks);
            return Ok(());
        }

        println!("[check {check}] fetching unread emails...");
        // iter_unread_emails drains every page and filters client-side.
        let unread = identity.iter_unread_emails(Some(10), None)?;

        if unread.is_empty() {
            println!("  No unread messages.\n");
        } else {
            println!("  Found {} unread message(s):", unread.len());
            for m in &unread {
                println!(
                    "  - [{}] {} — {}",
                    m.id,
                    m.from_address,
                    m.subject.as_deref().unwrap_or("(no subject)")
                );
            }

            for m in &unread {
                let detail = identity.get_message(&m.id.to_string())?;
                let body = detail.body_text.unwrap_or_default();
                let preview: String = body.chars().take(200).collect();
                println!(
                    "\n  Reading message {}:\n    {}",
                    m.id,
                    preview.replace('\n', "\n    ")
                );
            }

            // Batch mark-read. Note that get_message above already marked each
            // inbound message read server-side; this is the list-only path.
            let ids: Vec<String> = unread.iter().map(|m| m.id.to_string()).collect();
            identity.mark_emails_read(&ids)?;
            println!("\n  Marked {} message(s) as read.\n", ids.len());
        }

        sleep(args.interval);
    }
}

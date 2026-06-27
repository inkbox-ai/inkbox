# use-inkbox-rust

Rust SDK quickstart — create an identity, send and read email, mark a message read, then clean up.

Mirrors the `use-inkbox-cli/01-identity-and-email.sh` workflow using the local `sdk/rust` crate.

## Prerequisites

1. Rust ≥ 1.74 (`rustc --version`)
2. An Inkbox API key (`INKBOX_API_KEY`) from [inkbox.ai/console](https://inkbox.ai/console) — a signup-issued API key does not have permission to create identities

## Run

```bash
cp .env.example .env
# edit .env — set INKBOX_API_KEY

cargo run
```

The example uses a path dependency on `../../sdk/rust`, so no crates.io publish is required.

## What it does

1. Creates identity `rust-email-demo` (mailbox + tunnel provisioned atomically)
2. Sends a test email to the identity's own mailbox
3. Lists recent emails and prints id, subject, from
4. Fetches the first message body
5. Marks it as read
6. Deletes the identity (cascades to mailbox + tunnel)

## Cleanup

Identity deletion runs at the end of a successful run. If the process is interrupted, delete manually:

```bash
inkbox identity delete rust-email-demo
```

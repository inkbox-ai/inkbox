# use-inkbox-rust

Runnable Rust examples for the Inkbox SDK — a starting point for background workers, CLI tools, and anything else that wants a synchronous, dependency-light Inkbox client. Mirrors the numbered scripts in [`use-inkbox-cli`](../use-inkbox-cli/).

The Inkbox Rust SDK is **blocking** (built on `reqwest::blocking`), so there is no async runtime to set up and nothing to `.await`. The whole crate depends on `inkbox` and nothing else.

## Prerequisites

1. Rust ≥ 1.74
2. An Inkbox API key (`INKBOX_API_KEY`) — get one at [inkbox.ai/console](https://inkbox.ai/console)
3. A vault key (`INKBOX_VAULT_KEY`) — only for `02-vault-totp`; initialize the vault from the console first
4. A human email (`INKBOX_HUMAN_EMAIL`) — only for `07-signup`

## Install the SDK

```bash
cargo add inkbox
```

`Cargo.toml` already depends on the published `inkbox` crate. To build against a local checkout of `sdk/rust` instead, uncomment the `[patch.crates-io]` block at the bottom of that file.

## Examples

| Binary | What it does |
|--------|-------------|
| `01-identity-and-email` | Create an identity (with mailbox + tunnel), send and read an email, place a call, clean up |
| `02-vault-totp` | Store a login credential with TOTP, generate one-time codes, clean up |
| `04-inbox-monitor` | Poll for unread emails in a loop — demonstrates an ongoing automation pattern |
| `07-signup` | Agent self-signup — register without an API key, verify, send a welcome email, clean up |

Numbering matches `use-inkbox-cli` so the two sets line up; the gaps are scripts that have no Rust counterpart yet.

## Run

```bash
export INKBOX_API_KEY="ApiKey_..."

cargo run                              # 01 — the default binary
cargo run --bin 02-vault-totp
cargo run --bin 04-inbox-monitor -- --handle my-agent --interval 10 --max-checks 5
cargo run --bin 07-signup -- register
```

Cargo has no `--env-file` flag, so to use the provided template export it into the shell first:

```bash
cp .env.example .env
set -a && . ./.env && set +a
cargo run
```

### 01 — identity and email

| Step | Method |
|--------|-------------|
| Authenticate | `Inkbox::from_env()` + `inkbox.whoami()` |
| Create an identity (mailbox + tunnel provisioned atomically) | `inkbox.create_identity(handle)` |
| Send an email | `identity.send_email(...)` |
| Poll the inbox and read the newest inbound message | `identity.iter_emails(...)` + `identity.get_message(...)` |
| Provision a number and place a call | `identity.provision_phone_number(...)` + `identity.place_call(...)` |
| Fetch the transcript | `identity.list_transcripts(call_id)` |
| Clean up (cascades to mailbox + tunnel) | `identity.release_phone_number()` + `identity.delete()` |

Teardown runs even when a step fails, so a bad run does not leave a live identity — or a billed phone number — behind. The call step is opt-in via `INKBOX_DEMO_PHONE`, so a bare `cargo run` is safe and free.

Without a client WebSocket the call has no audio source. Swap `place_call` for `place_hosted_call(&to_number, CallOrigin::DedicatedNumber, reason)` to let Inkbox Voice AI drive the conversation — no WebSocket and no code required.

### 07 — signup

Registration needs **no** API key. Save the one-time key it prints, then run the remaining steps:

```bash
cargo run --bin 07-signup -- register        # no auth
# add INKBOX_API_KEY and INKBOX_AGENT_HANDLE_SAVED to .env, then:
cargo run --bin 07-signup -- status
cargo run --bin 07-signup -- verify --code 483921   # only if still unclaimed
cargo run --bin 07-signup -- send-welcome
cargo run --bin 07-signup -- cleanup
```

Other subcommands: `resend` (5-minute cooldown). See [`skills/inkbox-agent-self-signup/SKILL.md`](../../skills/inkbox-agent-self-signup/SKILL.md) for the full flow and the unclaimed-vs-claimed restrictions.

## Configuration

| Variable | Used by | Purpose |
|---|---|---|
| `INKBOX_API_KEY` | all but `07-signup register` | Also read from `~/.inkbox/config` by `Inkbox::from_env()` |
| `INKBOX_BASE_URL` | all | Override the API host |
| `INKBOX_VAULT_KEY` | 02 | Unlocks the vault; `from_env()` picks it up automatically |
| `INKBOX_AGENT_HANDLE` | 01, 04, 07 | Identity handle (07 appends a unique suffix) |
| `INKBOX_DEMO_EMAIL` | 01 | Where the test email is sent (default: the agent's own address) |
| `INKBOX_DEMO_PHONE` | 01 | Destination for the call; unset skips provisioning and calling |
| `INKBOX_DEMO_STATE` | 01 | US state abbreviation (e.g. `NY`) for the provisioned number |
| `INKBOX_DEMO_WEBSOCKET` | 01 | `wss://` URL to stream call audio to |
| `INKBOX_KEEP_IDENTITY` | 01, 02 | Set to anything to skip teardown and keep the identity |
| `INKBOX_HUMAN_EMAIL` | 07 | Human who owns or approves the agent |
| `INKBOX_NOTE_TO_HUMAN` | 07 | Message included in the verification email |
| `INKBOX_A2A_INVITATION` | 07 | Optional A2A invitation link or raw token |
| `INKBOX_AGENT_HANDLE_SAVED` | 07 | Handle returned by `register` |
| `INKBOX_VERIFICATION_CODE` | 07 | Alternative to `verify --code` |

## Notes for automation

- Every call returns `inkbox::Result<T>` (`Result<T, inkbox::InkboxError>`), so `fn main() -> inkbox::Result<()>` plus `?` is the whole error story. Match on `InkboxError` variants (`StorageLimitExceeded`, `RecipientBlocked`, `DuplicateContactRule`, …) when you need the parsed fields.
- **Handles are not immediately reusable.** They live in a namespace shared with tunnels and mail, and a deleted handle stays reserved for a while, so re-running an example with the same handle can fail with a 409. Use `HandleUnavailableError::from_error(&e)` to read `blocking_namespace`, or vary `INKBOX_AGENT_HANDLE`.
- There are no keyword arguments in Rust: options are positional, and `None` means "server default". Tri-state fields use `Unset<T>` (`Omit` / `Value(None)` / `Value(Some(v))`).
- `iter_emails` drains every page eagerly and returns a `Vec<Message>`, unlike the Python/TypeScript generators.
- `identity.credentials()` is a view over the snapshot taken at unlock time — a secret you just created is not in it until you re-unlock. `02-vault-totp` demonstrates this.
- On the Free plan a footer is appended to the **stored** body of outgoing mail, so a fetched message is not byte-for-byte what you sent.
- The client is an `Arc<Inkbox>`; clone the `Arc` to share it. If you call the SDK from an async context, wrap the calls in `tokio::task::spawn_blocking`.

See [`skills/inkbox-rust/SKILL.md`](../../skills/inkbox-rust/SKILL.md) for the full SDK reference, and [`sdk/rust/README.md`](../../sdk/rust/README.md) for crate-level details.

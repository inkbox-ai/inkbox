# inkbox — Rust SDK

Rust SDK for the [Inkbox](https://inkbox.ai) API — email, SMS/MMS, iMessage,
voice, contacts, notes, an encrypted vault, and inbound tunnels for AI agents.

This crate is a faithful port of the [Python](https://github.com/inkbox-ai/inkbox/tree/main/sdk/python) (`inkbox` on PyPI) and
[TypeScript](https://github.com/inkbox-ai/inkbox/tree/main/sdk/typescript) (`@inkbox/sdk` on npm) SDKs. The public surface is
**blocking** (built on `reqwest::blocking`), matching the synchronous Python/TS
APIs. JSON field names, enum values, request bodies, query params, and paths
match the other SDKs exactly — they all speak to the same server.

## Install

```toml
[dependencies]
inkbox = "0.5"
```

The tunnels data-plane runtime is behind an optional feature:

```toml
[dependencies]
inkbox = { version = "0.5", features = ["tunnels-runtime"] }
```

## Quickstart

```rust
use inkbox::Inkbox;

fn main() -> inkbox::Result<()> {
    // The client is handed out as an `Arc<Inkbox>` (the per-identity facade
    // and the tunnels resource hold a back-reference to it).
    let inkbox = Inkbox::new("ApiKey_...")?;

    // Create an agent identity (atomically provisions a mailbox + tunnel).
    let identity = inkbox.create_identity("support-bot")?;

    // Send an email from the identity's mailbox.
    identity.send_email(
        &["customer@example.com".into()],
        "Hello!",
        Some("Hi there"),
        None, None, None, None, None, false,
    )?;

    // Read the inbox.
    for msg in identity.iter_emails(None, None)? {
        println!("{:?}", msg.subject);
    }
    Ok(())
}
```

### Advanced construction

```rust
use inkbox::Inkbox;

let inkbox = Inkbox::builder("ApiKey_...")
    .base_url("https://inkbox.ai")  // self-hosting / tests (HTTPS, or localhost over HTTP)
    .timeout_secs(30.0)
    .vault_key("my-Vault-key-01!")  // unlock the vault at construction
    .build()?;
```

### Construction from the environment

```rust
// Resolves api_key / base_url / vault_key from the matching env var
// (INKBOX_API_KEY / INKBOX_BASE_URL / INKBOX_VAULT_KEY), then ~/.inkbox/config
// (`key = value` lines). Handy for background/agent processes that don't
// inherit the shell's env. Errors if no API key is found.
let inkbox = Inkbox::from_env()?;
```

### Vault credentials

```rust
let inkbox = Inkbox::builder("ApiKey_...").vault_key("my-Vault-key-01!").build()?;
let identity = inkbox.get_identity("support-bot")?;

for login in identity.credentials()?.list_logins() {
    println!("{}", login.name);
}
```

## Surface

Org-level accessors on `Inkbox` mirror the Python `@property` names:

| Domain | Accessor |
|---|---|
| Mail | `mailboxes()`, `messages()`, `threads()`, `mail_identity_contact_rules()`, `mail_contact_rules()` *(deprecated)*, `domains()` |
| Phone | `calls()`, `phone_numbers()`, `texts()`, `incoming_call_action()`, `phone_identity_contact_rules()`, `phone_contact_rules()` *(deprecated)*, `sms_opt_ins()` |
| iMessage | `imessages()`, `imessage_contact_rules()` |
| Vault / data | `vault()`, `contacts()`, `notes()` |
| Org | `api_keys()`, `identities()`, `signing_keys()`, `tunnels()`, `webhooks()` |

Contact rules and webhook signing keys are keyed by **agent identity**, addressed
by `agent_handle`. Use `mail_identity_contact_rules()` /
`phone_identity_contact_rules()` (per-identity `list`/`get`/`create`/`update`/
`delete` plus an org-wide `list_all`) and `signing_keys()`
(`create_or_rotate(handle)` / `get_status(handle)`). The legacy per-mailbox /
per-number `mail_contact_rules()` / `phone_contact_rules()` accessors and the
org-level `create_signing_key()` are deprecated bridges that remain for
back-compat.

The per-identity facade `AgentIdentity` (from `create_identity` / `get_identity`)
exposes channel-scoped convenience methods: `send_email`, `forward_email`,
`iter_emails`, `place_call`, `send_text`, `send_imessage`, `credentials`,
`create_secret`, `set_totp`, the identity-keyed contact-rule helpers
(`list_mail_contact_rules`, `create_phone_contact_rule`, ...), `create_signing_key`,
and more.

### Dedicated iMessage numbers

List or claim organization-owned dedicated numbers through the iMessage resource:

```rust
use inkbox::imessage::IMessageNumberType;

let available = inkbox.imessages().list_numbers()?;
let number = inkbox
    .imessages()
    .claim_number(IMessageNumberType::DedicatedOutbound, "setup-support-number-v1")?;

assert!(number.can_start_conversation());
```

A number can also be claimed and attached atomically while creating an identity:

```rust
use inkbox::identities::Unset;
use inkbox::imessage::IMessageNumberType;

let identity = inkbox.create_identity_with_imessage_number(
    "support-bot",
    None,
    Unset::Omit,
    Some(true),
    None,
    Unset::Omit,
    None,
    None,
    None,
    Some(IMessageNumberType::DedicatedInbound),
)?;

let number = identity.imessage_number().expect("dedicated number");
assert_eq!(number.r#type, IMessageNumberType::DedicatedInbound);
```

For an existing identity, `update_with_imessage_number` can attach an already
owned number by id, move back to shared iMessage service with an explicit null,
or claim and attach a new number by type. Claims require a stable 1–255 character
idempotency key; reuse the same key after an ambiguous result. Dedicated outbound
numbers are the only number type that can start a new conversation.

Dedicated outbound identities can also start group conversations. Scalar sends
remain on `send_imessage`; groups use `send_imessage_group`, and later replies
use the returned conversation id with `send_imessage`:

```rust
use inkbox::imessage::IMessageSendStyle;

let recipients = vec!["+15551234567".to_string(), "+15557654321".to_string()];
let group_media = vec!["https://example.com/group-photo.jpg".to_string()];
let group = identity.send_imessage_group(
    &recipients,
    Some("Welcome to the group!"),
    Some(&group_media),
    Some(IMessageSendStyle::Confetti),
)?;
let reply_media = vec!["https://example.com/follow-up.jpg".to_string()];
identity.send_imessage(
    None,
    Some(&group.conversation_id),
    Some("Following up in the same conversation."),
    Some(&reply_media),
    Some(IMessageSendStyle::Lasers),
)?;

let conversations = identity.list_imessage_conversations_with_groups(
    50,
    0,
    None,
    true,
)?;
println!("{:?}", conversations[0].group_creation_status);
```

Group creation and conversation-id replies accept the same 13
`IMessageSendStyle` values as one-to-one sends, with or without the media URL.

List methods exclude groups by default for backwards compatibility. Group
messages expose `is_group`, a best-known `participants` snapshot, and
per-recipient delivery state; assignment and one-to-one remote fields are
optional. `group_creation_status` is `Creating`, `NotCreated`, or `Ready`. A
rejected initial creation keeps the same local conversation at `NotCreated`;
send again with that conversation id to retry. Success binds the remote thread
and changes the status to `Ready`.

`send_imessage_reaction` supports inbound one-to-one and group messages by
message id. The sendable named reactions are `love`, `like`, `dislike`,
`laugh`, `emphasize`, `question`, and `eyes`; arbitrary custom emoji remain
inbound-only. Group read receipts and typing indicators remain unsupported.

Static (no-client) helpers for the public agent-signup flow live on `Inkbox`:
`Inkbox::signup`, `verify_signup`, `resend_signup_verification`,
`get_signup_status`.

## Crypto

The vault uses Argon2id key derivation and AES-256-GCM envelope encryption,
with the exact parameters of the Python/TS SDKs, so secrets are
cross-SDK-interoperable. TOTP (SHA-1/256/512) and webhook HMAC-SHA256
signature verification (`signing_keys::verify_webhook`) are implemented in
pure Rust.

## Features

- `tunnels-runtime` — the local TLS-terminating HTTP/2 reverse-proxy data plane
  for inbound tunnels (pulls in `tokio`, `rustls` (ring), `h2`). Bring a tunnel
  online with `inkbox.tunnels().connect(name, forward_to)`, or
  `connect_with_status(name, forward_to, on_status)` to observe `"connecting"` /
  `"connected"` / `"reconnecting"` / `"closed"`. The control-plane tunnels surface
  (`inkbox.tunnels()`: list / get / update / sign_csr) is always available
  without this feature.

## Status

Feature-complete against the Python and TypeScript SDKs. The full REST
surface, vault crypto + TOTP, webhook verification, and the tunnels control
plane are implemented and tested. The tunnels **data-plane runtime**
(`tunnels-runtime` feature) is implemented end-to-end:

- Edge HTTP: TLS h2 dial, `/_system/hello`, parked intake pool, body
  materialization, URL-forward, `/_system/response/{id}`, PING keepalive,
  jittered reconnect.
- WebSocket upgrade bridge and raw-TCP passthrough bridge over h2 extended
  CONNECT, with local upstream WS handshake and rustls TLS termination.
- Passthrough bootstrap: EC P-256 keypair + PKCS#10 CSR signing + cert-chain
  persistence.

115 unit/integration tests cover the wire codecs, crypto, CSR, URL-forward, and
runtime lifecycle. The passthrough data plane has been validated end-to-end
against a live edge (TLS-terminated HTTP plus a real-time call media
WebSocket). See `src/tunnels/client/`.

## License

MIT

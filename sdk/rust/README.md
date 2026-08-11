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

### Voice AI authority

Voice AI calls inherit the identity's saved authority when no per-call override
is supplied. An explicit `ContactScoped` override always downscopes the call.
An explicit `Yolo` override requires an admin credential unless the saved
authority is already `Yolo`. Changing the saved default requires an admin API
key:

```rust
use inkbox::phone::{CallOrigin, HostedAgentAuthorityMode};

let call = identity.place_hosted_call(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    "Coordinate the appointment and send confirmations.",
)?;

identity.set_hosted_agent_authority_mode(
    HostedAgentAuthorityMode::Yolo,
)?;

let scoped_call = identity.place_hosted_call_with_authority(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    "Confirm only this caller's appointment.",
    HostedAgentAuthorityMode::ContactScoped,
)?;
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
| Agent-to-agent discovery and history | `a2a()` |
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

### Mailbox imports

```rust
use std::time::Duration;
use inkbox::mail::MailImportFormat;

let imports = inkbox.mailboxes().imports();
let created = imports.create(
    "agent@inkboxmail.com",
    MailImportFormat::Auto,
    Some(&["old-address@example.com".to_string()]),
    true,
)?;
imports.upload(&created.upload, "./archive.mbox")?;
imports.start("agent@inkboxmail.com", &created.job.id.to_string())?;
let job = imports.wait(
    "agent@inkboxmail.com",
    &created.job.id.to_string(),
    Some(Duration::from_secs(3600)),
    Some(Duration::from_secs(5)),
)?;
```

Imports support MBOX and EML files, or a ZIP holding either (a Gmail Takeout ZIP
imports as-is); ZIP entries that are not mail, including nested archives, are
ignored. `wait` returns completed, failed, and cancelled jobs, and reports a
local wall-clock timeout as `InkboxError::Timeout` without cancelling the job.
Counters are cumulative and never go backwards, but they can sit unchanged while
a large message is processed and do not represent a percentage. Jobs run one at
a time per organization and share overall import capacity, so a long `queued`
stretch is normal. Unsafe imported content may be rejected in
`messages_rejected_unsafe`.

Upload targets expire after 5 minutes; call `refresh_upload_target` and upload
again if one expires, or `cancel` the job so the mailbox is not held by an
upload that never landed. Other limits: 1 GiB per upload, 50 MiB per message,
100,000 messages and 20 original addresses per job, 65,000 entries per ZIP, 20
import jobs per organization per 24 hours (`InkboxError::MailImportQuotaExceeded`
carries the `Retry-After` value), and one in-flight import per mailbox.

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
Use `Inkbox::signup_with` for additive options.
Set `inkbox::agent_signup::AgentSignupOptions::harness` to the current runtime
so a claimed response can return matching plugin guidance in `message`.
`inkbox::agent_signup::AgentSignupOptions::invitation_token` accepts an
exact-origin share URL or raw token. `inkbox::extract_a2a_invitation_token`
uses the production site, while
`inkbox::extract_a2a_invitation_token_with_base_url` accepts an explicit site.
Only the token is sent during signup. Use this option for invitation-assisted
signup and omit it when you do not have an A2A connection invitation. Signup
and verification responses expose an optional invitation summary; the existing
positional `signup` is unchanged.
Raw and extracted tokens must match `a2ai_` followed by 43 URL-safe characters.
Share links require HTTPS, except for configured `localhost`/`127.0.0.1` URLs.
Review an invitation before signup without an API key using
`Inkbox::preview_a2a_invitation`. An existing claimed identity can accept it
with `inkbox.a2a().accept_invitation(...)`. Organization credentials can manage
the issuer lifecycle with `create_invitation`, `list_invitations`,
`get_invitation`, and `revoke_invitation` on the same A2A resource.

### Agent-to-agent discovery and history

Rust exposes identity-scoped A2A task, context, and message history. Receiver
configuration and the standard protocol client are currently available in the
Python and TypeScript SDKs.

```rust
use inkbox::a2a::{
    A2AContextListOptions, A2ADirectoryListOptions, A2AHistoryDirection,
    A2AMessageListOptions, A2ATaskListOptions,
};

let public_agents = inkbox.a2a().public_directory(&A2ADirectoryListOptions {
    q: Some("research".to_string()),
    limit: Some(25),
    ..Default::default()
})?;
let organization_agents = inkbox.a2a().organization_directory(
    &A2ADirectoryListOptions::default(),
)?;

let tasks = identity.a2a_tasks(&A2ATaskListOptions {
    direction: Some(A2AHistoryDirection::Both),
    worker_handle: Some("researcher".to_string()),
    q: Some("quarterly report".to_string()),
    limit: Some(25),
    ..Default::default()
})?;

let messages = identity.a2a_messages(&A2AMessageListOptions {
    direction: Some(A2AHistoryDirection::Outbound),
    worker_handle: Some("researcher".to_string()),
    q: Some("revenue".to_string()),
    limit: Some(25),
    ..Default::default()
})?;

let contexts = identity.a2a_contexts(&A2AContextListOptions {
    direction: Some(A2AHistoryDirection::Both),
    limit: Some(25),
    ..Default::default()
})?;

let renamed = identity.a2a_update_context(
    contexts.items[0].id,
    "Quarterly Research Review",
)?;

println!("{:?}", tasks.next_cursor);
println!("{} {}", public_agents.items.len(), organization_agents.items.len());
println!("{:?}", contexts.next_cursor);
for message in messages.items {
    println!("{} {} {:?}", message.task_id, message.task_state, message.parts);
}
```

New contexts immediately expose the persisted name `New A2A Session`. That
exact default may be replaced asynchronously with a short name based on the
first task message. Either participant can rename the shared context at any
time; a non-default name is not replaced by automatic naming. The
context's top-level caller and target remain the original opener and recipient,
while each nested task's participants identify that task's direction. Tasks in
both directions may run concurrently. Rust exposes the persisted ledger and
rename operation; it does not provide the outbound protocol client.

Task keyword filtering returns tasks containing a matching message. Message
filtering returns individual matching messages with task, context, requester,
and worker provenance. Search covers string and numeric content values from
`text` and `data` parts, excludes metadata, and is newest-first rather than
relevance-ranked. `role` is the message author (`caller` or `agent`),
independent of task direction. Cursors are opaque; pass `next_cursor` with the
same filters to fetch the next page.

The `webhooks::types` module includes `A2AWebhookPayload` and its typed event
discriminator for all four A2A task-lifecycle events.

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
  `"connected"` / `"reconnecting"` / `"closed"` / `"superseded"`. The control-plane tunnels surface
  (`inkbox.tunnels()`: list / get / update / sign_csr) is always available
  without this feature.

The connect methods remain blocking. Run them on a caller-owned thread and use
`TunnelStatusHandle` to sample local liveness elsewhere:

```rust
use inkbox::tunnels::client::TunnelStatusHandle;

let status = TunnelStatusHandle::new();
let runtime_status = status.clone();
let client = inkbox.clone();
let tunnel_thread = std::thread::spawn(move || {
    client.tunnels().connect_with_status(
        "my-app",
        "http://127.0.0.1:8080",
        runtime_status.callback(),
    )
});

let snapshot = status.snapshot();
println!("{:?} {:?}", snapshot.status, snapshot.last_connected_at);

// Join when shutdown is expected so bootstrap/runtime errors are not lost.
if let Err(error) = tunnel_thread.join().expect("tunnel thread panicked") {
    eprintln!("tunnel stopped: {error}");
}
```

The handle records `Idle`, `Connecting`, `Connected`, `Reconnecting`, `Closed`,
or `Superseded` and retains the latest successful connection time while
reconnecting. It is local runtime state, distinct from fields returned by
`inkbox.tunnels().get(...)`. Establishment is bounded and transient failures use
cold reconnect with exponential backoff; Rust does not use make-before-break
handoff. The SDK does not create an OS thread or take ownership of joining it.
The status remains `Idle` until runtime startup reaches its first lifecycle
transition, so inspect the thread result for validation or bootstrap failures.
Status callbacks run inline and must return promptly; send blocking monitoring
work to a caller-owned thread or queue.

## Status

The Rust SDK implements the REST resources documented above, vault crypto +
TOTP, webhook verification, and the tunnels control plane. Invitation-assisted
signup, unauthenticated preview, claimed-agent acceptance, and organization-side
invitation management are supported. The tunnels **data-plane runtime**
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

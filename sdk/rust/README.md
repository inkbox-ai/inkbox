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
inkbox = "0.6"
```

The tunnels data-plane runtime is behind an optional feature:

```toml
[dependencies]
inkbox = { version = "0.6", features = ["tunnels-runtime"] }
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

### Voicemail handling

`on_voicemail` selects what happens when voicemail answers: `LeaveMessage`
(the hosted-agent default; Voice AI waits for the beep and leaves a message),
`HangUp` (the client-driven default), or `Ignore` (no detection).
`voicemail_message` sets what Voice AI says and requires `LeaveMessage`. Both
are omitted from the request when `None`. `VoicemailDetection` is deprecated.

```rust
use inkbox::phone::{CallOrigin, HostedCallPlacementOptions, OnVoicemail};

let call = identity.place_hosted_call_with_options(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    "Coordinate the appointment and send confirmations.",
    &HostedCallPlacementOptions {
        on_voicemail: Some(OnVoicemail::LeaveMessage),
        voicemail_message: Some("Hi, this is Ava about your appointment. Please call us back.".into()),
        ..Default::default()
    },
)?;
println!("{}", call.call.on_voicemail.as_str());
```

### Discover Voice AI voices

```rust
use inkbox::phone::HostedAgentVoiceCatalog;

let catalog: HostedAgentVoiceCatalog = inkbox.hosted_agent().list_voices()?;
println!("Default voice: {}", catalog.default_voice);
for voice in &catalog.voices {
    println!("{}: {} (available: {})", voice.id, voice.name, voice.available);
    if let Some(preview_url) = &voice.preview_url {
        println!("Preview: {preview_url}");
    }
}
```

The catalog is organization-wide and needs no identity selector. It includes
unavailable voices; choose an entry with `available: true` and pass its `id` to
`hosted_agent().set_config(...)`. Voice IDs are strings, and previews may be
absent. Setting the config replaces both voice and instructions, so include
the current instructions when changing only the voice.

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
| Mail | `mailboxes()`, `messages()`, `drafts()`, `threads()`, `mail_identity_contact_rules()`, `mail_contact_rules()` *(deprecated)*, `domains()` |
| Phone | `calls()`, `phone_numbers()`, `texts()`, `hosted_agent()`, `incoming_call_action()`, `phone_identity_contact_rules()`, `phone_contact_rules()` *(deprecated)*, `sms_opt_ins()` |
| iMessage | `imessages()`, `imessage_contact_rules()` |
| Vault / data | `vault()`, `contacts()`, `notes()` |
| Agent-to-agent discovery and history | `a2a()` |
| Org | `api_keys()`, `identities()`, `signing_keys()`, `tunnels()`, `webhooks()` |

Incoming calls can be forwarded to a complete E.164 number or a SIP URI with a public DNS hostname using
`incoming_call_action().set_with_options(...)` and
`IncomingCallActionSetOptions`. Call responses expose chronological
`forwardings`; older responses deserialize to an empty vector.

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

### Email drafts

```rust
use inkbox::mail::{Attachment, CreateDraftOptions, DraftRecipients, UpdateDraftOptions};

let draft = identity.create_email_draft(&CreateDraftOptions {
    recipients: DraftRecipients {
        to: Some(vec!["reader@example.com".into()]),
        ..Default::default()
    },
    subject: Some("Draft subject".into()),
    body_text: Some("Draft body".into()),
    idempotency_key: Some("draft-create-2026-08-19-1".into()),
    ..Default::default()
})?;

for saved in identity.iter_email_drafts(None)? {
    println!("{} {}", saved.id, saved.generation);
}
let current = identity.get_email_draft(&draft.summary.id)?;
let mut current = identity.update_email_draft(
    &current.summary.id,
    current.summary.generation,
    &UpdateDraftOptions {
        subject: Some(None), // Explicitly clear; `None` leaves it unchanged.
        ..Default::default()
    },
)?;
let email = identity.email_address().unwrap();

current = inkbox.drafts().add_attachments(
    &email,
    &current.summary.id,
    current.summary.generation,
    &[Attachment {
        filename: "report.txt".into(),
        content_type: "text/plain".into(),
        content_base64: "cmVwb3J0".into(),
        content_id: None,
    }],
)?;
let part = &current.attachment_metadata[0];
let downloaded = inkbox.drafts().download_attachment(
    &email,
    &current.summary.id,
    part.part_index,
    current.summary.generation,
)?;
current = inkbox.drafts().remove_attachment(
    &email,
    &current.summary.id,
    part.part_index,
    current.summary.generation,
)?;

let copy = identity.duplicate_email_draft(&current.summary.id, current.summary.generation)?;
identity.delete_email_draft(&copy.summary.id, copy.summary.generation)?;
let sent = identity.send_email_draft(&current.summary.id, current.summary.generation)?;
```

`drafts().list` auto-paginates. Update, duplicate, delete, attachment changes,
attachment downloads, and send require the generation returned by the latest
read or mutation. Attachment `part_index` values belong to the generation that
returned them; refresh attachment metadata after an edit.

Drafts use the same Drafts folder as a connected mail client, so edits are
visible in both directions. A successful send returns a `Message` and removes
the draft; an exact-generation retry may return the same sent message. Draft
conflicts are `InkboxError::Api` with status `409` and
`ApiErrorDetail::Structured` detail.
Refresh on `draft_generation_conflict` and retry the same draft ID and generation
on `draft_send_in_progress`. Do not resend `draft_delivery_uncertain`; after
checking sent mail, duplicate or delete that draft instead.
Reuse one `idempotency_key` and the exact same request when retrying a logical
create after an ambiguous result. Use a new key after the original draft is sent
or deleted. Forward-only options require `forward_message_id`.

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

### API errors

Every API-origin `InkboxError` retains the optional Support Agent instructions
returned by the API. Existing error display text and structured detail remain
unchanged.

In 0.5.16, API-origin `InkboxError` struct variants gained an
`agent_support` field, and stale-tunnel 404s gained the `TunnelRemoved` variant.
When matching these variants, include `..` and read the value through
`InkboxError::agent_support()`. Exhaustive matches must also add a
`TunnelRemoved` arm or a wildcard arm.

```rust
match inkbox.get_identity("unknown") {
    Err(error) => {
        eprintln!("{error}");
        if let Some(instructions) = error.agent_support() {
            eprintln!("Support: {instructions}");
        }
    }
    Ok(identity) => println!("{}", identity.agent_handle),
}
```

### Dedicated iMessage lines

List or claim organization-owned dedicated lines through the iMessage resource:

```rust
let available = inkbox.imessages().list_numbers()?;
let number = inkbox
    .imessages()
    .claim_number("setup-support-number-v1")?;
```

A number can also be claimed and attached atomically while creating an identity:

```rust
use inkbox::identities::Unset;

let identity = inkbox.create_identity_with_contact_sharing_and_imessage_number(
    "support-bot",
    None,
    Unset::Omit,
    Some(true),
    Some(false), // opt out of automatic contact sharing
    None,
    Unset::Omit,
    None,
    None,
    None,
    Some(true),
)?;

let number = identity.imessage_number().expect("dedicated line");
assert_eq!(number.r#type, "dedicated_outbound");
```

For an existing identity, `update_with_imessage_number` can attach an already
owned number by id, move back to shared iMessage service with an explicit null,
or claim and attach a new line. Claims require a stable 1–255 character
idempotency key; reuse the same key after an ambiguous result. The response
`type` remains `"dedicated_outbound"` for compatibility and is not a capability
selector.

Dedicated identities can also start group conversations. Scalar sends
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
inbound-only. `remove_imessage_reaction` takes back a tapback this identity
sent, by reaction id; only the sender can, and a failed removal leaves it in
place rather than clearing it locally, so the call can be retried. Group read
receipts and typing indicators remain unsupported.

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

## Custom email signatures

Custom signatures are saved per mailbox and require an eligible paid plan to set or enable.
Each HTML/text field supports up to 16,384 characters. HTML is sanitized; logos
must use absolute HTTPS URLs. Updating HTML without text generates a plain-text
fallback. Omitted fields stay unchanged; null clears saved content. If saved text
is null, sending derives it from HTML when possible. Disable without deleting to
pause automatic insertion. Disabling and clearing remain available on every plan.
Signatures are inserted when mail is sent, including replies, forwards, and sent
drafts; do not append them manually. The Inkbox watermark is controlled separately.
Signed/encrypted SMTP mail cannot have a custom signature inserted; disable
automatic insertion before sending those messages.
A `.sig` file is not a standardized attachment format: read its UTF-8 text or HTML
content into the corresponding field; images and proprietary formats are not imported.

```rust,no_run
use inkbox::Inkbox;
use inkbox::mail::MailboxUpdateOptions;
use inkbox::identities::Unset;

# fn main() -> Result<(), Box<dyn std::error::Error>> {
let inkbox = Inkbox::builder("YOUR_API_KEY").build()?;
inkbox.mailboxes().update_with_options("alex@example.com", &MailboxUpdateOptions {
    signature_html: Unset::Value(Some("<b>Alex</b>".into())),
    signature_enabled: Some(true),
    ..Default::default()
})?;
// Unset::Omit leaves content unchanged; Unset::Value(None) clears it.
# Ok(())
# }
```

## Slack

```rust,no_run
use inkbox::{Inkbox, SlackConnectionStatus, SlackSendMessageOptions};
use uuid::Uuid;

let client = Inkbox::new("ApiKey_...")?;
let identity_id = Uuid::parse_str("22222222-2222-4222-8222-222222222222")?;
let connections = client.slack().list_connections(identity_id)?;
let connection = connections.connections.iter().find(|c| {
    c.workspace_id == "TEXAMPLE" && c.status == SlackConnectionStatus::Connected
}).ok_or("Connect or reauthorize the intended workspace first")?;
let action = client.slack().send_message(connection.id, &SlackSendMessageOptions {
    conversation_id: "CEXAMPLE".into(),
    text: "Hello from Inkbox".into(),
    idempotency_key: "greeting:2026-09-16".into(),
    thread_ts: None,
})?;
# Ok::<(), Box<dyn std::error::Error>>(())
```

Onboarding is a separate organization-management task, not part of normal agent usage.
`installation_available` reports readiness, not permission to create invitations.

```rust,no_run
use inkbox::Inkbox;
use uuid::Uuid;

let management_client = Inkbox::new("YOUR_ORGANIZATION_MANAGEMENT_API_KEY")?;
let identity_id = Uuid::parse_str("22222222-2222-4222-8222-222222222222")?;
let invitation = management_client.slack().create_invitation(identity_id, None)?;
// Open invitation.invitation_url in the installer's browser; keep it secret.
# Ok::<(), Box<dyn std::error::Error>>(())
```

`client.slack()` also provides `list_invitations`, `revoke_invitation`, `disconnect`,
`list_conversations`, `open_conversation`, `get_conversation`, `list_messages`,
`get_action`, `get_file`, and `download_file` (returns `Vec<u8>`). Pass
`SlackPageOptions` / `SlackMessagesOptions` for pagination. Connections, invitations,
actions, file metadata, pages, send options, and filters are public typed exports.

For webhook subscriptions use `create_with_slack_filter` and
`update_with_slack_filter`; the existing `create` / `update` signatures remain
unchanged. The update filter argument is `None` to preserve, `Some(None)` to clear,
or `Some(Some(&filter))` to replace a `SlackWebhookFilter`.

Rust Slack enums parse strictly: an unrecognized response or webhook value fails
deserialization and may require an SDK update. `Unknown` on action/operation status
means terminal uncertainty, never an arbitrary unrecognized value.

### Slack behavior

An existing identity can connect to multiple Slack workspaces. Organization management
credentials create/revoke invitations and disconnect connections; claimed identity
credentials can read and use their own connections. Installation availability is
readiness, not management permission; offer onboarding only in a management flow.
Invitation links are returned once: open the full link in a browser and treat it as a secret. The browser page handles installation.
Direct installation is also supported: `start_installation` (Python/Rust),
`startInstallation` (TypeScript), or `slack installation start` returns a short-lived
opaque authorization URL to open in a browser. Treat it as a secret; the browser
handoff establishes installation state. Workspace approval and channel permissions
still apply. Join accessible public channels or invite the agent to private channels;
Slack Connect conversations are supported when the connection has access.

`start_installation_with_return_url(identity_id, workspace_id, return_url)` accepts
an optional approved Console completion URL with the exact path `/console/slack/complete`,
no query or fragment, and at most 2048 characters. `None`, or the existing `start_installation` method,
uses the default completion page.

Conversation/history/file reads are live and scoped to the selected connection, not
an entire-workspace archive. Conversation pages default to 100 (maximum 200); message
pages default to 15 (maximum 100). Pass the returned cursor explicitly for another
page. Slack timestamp identifiers are strings, never floating-point numbers. Direct
messages accept 1..8 user IDs. Message text is 1..12000 characters; sends require a
stable 1..128-character idempotency key using letters, digits, `.`, `_`, `:`, or `-`.
Reuse a key only for the exact same operation. A different body with the same key is a
conflict. Poll an action while it is `sending`; `sent` is not a delivered/read receipt.
`unknown` is terminal uncertainty, not a promise of future reconciliation: do not
blindly resend. Inspect authorized live history before deliberately starting a new
operation. File downloads return bytes; unavailable or oversized files surface API
errors. General file uploads accept standard base64 for 1 byte..10 MiB of decoded
content (CLI: `slack file upload --file PATH`). Reactions, pins, own-message edits and
deletions, channel join/leave, and native processing status use stable keys and return
operations: poll only `in_progress`; `unknown` remains terminal uncertainty. Send
keys and utility-operation keys have independent per-connection namespaces. Utility
operations emit no outcome webhook: inspect the returned status and operation lookup,
not send-outcome events. Native processing support depends on the workspace and may fail explicitly; no reaction is
used as a fallback. Inspect capabilities for missing scopes before requesting an upgrade.
Disconnect removes Inkbox authority, not the workspace's Slack app installation.

Retained history is separate from live reads and webhook diagnostics. Capture is on
by default for messages observed in conversations the connection can access, with no
time-based retention limit. This is not an automatic whole-workspace or historical
copy. Organization management can disable capture, restrict conversation selection,
set retention, or purge. Updating archive settings replaces all fields: omitted
retention resets to no time limit, and omitted/empty conversation selection resets
to all conversations. Read current settings and restate values to preserve them.
Unlike archive selection, webhook selectors use null for all and reject empty arrays.
Archive messages/search return retained records only. Backfill queues bounded imports
and reports coverage; a completed channel page does not prove every thread is complete. `restart=true`
restarts a completed/failed import. Purge disables capture and queues retained-content
deletion. Archive reads still require current connection/conversation access.
Use the live exact-message permalink method when a Slack link is needed.
Live message context is a bounded window (`complete=false`), not full history.

Slack webhook envelopes use the existing signature verification and stable `id`
deduplication; delivery order is not guaranteed. All 19 event types are exported as `SlackWebhookEventType`, with
`SlackWebhookData` and `SlackWebhookPayload` types. Optional connection/conversation
selectors combine with AND; message kinds combine with OR. Kinds (`dm`, `group_dm`,
`mention`, `channel`, `thread`) affect received/updated/deleted messages only. `thread`
means any reply, not a managed thread watch. Connection-status events bypass
conversation/kind selectors but retain connection scope. A filter selector array must
be nonempty and distinct (maximum 100 IDs or 5 kinds). Null means unrestricted.
Slack subscriptions belong to the identity and reject conversation context. Omitted
filters on PATCH preserve the stored filter; explicit null clears it. Slack delivery
logs contain metadata only; historical replay is not supported. The agent runtime
owns attention rules, thread watches, and its own memory.

### Retained history and utility actions

```rust,no_run
# fn example(client: &inkbox::Inkbox, connection_id: uuid::Uuid) -> inkbox::Result<()> {
let history = client.slack().search_archived_messages(
    connection_id, "release notes",
    &inkbox::SlackArchiveSearchOptions {
        conversation_id: Some("CEXAMPLE".into()), limit: Some(20), ..Default::default()
    },
)?;
let operation = client.slack().add_reaction(
    connection_id, "CEXAMPLE", "1780000000.000001", "eyes", "review:release:1",
)?;
// Capture is on by default for observed messages. Never repeat an unknown outcome.
# Ok(())
# }
```

Additional methods on `client.slack()` include users/members, exact message context
and permalinks, reactions/pins, own-message update/delete, join/leave, native processing
status, general `upload_file`, and `get_operation`. Archive settings, listing/search,
backfill, coverage, and purge use exported `SlackArchive*` response and option types.

## License

MIT

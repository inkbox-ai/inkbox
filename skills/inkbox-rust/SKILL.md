---
name: inkbox-rust
description: Use when writing Rust code that depends on the `inkbox` crate, uses `cargo add inkbox`, or when adding email, mailbox imports, phone, text/SMS, iMessage, A2A task/message history, contacts, notes, contact rules, vault, tunnels, mailbox storage, mail clients (IMAP/SMTP), or agent identity features using the Inkbox Rust SDK.
user-invocable: false
---

# Inkbox Rust SDK

API-first communication infrastructure for AI agents — email, phone, encrypted vault, and identities.

## Install & Init

```bash
cargo add inkbox
```

Or in `Cargo.toml`:

```toml
[dependencies]
inkbox = "0.5"
```

**Toolchain:** the crate's manifest declares `rust-version = "1.74"`, but that is not achievable with a fresh dependency resolution today — the transitive graph pulls edition-2024 manifests (which cargo < 1.85 cannot even parse) and `icu_*` 2.2, which needs 1.86. **Build with Rust ≥ 1.86**, or commit a `Cargo.lock` pinned to older releases if you must support an earlier toolchain. Verify an MSRV claim with `cargo +<version> build` after deleting `Cargo.lock`; a green build on current stable proves nothing about it.

The public surface is **blocking** (built on `reqwest::blocking`), matching the synchronous Python/TS APIs — there is no async runtime to set up and nothing to `.await`:

```rust
use inkbox::Inkbox;

// The client is handed out as an `Arc<Inkbox>` — the per-identity facade and
// the tunnels resource hold a back-reference to it.
let inkbox = Inkbox::new("ApiKey_...")?;
```

Builder options (`base_url`, `timeout_secs`, `vault_key`, `user_agent_prefix`):

```rust
let inkbox = Inkbox::builder("ApiKey_...")
    .base_url("https://inkbox.ai")  // self-hosting / tests (HTTPS, or localhost over HTTP)
    .timeout_secs(30.0)
    .vault_key("my-Vault-key-01!")  // unlock the vault at construction
    .build()?;

// Or resolve api_key / base_url / vault_key from INKBOX_API_KEY /
// INKBOX_BASE_URL / INKBOX_VAULT_KEY, then ~/.inkbox/config (`key = value`
// lines). Handy for background/agent processes that don't inherit the shell's
// env. Errors if no API key is found.
let inkbox = Inkbox::from_env()?;
```

Every call returns `inkbox::Result<T>` — an alias for `Result<T, inkbox::InkboxError>`. `fn main() -> inkbox::Result<()>` plus `?` is the idiomatic shape for a small agent.

## Core Model

```
Arc<Inkbox> (org-level client)
├── .create_identity(handle)          → Result<AgentIdentity>
├── .create_identity_with(...)        → Result<AgentIdentity>  (all options, positional)
├── .get_identity(handle)             → Result<AgentIdentity>
├── .list_identities()                → Result<Vec<AgentIdentitySummary>>
├── .mailboxes()                      → &MailboxesResource      (.imports())
├── .messages() / .threads() / .domains()
├── .calls() / .phone_numbers() / .texts() / .incoming_call_action() / .hosted_agent()
├── .imessages()                      → &IMessagesResource
├── .imessage_contact_rules()         → &IMessageContactRulesResource
├── .mail_identity_contact_rules()    → &MailIdentityContactRulesResource   (keyed by agent_handle)
├── .phone_identity_contact_rules()   → &PhoneIdentityContactRulesResource  (keyed by agent_handle)
├── .signing_keys()                   → &SigningKeysResource  (per-identity: create_or_rotate/get_status)
├── .mail_contact_rules()             → &MailContactRulesResource    (DEPRECATED — per-mailbox)
├── .phone_contact_rules()            → &PhoneContactRulesResource   (DEPRECATED — per-number)
├── .sms_opt_ins()                    → &SmsOptInsResource
├── .contacts()                       → &ContactsResource   (.facts() .correspondence() .access() .vcards())
├── .notes()                          → &NotesResource      (.access())
├── .vault()                          → &VaultResource
├── .a2a()                            → &A2AResource
├── .api_keys() / .identities() / .tunnels()
├── .webhooks()                       → WebhooksNamespace   (.subscriptions() .deliveries())
├── .whoami()                         → Result<WhoamiResponse>
└── .create_signing_key()             → Result<SigningKey>  (DEPRECATED — org-level; use .signing_keys())

AgentIdentity (identity-scoped facade)
├── .agent_handle() / .id() / .email_address()
├── .mailbox() / .phone_number() / .imessage_number() / .tunnel()  → Option<...>
├── .mail_filter_mode() / .phone_filter_mode() / .imessage_filter_mode() → FilterMode
├── .credentials()          → Result<Credentials>  (requires vault unlocked)
├── .list_mail_contact_rules() / .create_mail_contact_rule(...) / .get_/.update_/.delete_
├── .list_phone_contact_rules() / .create_phone_contact_rule(...) / ...  (requires phone number)
├── .get_signing_key_status() / .create_signing_key()
├── mail methods            (requires assigned mailbox)
├── phone methods           (requires assigned phone number)
└── text methods            (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is returned.

Rust has no keyword arguments, so the SDK takes options **positionally**. Pass `None` for anything you want defaulted, and use the `Unset<T>` sentinel where a field is tri-state: `Unset::Omit` defers to the server, `Unset::Value(None)` sends an explicit JSON `null` (clears the column), `Unset::Value(Some(v))` sets it.

## Agent Signup

For the full agent self-signup flow (register, verify, check status, restrictions, and direct API examples), read the shared reference:

> **See:** `skills/inkbox-agent-self-signup/SKILL.md`

Rust SDK methods (all associated functions on `Inkbox`, no client needed): `Inkbox::signup(...)`, `Inkbox::signup_with(...)`, `Inkbox::verify_signup(api_key, code, ...)`, `Inkbox::resend_signup_verification(api_key, ...)`, `Inkbox::get_signup_status(api_key, ...)`.

```rust
use inkbox::agent_signup::AgentSignupOptions;
use inkbox::Inkbox;

// Positional form: human_email, note_to_human, display_name, agent_handle,
// email_local_part, harness, base_url, timeout_secs.
let result = Inkbox::signup(
    "john@example.com",
    "Hey John, this is your agent signing up!",
    Some("My Agent"),
    Some("my-agent"),
    Some("my.agent"),
    None,
    None,
    None,
)?;
let api_key = result.api_key;   // save this — shown only once
println!("{}", result.message); // authoritative delivery/acceptance outcome

// Additive options (including invitation-assisted signup) go through signup_with.
let result = Inkbox::signup_with(
    "john@example.com",
    "Hey John, this is your agent signing up!",
    AgentSignupOptions {
        display_name: Some("My Agent"),
        agent_handle: Some("my-agent"),
        harness: Some("claude-code"),
        invitation_token: std::env::var("INKBOX_A2A_INVITATION").ok().as_deref(),
        ..Default::default()
    },
    None,
    None,
)?;

// Verify only when signup did not already accept and claim the invitation.
let already_claimed = result
    .invitation
    .as_ref()
    .is_some_and(|i| i.status == "accepted")
    || result.claim_status == "agent_claimed";
if !already_claimed {
    Inkbox::verify_signup(&result.api_key, "483921", None, None)?;
}
```

`AgentSignupOptions::invitation_token` accepts an exact-origin share URL or a raw token; only the token is sent. `inkbox::extract_a2a_invitation_token` (and `..._with_base_url` for a non-production site) performs the same strict local normalization. Review an invitation before signup with `Inkbox::preview_a2a_invitation(invitation, None, None)` — no API key required.

## Identities

```rust
use inkbox::identities::Unset;

let identity = inkbox.create_identity("sales-agent")?;
let identity = inkbox.get_identity("sales-agent")?;
let identities = inkbox.list_identities()?;   // Vec<AgentIdentitySummary>

// Rename. Positional: new_handle, display_name, description, imessage_enabled,
// imessage_filter_mode, mail_filter_mode, phone_filter_mode.
identity.update(Some("new-name"), Unset::Omit, Unset::Omit, None, None, None, None)?;

identity.refresh()?;   // re-fetch from API, updates cached channels
identity.delete()?;    // cascades: mailbox + tunnel + phone-number release
```

`update` / `refresh` mutate the facade's cached channel data in place and return `Result<()>`, so read `identity.email_address()` / `identity.mailbox()` again afterwards rather than binding the return value.

Full create options are positional on `create_identity_with`: `agent_handle`, `display_name`, `description`, `imessage_enabled`, `email_local_part`, `sending_domain`, `tunnel`, `phone_number`, `vault_secret_ids`.

```rust
use inkbox::identities::{IdentityPhoneNumberCreateOptions, IdentityTunnelCreateOptions, Unset};

let identity = inkbox.create_identity_with(
    "sales-agent",
    Some("Sales Agent"),
    Unset::Value(Some("Handles inbound sales mail".to_string())),
    Some(true),                          // imessage_enabled
    Some("sales"),                       // email_local_part
    Unset::Value(Some("mail.acme.com".to_string())),   // sending_domain
    Some(&IdentityTunnelCreateOptions { tls_mode: Some("passthrough".into()) }),
    Some(&IdentityPhoneNumberCreateOptions { state: Some("NY".into()), ..Default::default() }),
    None,                                // vault_secret_ids
)?;
```

## Channel Management

```rust
// Identity is created with a mailbox AND tunnel atomically — both are on the response
println!("{:?}", identity.email_address());          // e.g. Some("sales-agent@inkboxmail.com")
println!("{:?}", identity.tunnel().map(|t| t.public_host));  // e.g. "sales-agent.inkboxwire.com"

// Phone numbers are still opt-in
let phone = identity.provision_phone_number("local", Some("NY"))?;  // local only; toll_free is rejected (422)
println!("{}", phone.number);                        // e.g. "+12125551234"

// Release the phone number (vendor + local)
identity.release_phone_number()?;
```

Mailboxes and tunnels are not separately linkable — they are 1:1 with their owning identity. Use `inkbox.create_identity(...)` to provision both; use `identity.delete()` to remove both (cascade).

## Mail

### Import historical mail

```rust
use std::time::Duration;
use inkbox::mail::MailImportFormat;

let imports = inkbox.mailboxes().imports();
let created = imports.create(
    "agent@inkboxmail.com",
    MailImportFormat::Auto,
    Some(&["old@example.com".to_string()]),
    true,                                  // mark_as_read
)?;
imports.upload(&created.upload, "./archive.mbox")?;
imports.start("agent@inkboxmail.com", &created.job.id.to_string())?;
let job = imports.wait(
    "agent@inkboxmail.com",
    &created.job.id.to_string(),
    Some(Duration::from_secs(3600)),       // timeout
    Some(Duration::from_secs(5)),          // poll interval
)?;
```

Formats: `Auto`, `Mbox`, `Eml`, `Zip`. A ZIP may hold `.eml` and/or `.mbox` files (a Gmail Takeout ZIP imports as-is); other entries, including nested archives, are ignored. `wait` returns all terminal states; failure/cancellation are job results, not transport errors. A local wall-clock timeout surfaces as `InkboxError::Timeout` and does **not** cancel the job. Counters are cumulative and never go backwards, so a stalled counter is a signal, not normal churn; counters may still remain unchanged while a slow message is processed, and they must not be treated as a percentage. Jobs run one at a time per organization and share overall import capacity, so a long `queued` stretch is normal; do not cancel and recreate. Unsafe imported content may be rejected in `messages_rejected_unsafe`.

Upload targets expire after 5 minutes: `refresh_upload_target(email, job_id)` and upload again, or `cancel` the job so it does not hold the mailbox for 24 hours. Limits: 1 GiB per upload, 50 MiB per message, 100,000 messages and 20 original addresses per job, 65,000 entries per ZIP, 20 jobs per organization per 24 hours (`InkboxError::MailImportQuotaExceeded` carries the `Retry-After` value), and one in-flight import per mailbox.

### Send

Positional: `to`, `subject`, `body_text`, `body_html`, `cc`, `bcc`, `in_reply_to_message_id`, `attachments`, `track_opens`.

```rust
use inkbox::mail::Attachment;

let sent = identity.send_email(
    &["user@example.com".to_string()],
    "Hello",
    Some("Hi there!"),                 // body_text
    Some("<p>Hi there!</p>"),          // body_html
    None,                              // cc
    None,                              // bcc
    None,                              // in_reply_to_message_id — set for threaded replies
    Some(&[
        Attachment {
            filename: "report.pdf".into(),
            content_type: "application/pdf".into(),
            content_base64: "<base64>".into(),
            content_id: None,
        },
        Attachment {
            filename: "chart.png".into(),        // inline image: set content_id and reference
            content_type: "image/png".into(),    // it from body_html as <img src="cid:chart">.
            content_base64: "<base64>".into(),   // needs body_html + image/*, unique per send;
            content_id: Some("chart".into()),    // not on forwards. Not counted in has_attachments.
        },
    ]),
    true,                              // track_opens — embed a tracking pixel
)?;
// track_opens tracks sends only when an HTML body is present. Opens surface
// on the returned Message as sent.first_opened_at / sent.open_count (an upper
// bound — image proxies prefetch pixels; pixels can also raise spam scores).
//
// send_email / reply_all_email / forward_email all return
// InkboxError::StorageLimitExceeded (402) when the mailbox is at its storage
// cap — see "Storage cap (402)" below.
```

`reply_all_email(message_id, subject, body_text, body_html, attachments, reply_to)` and `forward_email(message_id, to, cc, bcc, mode, subject, body_text, body_html, additional_attachments, include_original_attachments, reply_to, track_opens)` follow the same positional style. `ForwardMode::Inline` renders the original below a preamble; `ForwardMode::Wrapped` attaches the raw MIME as a `message/rfc822` part.

### Read

Unlike the Python/TS `iter_emails` generators, the Rust `iter_emails` **drains every page eagerly** and returns a `Vec<Message>`. Pagination is still handled for you; the memory profile differs.

```rust
use inkbox::mail::MessageDirection;

// All messages — every page fetched, newest first
for msg in identity.iter_emails(None, None)? {
    println!("{:?} {} {}", msg.subject, msg.from_address, msg.is_read);
}

// Filter by direction, and set an explicit page size
for msg in identity.iter_emails(Some(100), Some(MessageDirection::Inbound))? {
    // ...
}

// Unread only (client-side filtered)
for msg in identity.iter_unread_emails(None, None)? {
    // ...
}

// Mark as read
let ids: Vec<String> = identity
    .iter_unread_emails(None, None)?
    .iter()
    .map(|m| m.id.to_string())
    .collect();
identity.mark_emails_read(&ids)?;
identity.mark_emails_unread(&ids)?;   // batch counterpart
// Note: fetching a single inbound message by id (identity.get_message /
// inkbox.messages().get) with an API key marks it read server-side; iterating
// does not, so mark_emails_read is the way to clear unread for list-only
// workflows. is_read (agent consumed via API) is distinct from
// first_opened_at (recipient's mail client loaded the tracking pixel).

// Full message body
let detail = identity.get_message(&msg.id.to_string())?;
println!("{:?}", detail.body_text);
// Base Message fields live under `detail.message` (serde-flattened):
println!("{:?}", detail.message.subject);

// Get full thread (oldest-first)
if let Some(thread_id) = msg.thread_id {
    let thread = identity.get_thread(&thread_id.to_string())?;
    for m in &thread.messages {
        println!("[{}] {:?}", m.from_address, m.subject);
    }
}
```

Date-bounded variants exist alongside the plain listers — `iter_emails_filtered`, `iter_unread_emails_filtered`, `list_calls_filtered`, `list_texts_filtered`, `list_imessages_filtered`, … — each taking a `&DateRangeFilter`:

```rust
use inkbox::DateRangeFilter;

let filter = DateRangeFilter {
    start_datetime: Some("2026-07-01".into()),
    end_datetime: Some("2026-07-31".into()),
    tz: Some("America/New_York".into()),
    ..Default::default()
};
let july = identity.iter_emails_filtered(None, None, &filter)?;
```

The server owns resolution: bare dates resolve to calendar days in `tz` (default UTC) with `end_datetime` whole-day inclusive; values with an explicit `Z`/offset are exact instants and ignore `tz`.

### Thread Folders

Threads carry a `folder` field: `Inbox`, `Spam`, `Archive`, or `Blocked` (server-assigned, never client-set).

```rust
use inkbox::mail::ThreadFolder;
// thread.folder / thread_detail.thread.folder is always one of the four values above.
```

Low-level folder listing / per-thread updates (`list(email, Some(folder), page_size)`, `list_folders(email)`, `update(email, thread_id, Some(folder))`) live on `inkbox.threads()`. Passing `ThreadFolder::Blocked` to `update` errors before the HTTP call.

### Storage cap (402)

Every mailbox has a plan storage cap. **All three send paths** — `send_email`, `reply_all_email`, and `forward_email` (and the `inkbox.messages()` equivalents) — return `InkboxError::StorageLimitExceeded` (HTTP 402) when the send would push the mailbox over it.

```rust
use inkbox::InkboxError;

match identity.send_email(
    &["user@example.com".to_string()],
    "Hi",
    Some("…"),
    None, None, None, None, None, false,
) {
    Ok(sent) => println!("{}", sent.id),
    Err(InkboxError::StorageLimitExceeded { message, upgrade_url, limit_bytes, .. }) => {
        println!("{message}");        // human sentence, includes the limit
        println!("{limit_bytes:?}");  // e.g. Some(2147483648) (2 GiB)
        println!("{upgrade_url}");    // console billing page
        // Free space — reclaim is immediate — or upgrade the plan:
        let email = identity.email_address().unwrap();
        inkbox.messages().delete(&email, "<message-uuid>")?;
        inkbox.threads().delete(&email, "<thread-uuid>")?;
    }
    Err(e) => return Err(e),
}
```

Read usage off the mailbox (`inkbox.mailboxes().get(...)`): `storage_used_bytes` and `storage_limit_bytes` (`None` = the server resolved no cap). The caps are **binary** — 2 GiB is `2 * 1024u64.pow(3)` = 2,147,483,648 bytes, so divide by 1024 and label GiB/MiB, never GB.

**Free plan:** a footer is appended to the **stored** body of outgoing mail, so `inkbox.messages().get(...)` does not return byte-for-byte what you sent (a body-less send comes back with the footer as its body). Don't assert `sent_body == fetched_body` on a Free plan.

## Mail Clients (IMAP/SMTP)

An inbox can be attached to a regular mail client (Thunderbird, Apple Mail, mutt, …) with the API key you already have — there is no separate credential to create and **no SDK call involved**; the gateway speaks IMAP and SMTP, not HTTP.

| Setting | Value |
|---|---|
| IMAP host | `imap.inkboxmail.com` |
| IMAP port | `993` (IMAPS / implicit TLS) |
| SMTP host | `smtp.inkboxmail.com` |
| SMTP port | `465` (SMTPS / implicit TLS) or `587` (STARTTLS) |
| Username | the inbox address (e.g. `sales-agent@inkboxmail.com`) |
| Password | an **identity-scoped** API key (`ApiKey_...`) |

The password is the same agent-scoped key an identity-scoped `Inkbox::new(...)` client authenticates with; mint one with `inkbox.api_keys().create(label, description, Some(scoped_identity_id))`. Admin-scoped keys are rejected — one key maps to exactly one mailbox. Revoking the key revokes mail-client access.

Constraints that bite:

- **`From` must be the authenticated inbox address**, and exactly one address — aliases / "send as" are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over SMTP** — the required footer can't be injected without breaking the signature, so the send is refused. Send unsigned, or upgrade.
- Leave "save a copy of sent messages" **on** — Inkbox recognizes the client's copy as the message it already stored, so you get one Sent entry, charged against the storage cap once.

Full walkthrough: https://inkbox.ai/docs/capabilities/email/mail-clients

## Phone

```rust
use inkbox::phone::{CallOrigin, HostedAgentAuthorityMode, IncomingCallAction};

// Place outbound call — stream audio via WebSocket
let placed = identity.place_call(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    Some("wss://your-agent.example.com/ws"),
)?;
println!("{}", placed.call.status);
println!("{:?}", placed.rate_limit.as_ref().map(|r| r.calls_remaining));
// CallOrigin also has SharedImessageNumber / DedicatedImessageNumber — call
// over an existing iMessage connection without a dedicated number.

// Or let Inkbox Voice AI drive the call — no WebSocket, no code. `reason` is
// the agent's task brief and is required on this path.
let hosted = identity.place_hosted_call(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    "Confirm tomorrow's 3pm appointment; reschedule if needed.",
)?;
println!("{} {:?}", hosted.call.mode, hosted.call.reason);
// where Voice AI isn't available (or is at capacity), the server's
// 503 (hosted_agent_unavailable / hosted_agent_at_capacity) surfaces verbatim.

// List calls (offset pagination). Every call carries mode / reason plus
// post_call_action_items — open items Voice AI recorded
// (seq-ascending; empty for client_websocket calls)
let calls = identity.list_calls(10, 0, None)?;
for c in &calls {
    println!("{} {} {} {} {}", c.id, c.direction, c.remote_phone_number, c.status, c.mode);
    for item in &c.post_call_action_items {
        println!("  [{}] {}: {:?}", item.seq, item.action, item.details);
    }
}

// Transcript segments (ordered by seq)
for t in identity.list_transcripts(&calls[0].id.to_string())? {
    println!("[{}] {}", t.party, t.text);   // party: "local" or "remote"
}

// Hang up a live call from outside it (teardown confirms asynchronously,
// so the returned call can still show its live status; already-ended
// calls surface the server's 409)
let hung_up = identity.hangup_call(&calls[0].id.to_string())?;

// Per-identity Inkbox Voice AI config: voice / model / instructions, all
// nullable (None means the server default). set_hosted_agent_config is a
// FULL REPLACE — a None field resets to the server default.
let cfg = identity.hosted_agent_config()?;
identity.set_hosted_agent_config(None, None, Some("Be brief and friendly."))?;

// Inbound-call handling: AutoAccept | AutoReject | Webhook | HostedAgent.
// HostedAgent is the only action needing no URL — Voice AI answers.
identity.set_incoming_call_action(IncomingCallAction::HostedAgent, None, None)?;
println!("{:?}", identity.get_incoming_call_action()?.incoming_call_action);
```

### Voice AI authority

Voice AI calls inherit the identity's saved authority when no per-call override is supplied. An explicit `ContactScoped` override always downscopes the call. An explicit `Yolo` override requires an admin credential unless the saved authority is already `Yolo`. Changing the saved default requires an admin API key:

```rust
use inkbox::phone::{CallOrigin, HostedAgentAuthorityMode};

identity.set_hosted_agent_authority_mode(HostedAgentAuthorityMode::Yolo)?;

let scoped = identity.place_hosted_call_with_authority(
    "+15551234567",
    CallOrigin::DedicatedNumber,
    "Confirm only this caller's appointment.",
    HostedAgentAuthorityMode::ContactScoped,
)?;
```

`place_call_with_options` / `place_hosted_call_with_options` take a `&CallPlacementOptions` / `&HostedCallPlacementOptions` for `voicemail_detection` (and, on the hosted form, `authority_mode`). Tool calls Voice AI made are readable with `identity.list_tool_invocations(call_id, limit, offset)`.

## Text Messages (SMS/MMS)

**Outbound SMS limits and gates (current):**

- Allowed only from **local** numbers, not toll-free.
- **100 recipient sends per phone number per rolling 24h.** A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- New local numbers need **~10-15 min** for 10DLC carrier propagation. `identity.phone_number().unwrap().sms_status` is `SmsStatus::Pending` until ready; sends in this window return `409 sender_sms_pending`.
- Recipient must have texted **`START`** to any number in the org. Unknown → `403 recipient_not_opted_in`. `STOP` → `403 recipient_opted_out`. Inspect / override consent state via `inkbox.sms_opt_ins()` (see below).
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands/campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

`send_text` is positional: `to`, `conversation_id`, `text`, `media_urls`. Recipients are a `TextRecipients` enum — `One(..)` for 1:1, `Many(..)` for group MMS.

```rust
use inkbox::phone::resources::texts::TextRecipients;

// Send SMS/MMS from this identity's phone number.
// Returns a queued TextMessage; final delivery state arrives via any webhook
// subscription on the sender's phone number whose event_types include the
// text.* lifecycle events.
let sent = identity.send_text(
    Some(TextRecipients::One("+15551234567".into())),
    None,
    Some("Hello from Inkbox"),
    None,
)?;
println!("{} {:?}", sent.id, sent.delivery_status);   // Some(Queued)

// Group MMS beta: pass Many(..) plus optional media URLs.
let group = identity.send_text(
    Some(TextRecipients::Many(vec![
        "+15551234567".into(),
        "+15557654321".into(),
    ])),
    None,
    Some("Hello group"),
    Some(&["https://example.com/photo.jpg".to_string()]),
)?;
println!("{:?} {:?}", group.conversation_id, group.recipients);

// Reply to an existing conversation by UUID. Do not pass `to` with this form.
let conversation_id = group.conversation_id.unwrap().to_string();
let reply = identity.send_text(
    None,
    Some(&conversation_id),
    Some("Following up in the same conversation."),
    None,
)?;

// List text messages (offset pagination): limit, offset, is_read, is_blocked
for t in identity.list_texts(20, 0, None, None)? {
    println!("{} {} {:?} {:?} {}", t.id, t.direction, t.remote_phone_number, t.text, t.is_read);
}

// Filter by read state
let unread = identity.list_texts(20, 0, Some(false), None)?;

// Get a single text message
let text = identity.get_text("text-uuid")?;
println!("{}", text.r#type);   // "sms" or "mms"
if let Some(media) = &text.media {   // MMS media attachments (temporary signed URLs)
    for m in media {
        println!("{} {} {}", m.content_type, m.size, m.url);
    }
}

// List one-to-one conversation summaries; opt into groups explicitly.
for c in identity.list_text_conversations(20, 0, None, true)? {
    println!("{:?} {:?} {} {:?}", c.id, c.participants, c.latest_has_media, c.latest_text);
}

// Get messages in a specific conversation by remote number or conversation UUID.
let msgs = identity.get_text_conversation("+15551234567", 50, 0)?;

// Mark a text as read (identity convenience method)
identity.mark_text_read("text-uuid")?;

// Mark all messages in a conversation as read
let read_result = identity.mark_text_conversation_read("+15551234567")?;
println!("{}", read_result.updated_count);

// Admin-only: search and update live on the org-level resource, keyed by
// phone_number_id.
let phone_id = identity.phone_number().unwrap().id.to_string();
let results = inkbox.texts().search(&phone_id, "invoice", 20, None)?;
inkbox.texts().update(&phone_id, "text-uuid", Some(true))?;
```

## iMessage

iMessage can use shared service or an organization-owned dedicated number. Shared service and dedicated inbound require the recipient to message first; dedicated outbound can initiate one-to-one and group conversations, subject to server-side policy checks.

Discover the router (triage) line at runtime — it can change, so never hardcode it:

```rust
let triage = inkbox.imessages().get_triage_number()?;
println!("{} {}", triage.number, triage.connect_command);  // "+1646...", "connect @your-handle"
// Humans connect by texting that command to that number.
```

Reachability is **opt-in per identity** (`imessage_enabled`, default `false`):

```rust
use inkbox::identities::Unset;

// imessage_enabled is the 4th positional argument on create_identity_with.
let identity = inkbox.create_identity_with(
    "my-agent", None, Unset::Omit, Some(true), None, Unset::Omit, None, None, None,
)?;
// or toggle later
identity.update(None, Unset::Omit, Unset::Omit, Some(true), None, None, None)?;
// admin-only: flip contact-rule mode (default "blacklist")
identity.update(None, Unset::Omit, Unset::Omit, None, Some("whitelist"), None, None)?;
println!("{} {:?}", identity.imessage_enabled(), identity.imessage_filter_mode());
```

### Dedicated numbers

```rust
use inkbox::imessage::IMessageNumberType;

let available = inkbox.imessages().list_numbers()?;
let number = inkbox
    .imessages()
    .claim_number(IMessageNumberType::DedicatedOutbound, "setup-support-number-v1")?;
assert!(number.can_start_conversation());
```

A number can be claimed and attached atomically at identity creation with `create_identity_with_imessage_number(...)` (same positional args plus a trailing `Option<IMessageNumberType>`), or attached to an existing identity with `identity.update_with_imessage_number(...)` — which also accepts `imessage_number_id: Unset<Uuid>` (`Unset::Value(None)` moves back to shared service). Claims require a stable 1–255 character idempotency key; reuse the same key after an ambiguous result (`InkboxError::IdempotencyKeyReused` on a mismatched reuse). Dedicated outbound numbers are the only type that can start a new conversation.

### Messaging

Identity convenience methods; `inkbox.imessages()` is the org-level resource with the same operations plus `agent_identity_id` / `is_blocked` filters.

```rust
use inkbox::imessage::{IMessageReactionType, IMessageSendStyle};

// Send to a connected recipient, or reply into a conversation by UUID.
// Positional: to, conversation_id, text, media_urls, send_style.
let sent = identity.send_imessage(
    Some("+15551234567"), None, Some("Hello over iMessage"), None, None,
)?;

// Groups need a dedicated outbound number; 2–8 distinct recipients.
let group = identity.send_imessage_group(
    &["+15551234567".to_string(), "+15557654321".to_string()],
    Some("Hello group"),
    Some(&["https://example.com/group-photo.jpg".to_string()]),
    Some(IMessageSendStyle::Confetti),
)?;
let group_reply = identity.send_imessage(
    None,
    Some(&group.conversation_id),
    Some("Group follow-up"),
    Some(&["https://example.com/follow-up.jpg".to_string()]),
    Some(IMessageSendStyle::Lasers),
)?;
println!("{:?} {:?}", sent.service, sent.status);  // IMessage, Some(Queued)

// List messages / conversations. The plain listers exclude groups for
// backwards compatibility; the *_with_groups variants take include_groups.
let msgs = identity.list_imessages_with_groups(None, 20, 0, Some(false), None, true)?;
let convos = identity.list_imessage_conversations_with_groups(20, 0, None, true)?;
let convo = identity.get_imessage_conversation(&sent.conversation_id)?;
// assignment_status tells you whether the recipient is still connected:
// anything other than Active means sends/reactions will be refused
// until they reconnect through triage.
println!("{:?}", convo.assignment_status);
// Group rows have nullable assignment/remote fields and a best-known participant
// snapshot. group_creation_status is Creating, NotCreated, or Ready. A rejected
// initial creation keeps the same conversation; send again by conversation_id to
// retry, and success changes it to Ready.
// Group creation and conversation_id replies accept the same 13
// IMessageSendStyle values as one-to-one sends, with or without the media URL.

// Who is actively connected to this identity right now (paginated)?
for a in identity.list_imessage_assignments(20, 0)? {
    println!("{} {:?} {}", a.remote_number, a.status, a.created_at);
}

// Tapbacks target inbound one-to-one or group messages by message id. Sends
// accept seven named reactions (Love, Like, Dislike, Laugh, Emphasize,
// Question, Eyes); inbound can also be Custom with the literal emoji in
// custom_emoji. Arbitrary custom emoji are not sendable. part_index is 0 for
// a single-part message.
identity.send_imessage_reaction(&msgs[0].id, IMessageReactionType::Like, 0)?;

// Live tapbacks come back on message reads, oldest first.
for r in msgs[0].reactions.iter().flatten() {
    println!("{} {:?} {:?}", r.direction, r.reaction, r.custom_emoji);
}

// Read receipts + typing indicator are one-to-one only; groups return 409.
identity.mark_imessage_conversation_read(&sent.conversation_id)?;
identity.send_imessage_typing(&sent.conversation_id)?;

// Media: upload bytes (max 10 MiB), then send the returned URL (one per message)
let bytes = std::fs::read("photo.jpg")?;
let upload = identity.upload_imessage_media(bytes, "photo.jpg", Some("image/jpeg"))?;
identity.send_imessage(
    Some("+15551234567"), None, None, Some(&[upload.media_url]), None,
)?;
```

Contact rules are scoped to the **identity** (not a phone number) because pool numbers are shared infrastructure:

```rust
use inkbox::imessage::{IMessageRuleAction, IMessageRuleMatchType};

let rule = inkbox.imessage_contact_rules().create(
    "my-agent",
    IMessageRuleAction::Block,
    "+15559999999",
    IMessageRuleMatchType::ExactNumber,
)?;
let rules = inkbox.imessage_contact_rules().list("my-agent", None, None, None, None)?;
inkbox.imessage_contact_rules().update("my-agent", &rule.id.to_string(), IMessageRuleAction::Allow)?;  // admin-only
inkbox.imessage_contact_rules().delete("my-agent", &rule.id.to_string())?;                             // admin-only
let all_rules = inkbox.imessage_contact_rules().list_all(None, None, None, None, None)?;               // admin-only, org-wide
```

Inbound messages and reactions arrive via **identity-owned** webhook subscriptions — see Webhooks below.

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The registry is updated automatically when recipients text `START` / `STOP` to any of your numbers (`source: "sms"`). Reads are admin-only; writes are admin-only **and** require your org to be on its own active, customer-managed 10DLC campaign (Inkbox-default-campaign orgs share consent state and get `409 customer_campaign_required` on writes — `source: "api"` writes record an audit event).

```rust
use inkbox::phone::SmsOptInStatus;

// List your org's consent rows, newest-updated first (server caps limit at 200)
let rows = inkbox.sms_opt_ins().list(None, Some(50), None)?;
let opted_out = inkbox.sms_opt_ins().list(Some(SmsOptInStatus::OptedOut), None, None)?;

// Look up one recipient — 404 → InkboxError::Api if no row exists
let row = inkbox.sms_opt_ins().get("+15551234567")?;
println!("{:?} {:?} {:?} {:?}", row.status, row.source, row.opted_in_at, row.opted_out_at);

// Programmatic writes (customer-managed 10DLC campaign only)
inkbox.sms_opt_ins().opt_in("+15551234567")?;
inkbox.sms_opt_ins().opt_out("+15551234567")?;
```

## Agent-to-Agent (A2A)

Rust exposes **identity-scoped A2A task, context, and message history**, the directories, and the invitation lifecycle. Receiver configuration (public discoverability, egress, contact rules, advertised skills) and the standard outbound protocol client are currently available only in the Python and TypeScript SDKs.

**Invitations:** an admin-scoped API key uses `inkbox.a2a().create_invitation(...)`, `.list_invitations(...)`, `.get_invitation(id)`, and `.revoke_invitation(id)`. A claimed agent-scoped key uses `.accept_invitation(invitation)`. The value may be an exact-origin share URL or raw token; `inkbox::extract_a2a_invitation_token()` performs the same strict local normalization. Raw and extracted tokens must match `a2ai_` followed by 43 URL-safe characters, and share links require HTTPS except for configured `localhost`/`127.0.0.1` URLs. Signup accepts the same input and returns the optional `invitation` summary. Do not retry create or accept automatically.

An identity can inspect work it received, work it requested, or both. Omit `direction` on `a2a_tasks` for the receiver inbox; `a2a_sent_tasks` is the outbound-only alias.

```rust
use inkbox::a2a::{
    A2AContextListOptions, A2ADirectoryListOptions, A2AHistoryDirection,
    A2AMessageListOptions, A2AMessageRole, A2ATaskListOptions,
};

let directory = inkbox.a2a().public_directory(&A2ADirectoryListOptions {
    q: Some("research".into()),
    limit: Some(25),
    ..Default::default()
})?;
let org_directory = inkbox.a2a().organization_directory(&A2ADirectoryListOptions {
    q: Some("support".into()),
    ..Default::default()
})?;
for item in &directory.items {
    println!("{} {:?}", item.card_url, item.visibility);
}

let page = identity.a2a_tasks(&A2ATaskListOptions {
    direction: Some(A2AHistoryDirection::Both),
    requester_handle: Some("coordinator".into()),
    worker_handle: Some("researcher".into()),
    state: Some("working".into()),
    q: Some("quarterly report".into()),
    since: Some("2026-07-01T00:00:00Z".into()),
    limit: Some(25),
    ..Default::default()
})?;
for task in &page.items {
    println!("{} {}", task.id, task.state);
}
println!("{:?}", page.next_cursor);   // opaque; pass back as `cursor` with the same filters

let messages = identity.a2a_messages(&A2AMessageListOptions {
    direction: Some(A2AHistoryDirection::Outbound),
    worker_handle: Some("researcher".into()),
    role: Some(A2AMessageRole::Agent),
    q: Some("revenue".into()),
    ..Default::default()
})?;
for message in &messages.items {
    println!("{} {} {} {:?}", message.task_id, message.context_id, message.task_state, message.parts);
}

let contexts = identity.a2a_contexts(&A2AContextListOptions {
    direction: Some(A2AHistoryDirection::Both),
    ..Default::default()
})?;
for context in &contexts.items {
    println!("{} {}", context.name, context.id);
}

identity.a2a_update_context(contexts.items[0].id, "Quarterly Research Review")?;
```

There is no async-iterator sugar in Rust — loop on `next_cursor` yourself, re-sending the same filter struct with `cursor` set.

Task filters: `direction`, `requester_handle`, `worker_handle`, `state`, `context_id`, `q`, `since`, `cursor`, `limit`. Message filters additionally support `task_id` and `role`; `role` is the message author (`Caller` or `Agent`), independent of task direction. Message direction defaults to both. Multiple filters are ANDed. Task search returns tasks containing a matching message; message search returns individual matches with requester/worker and task/context provenance. Search covers string and numeric content values from `text` and `data` parts, excludes metadata, and is deterministic newest-first rather than relevance-ranked.

Use `a2a_task` / `a2a_sent_task` for a task's current state and message history.

New contexts start with the persisted name `New A2A Session`. That exact default may be replaced with a name based on the first task message. Either participant can rename a context at any time; automatic naming does not replace a non-default name. Context-level caller and target remain the original opener and recipient. Each nested task carries its own authoritative participants, and tasks in both directions can run concurrently.

Enabled same-organization identities can call each other without contact rules. Public agents accept enabled callers that allow public egress. Private cross-organization calls require requester-outbound and worker-inbound permission; explicit blocks always win.

`inkbox::webhooks::types` includes `A2AWebhookPayload` and its typed event discriminator for all four A2A task-lifecycle events.

## Vault

Encrypted credential vault with client-side Argon2id key derivation and AES-256-GCM encryption. The server never sees plaintext secrets. The crypto is pure Rust (`argon2` + `aes-gcm`) with the exact parameters of the Python/TS SDKs, so secrets are cross-SDK-interoperable.

### Initialize

```rust
// Initialize a new vault (org ID is fetched automatically from the API key)
let result = inkbox.vault().initialize("my-Vault-key-01!")?;
println!("{} {}", result.vault_id, result.vault_key_id);
for code in &result.recovery_codes {
    println!("{code}"); // save these immediately — they cannot be retrieved again
}
```

### Unlock & Read

`unlock` returns an `UnlockedVault` **and** stores the unlock state on the client, so `identity.credentials()` and `inkbox.vault().unlocked()` work afterwards. Mutating methods on `UnlockedVault` take `&mut self`, so bind it `mut`.

```rust
use inkbox::vault::{LoginPayload, SecretPayload};

// Unlock with a vault key — derives key via Argon2id, decrypts all secrets
let mut unlocked = inkbox.vault().unlock("my-Vault-key-01!", None)?;

// Optionally filter to secrets an agent identity has access to
let scoped = inkbox.vault().unlock("my-Vault-key-01!", Some("agent-uuid"))?;

// All decrypted secrets from the unlock bundle
for secret in unlocked.secrets() {
    println!("{} {}", secret.name, secret.secret_type);
    match &secret.payload {
        SecretPayload::Login(p) => println!("{:?}", p.username),
        other => println!("{:?}", other.secret_type()),
    }
}

// Fetch and decrypt a single secret by ID
let secret = unlocked.get_secret("secret-uuid")?;
if let SecretPayload::Login(login) = &secret.payload {
    println!("{:?} {}", login.username, login.password);
}
```

Constructing the client with `.vault_key(...)` unlocks at build time, so a plain `Inkbox::builder(key).vault_key(vk).build()?` is enough for read-only credential access.

### Create & Update

```rust
use inkbox::vault::{APIKeyPayload, LoginPayload, OtherPayload, SSHKeyPayload, SecretPayload};

// Create a login secret (secret_type inferred from the payload variant)
unlocked.create_secret(
    "AWS Production",
    &SecretPayload::Login(LoginPayload {
        password: "s3cret".into(),
        username: Some("admin".into()),
        email: None,
        url: Some("https://aws.amazon.com".into()),
        totp: None,
        notes: None,
    }),
    Some("Production IAM user"),
)?;

// Create an API key secret
unlocked.create_secret(
    "GitHub PAT",
    &SecretPayload::ApiKey(APIKeyPayload {
        api_key: "ghp_xxx".into(),
        endpoint: None,
        notes: None,
    }),
    None,
)?;

// Create an SSH key secret
unlocked.create_secret(
    "Deploy Key",
    &SecretPayload::SshKey(SSHKeyPayload {
        private_key: "-----BEGIN OPENSSH PRIVATE KEY-----...".into(),
        public_key: None,
        fingerprint: None,
        passphrase: None,
        notes: None,
    }),
    None,
)?;

// Create a freeform secret
unlocked.create_secret(
    "Misc",
    &SecretPayload::Other(OtherPayload { data: "any freeform content".into(), notes: None }),
    None,
)?;

// Update name/description and/or re-encrypt payload.
// Positional: secret_id, name, description, payload. `description` is
// Option<Option<&str>> — None omits, Some(None) clears, Some(Some(s)) sets.
unlocked.update_secret("secret-uuid", Some("New Name"), None, None)?;
unlocked.update_secret("secret-uuid", None, None, Some(&new_payload))?;

// Delete
unlocked.delete_secret("secret-uuid")?;
```

### Metadata (no unlock needed)

```rust
let info    = inkbox.vault().info()?;                          // Option<VaultInfo> (None = not initialized)
let keys    = inkbox.vault().list_keys(None)?;                 // Vec<VaultKey>
let keys    = inkbox.vault().list_keys(Some("recovery"))?;     // filter by type
let secrets = inkbox.vault().list_secrets(None)?;              // Vec<VaultSecret> (metadata only)
let secrets = inkbox.vault().list_secrets(Some("login"))?;     // filter by type
inkbox.vault().delete_secret("secret-uuid")?;                  // delete without unlocking

// Access rules and key rotation
inkbox.vault().list_access_rules("secret-uuid")?;
inkbox.vault().grant_access("secret-uuid", "identity-uuid")?;
inkbox.vault().revoke_access("secret-uuid", "identity-uuid")?;
inkbox.vault().update_key("new-Vault-key-01!", Some("my-Vault-key-01!"), None)?;
```

### Payload Types

| Type | Variant | Struct | Fields |
|------|---------|--------|--------|
| `login` | `SecretPayload::Login` | `LoginPayload` | `password`, `username?`, `email?`, `url?`, `totp?`, `notes?` |
| `api_key` | `SecretPayload::ApiKey` | `APIKeyPayload` | `api_key`, `endpoint?`, `notes?` |
| `key_pair` | `SecretPayload::KeyPair` | `KeyPairPayload` | `access_key`, `secret_key`, `endpoint?`, `notes?` |
| `ssh_key` | `SecretPayload::SshKey` | `SSHKeyPayload` | `private_key`, `public_key?`, `fingerprint?`, `passphrase?`, `notes?` |
| `other` | `SecretPayload::Other` | `OtherPayload` | `data`, `notes?` |

`secret_type` is immutable after creation. To change it, delete and recreate.

### Agent Credentials (identity-scoped)

Agent-facing credential access — typed, identity-scoped. The vault stays as the admin surface; `identity.credentials()` is the agent runtime surface.

```rust
// Unlock the vault first (stores state on the client)
inkbox.vault().unlock("my-Vault-key-01!", None)?;

let identity = inkbox.get_identity("support-bot")?;
let creds = identity.credentials()?;

// Discovery — returns Vec<DecryptedVaultSecret> with name/metadata
let all_creds = creds.list();
let logins    = creds.list_logins();
let api_keys  = creds.list_api_keys();
let ssh_keys  = creds.list_ssh_keys();
let key_pairs = creds.list_key_pairs();

// Access by UUID — returns the typed payload directly
let login    = creds.get_login("secret-uuid")?;     // → LoginPayload
let api_key  = creds.get_api_key("secret-uuid")?;   // → APIKeyPayload
let ssh_key  = creds.get_ssh_key("secret-uuid")?;   // → SSHKeyPayload
let key_pair = creds.get_key_pair("secret-uuid")?;  // → KeyPairPayload

// Generic access — returns DecryptedVaultSecret
let secret = creds.get("secret-uuid")?;
```

- Requires `inkbox.vault().unlock(...)` (or a `.vault_key(...)` builder) first — otherwise `InkboxError::VaultKey`
- Results are filtered to secrets the identity has access to (via access rules)
- Not cached: each `credentials()` call rebuilds the view from the current unlock snapshot
- `get_*` returns `InkboxError::InvalidArgument` when the id is unknown or the secret type does not match
- `identity.create_secret(name, payload, description)` creates a secret **and** grants this identity access; re-unlock the vault to surface it in `credentials()`

## One-Time Passwords (TOTP)

TOTP secrets are stored inside `LoginPayload.totp` in the encrypted vault. Codes are generated client-side — no server call needed.

### From an agent identity (recommended)

```rust
use inkbox::vault::{parse_totp_uri, LoginPayload, SecretPayload};

// Create a login with TOTP
let secret = identity.create_secret(
    "GitHub",
    &SecretPayload::Login(LoginPayload {
        password: "s3cret".into(),
        username: Some("user@example.com".into()),
        email: None,
        url: None,
        totp: Some(parse_totp_uri(
            "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
        )?),
        notes: None,
    }),
    None,
)?;

// Generate TOTP code
let code = identity.get_totp_code(&secret.id.to_string())?;
println!("{}", code.code);                // e.g. "482901"
println!("{}", code.seconds_remaining);   // e.g. 17

// Add/replace TOTP on an existing login
identity.set_totp_uri(&secret.id.to_string(), "otpauth://totp/...?secret=...")?;
identity.set_totp(&secret.id.to_string(), totp_config)?;   // typed TOTPConfig form

// Remove TOTP
identity.remove_totp(&secret.id.to_string())?;
```

### From the unlocked vault (admin-only)

```rust
let mut unlocked = inkbox.vault().unlock("my-Vault-key-01!", None)?;

// Same methods available on UnlockedVault (mutators take &mut self)
unlocked.set_totp_uri(secret_id, totp_uri)?;
unlocked.remove_totp(secret_id)?;
let code = unlocked.get_totp_code(secret_id)?;
```

### TOTPCode fields

| Field | Type | Description |
|---|---|---|
| `code` | `String` | The OTP code (e.g. `"482901"`) |
| `period_start` | `i64` | Unix timestamp when the code became valid |
| `period_end` | `i64` | Unix timestamp when the code expires |
| `seconds_remaining` | `i64` | Seconds until expiry |

`TOTPConfig` carries `secret` (base32), `algorithm` (`TOTPAlgorithm::Sha1` / `Sha256` / `Sha512`), `digits`, `period`, `issuer`, `account_name`. `generate_totp(&config)` produces a code from a config directly.

## Admin-only Resources

### Mailboxes (`inkbox.mailboxes()`)

```rust
use inkbox::mail::FilterMode;

let mailboxes = inkbox.mailboxes().list()?;
let mailbox   = inkbox.mailboxes().get("abc@inkboxmail.com")?;

// To rename, use `identity.update(...)` with a display_name —
// the mailbox PATCH endpoint hard-rejects `display_name` with a 422.
// To attach a webhook receiver, see "Webhooks" below.

// DEPRECATED channel path — the mail filter mode now lives on the identity.
// Prefer identity.update(..., mail_filter_mode) (which does NOT return a
// change notice). This legacy mailbox flip still works and returns one:
let updated = inkbox.mailboxes().update(&mailbox.email_address, Some(FilterMode::Whitelist))?;
if let Some(n) = &updated.filter_mode_change_notice {
    // Populated when filter_mode actually changed.
    println!("{} {:?} {:?}", n.redundant_rule_count, n.redundant_rule_action, n.new_filter_mode);
}

// Mailbox responses also carry mailbox.agent_identity_id when linked.
// `mailbox.sending_domain` is the bare domain the mailbox sends from
// (platform default or a verified custom domain — see "Custom email domains" below).

// Storage (list / get / update all carry these):
println!("{}", mailbox.storage_used_bytes);      // bytes stored, e.g. 1288490188
println!("{:?}", mailbox.storage_limit_bytes);   // plan cap, e.g. Some(2147483648), or None
let used_gib = mailbox.storage_used_bytes as f64 / 1024f64.powi(3);  // caps are BINARY — GiB, not GB
// Over-cap sends return InkboxError::StorageLimitExceeded (402) — see "Storage cap (402)".

let results = inkbox.mailboxes().search(&mailbox.email_address, "invoice", 20)?;
// Mailboxes are deleted via the owning identity's cascade — there is no standalone delete:
//   identity.delete()?;  // removes the mailbox + tunnel atomically (cascade)
```

### Custom email domains (`inkbox.domains()`)

If your org has registered custom sending domains in the console, list them and (admin-only) set the org default. New mailboxes inherit the org default unless you pass `sending_domain` on identity create.

```rust
use inkbox::identities::Unset;
use inkbox::mail::SendingDomainStatus;

let verified = inkbox.domains().list(Some(SendingDomainStatus::Verified))?;

// Admin-scoped API key only — non-admin keys get 403.
// Returns the bare new default domain name (None when reverted to platform).
let new_default = inkbox.domains().set_default("mail.acme.com")?;
// Pass the platform domain (e.g. "inkboxmail.com" in prod) to clear the org default.

// Identity create: pick by bare domain name (not id) — the 6th positional arg.
inkbox.create_identity_with(
    "sales-bot", None, Unset::Omit, None, None,
    Unset::Value(Some("mail.acme.com".to_string())),
    None, None, None,
)?;
// Force the platform default:
inkbox.create_identity_with(
    "sales-bot-2", None, Unset::Omit, None, None, Unset::Value(None), None, None, None,
)?;
// Standalone mailbox creation is gone — provision via create_identity above.
```

### Phone Numbers (`inkbox.phone_numbers()`)

`update` takes nested `Option<Option<&str>>` for the nullable URL fields: the outer `None` omits the key, `Some(None)` sends an explicit `null` (clears it), `Some(Some(v))` sets it.

```rust
use inkbox::phone::FilterMode;

let numbers = inkbox.phone_numbers().list()?;
let number  = inkbox.phone_numbers().get("phone-number-uuid")?;
let num     = inkbox.phone_numbers().provision("my-agent", "local", Some("NY"))?;  // local only; toll_free is rejected (422)

let id = num.id.to_string();
inkbox.phone_numbers().update(
    &id,
    Some(Some("webhook")),                        // "webhook", "auto_accept", "auto_reject", or "hosted_agent"
    None,
    Some(Some("https://example.com/hook")),
    None,
)?;
inkbox.phone_numbers().update(&id, Some(Some("auto_accept")), Some(Some("wss://...")), None, None)?;
inkbox.phone_numbers().update(&id, Some(Some("hosted_agent")), None, None, None)?;  // no URL — Voice AI answers

let hits = inkbox.phone_numbers().search_transcripts(&id, "refund", Some("remote"), 50)?;
inkbox.phone_numbers().release(&id)?;
```

Phone numbers carry the same `filter_mode` / `agent_identity_id` / `filter_mode_change_notice` fields as mailboxes; flipping `filter_mode` here is the **deprecated** channel path (admin-only; returns a change notice when the value actually changed). Prefer `identity.update(..., phone_filter_mode)`, which sets the mode on the identity and does not return a change notice.

## Contact Rules

Allow/block lists are scoped to the **agent identity** (mirroring iMessage), addressed by `agent_handle`. The identity's `mail_filter_mode` / `phone_filter_mode` decides whether each channel's rules act as a whitelist or blacklist. Mail matches by exact email or domain; phone matches by exact E.164 number. Returned rows are `MailIdentityContactRule` / `PhoneIdentityContactRule`, keyed by `rule.agent_identity_id` (not a mailbox/phone-number id).

```rust
use inkbox::mail::{MailRuleAction, MailRuleMatchType};
use inkbox::phone::{PhoneRuleAction, PhoneRuleMatchType};
use inkbox::InkboxError;

let identity = inkbox.get_identity("sales-agent")?;

// Mail rules via the identity convenience methods.
let rule = identity.create_mail_contact_rule(
    MailRuleAction::Allow,             // or Block
    MailRuleMatchType::Domain,         // or ExactEmail
    "example.com",
)?;
identity.list_mail_contact_rules(None, None, None, None)?;   // action, match_type, limit, offset
identity.get_mail_contact_rule(&rule.id.to_string())?;
identity.update_mail_contact_rule(&rule.id.to_string(), MailRuleAction::Allow)?;   // admin-only
identity.delete_mail_contact_rule(&rule.id.to_string())?;                          // admin-only

// Phone rules — same shape, only PhoneRuleMatchType::ExactNumber is supported.
// Phone helpers require the identity to have a phone number (else InkboxError).
identity.create_phone_contact_rule(
    PhoneRuleAction::Block,
    "+15551234567",
    PhoneRuleMatchType::ExactNumber,
)?;
identity.list_phone_contact_rules(None, None, None, None)?;

// Equivalent org-level resources, keyed by agent_handle, with an org-wide list_all:
inkbox.mail_identity_contact_rules().create(
    "sales-agent", MailRuleAction::Allow, MailRuleMatchType::Domain, "example.com",
)?;
inkbox.mail_identity_contact_rules().list("sales-agent", None, None, None, None)?;
inkbox.mail_identity_contact_rules().list_all(Some(&identity.id()), None, None, None, None)?;  // admin-only, org-wide
inkbox.phone_identity_contact_rules().list_all(None, None, None, None, None)?;                 // admin-only, org-wide

// Duplicate (match_type, match_target) on the same identity returns 409:
match identity.create_mail_contact_rule(
    MailRuleAction::Allow, MailRuleMatchType::Domain, "example.com",
) {
    Err(InkboxError::DuplicateContactRule { existing_rule_id, .. }) => {
        println!("{existing_rule_id}");   // id of the rule that already matched
    }
    other => { other?; }
}
```

### Filter mode

The whitelist/blacklist mode lives on the identity. Flip it with `identity.update` (admin-only). Unlike the deprecated channel update, this does **not** return a `FilterModeChangeNotice`. `phone_filter_mode` requires the identity to have a phone number (else a 422).

```rust
use inkbox::identities::Unset;

identity.update(
    None, Unset::Omit, Unset::Omit, None, None,
    Some("whitelist"),   // mail_filter_mode
    Some("blacklist"),   // phone_filter_mode
)?;
println!("{:?} {:?}", identity.mail_filter_mode(), identity.phone_filter_mode());
```

### Deprecated: per-mailbox / per-number rules

The legacy per-mailbox `inkbox.mail_contact_rules()` and per-number `inkbox.phone_contact_rules()` resources still work but hit deprecated server routes (Sunset 2026-08-31). Prefer the identity-keyed surface above.

```rust
use inkbox::mail::{MailRuleAction, MailRuleMatchType};
use inkbox::phone::{PhoneRuleAction, PhoneRuleMatchType};

// Deprecated — per-mailbox mail rule:
inkbox.mail_contact_rules().create(
    &mailbox.email_address, MailRuleAction::Allow, MailRuleMatchType::Domain, "example.com",
)?;
inkbox.mail_contact_rules().list_all(Some(mailbox.id), None, None, None, None)?;
// Deprecated — per-number phone rule:
inkbox.phone_contact_rules().create(
    &num.id.to_string(), PhoneRuleAction::Block, "+15551234567", PhoneRuleMatchType::ExactNumber,
)?;
```

## Contacts

Organization-wide address book with lifecycle review, memory, correspondence, and vCard import/export.

Merging requires an admin-scoped API key. The merge is rejected atomically if the survivor would exceed 25 active memories; delete unwanted facts and retry.

```rust
use inkbox::contacts::{
    ContactEmail, ContactPhone, CorrespondenceChannel, CorrespondenceQuery,
    CreateContactParams, ListContactsParams, MergeContactsParams, UpdateContactParams,
};

// CRUD
let contact = inkbox.contacts().create(&CreateContactParams {
    given_name: Some("Ada".into()),
    family_name: Some("Lovelace".into()),
    emails: Some(vec![ContactEmail { label: Some("work".into()), value: "ada@example.com".into() }]),
    phones: Some(vec![ContactPhone { label: Some("mobile".into()), value: "+15551234567".into() }]),
    ..Default::default()
})?;
let id = contact.id.to_string();
inkbox.contacts().get(&id)?;
inkbox.contacts().list(&ListContactsParams {
    q: Some("ada".into()),
    order: Some("recent".into()),
    ..Default::default()
})?;
inkbox.contacts().update(&id, &UpdateContactParams {
    job_title: Some(Some("Analyst".into())),   // Some(None) clears, None leaves unchanged
    ..Default::default()
})?;
inkbox.contacts().delete(&id)?;
inkbox.contacts().bulk_delete(&["contact-uuid-1".to_string(), "contact-uuid-2".to_string()])?;

// Reverse-lookup — exactly one filter required (else InkboxError::InvalidArgument before HTTP).
// Positional: email, email_contains, email_domain, phone, phone_contains.
inkbox.contacts().lookup(Some("ada@example.com"), None, None, None, None)?;
inkbox.contacts().lookup(None, None, Some("example.com"), None, None)?;
inkbox.contacts().lookup(None, None, None, Some("+15551234567"), None)?;

// Compatibility access information is read-only
inkbox.contacts().access().list(&id)?;

// Facts, citations, correspondence, and duplicate merging
let facts = inkbox.contacts().facts().list(&id)?;
if let Some(url) = facts
    .first()
    .and_then(|f| f.citations.first())
    .and_then(|c| c.source_url.as_deref())
{
    inkbox.contacts().facts().resolve_citation_url(url)?;
}
if let Some(fact) = facts.first() {
    inkbox.contacts().facts().delete(&id, &fact.id.to_string())?;   // admin only
}
let history = inkbox.contacts().correspondence().get(&id, &CorrespondenceQuery {
    channels: vec![CorrespondenceChannel::Email, CorrespondenceChannel::Sms],
    ..Default::default()
})?;
let survivor = inkbox.contacts().merge(&id, &MergeContactsParams {
    losing_contact_ids: vec!["duplicate-contact-uuid".to_string()],
    ..Default::default()
})?;

// vCards — import takes raw bytes (bulk, ≤5 MiB, ≤1000 cards)
let result = inkbox.contacts().vcards().import_vcards(vcf_bytes, Some("text/vcard"))?;
println!("{} {}", result.created_count, result.error_count);
println!("{:?}", result.created_ids());   // helper method, not a field
for item in &result.results {             // per-card outcome, submission order
    println!("{} {:?} {:?} {:?}", item.index, item.status, item.error, item.conflicting_contact_id);
}

let vcf = inkbox.contacts().vcards().export_vcard(&id)?;   // vCard 4.0 String
let batch = inkbox
    .contacts()
    .vcards()
    .export_vcards(&["contact-uuid-1".to_string(), "contact-uuid-2".to_string()])?;
println!("{}", batch.vcard);
```

## Notes

Admin-only free-form notes with per-identity access grants. There is no wildcard for notes — grant identities explicitly. Note and identity ids are `Uuid`, not strings.

```rust
use uuid::Uuid;

let note = inkbox.notes().create("Customer prefers email follow-up.", Some("Ada"))?;
inkbox.notes().get(note.id)?;
inkbox.notes().list(Some("email"), Some(identity.id()), Some(50), None, Some("recent"))?;
inkbox.notes().update(note.id, None, Some("Updated body"))?;
inkbox.notes().update(note.id, Some(None), None)?;   // clear title; body cannot be null
inkbox.notes().delete(note.id)?;

// Access grants (admin + JWT only)
inkbox.notes().access().list(note.id)?;
inkbox.notes().access().grant(note.id, identity.id())?;
inkbox.notes().access().revoke(note.id, identity.id())?;
```

## Whoami

```rust
use inkbox::whoami::{WhoamiResponse, AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED};

// Check the authenticated caller's identity
match inkbox.whoami()? {
    WhoamiResponse::ApiKey(info) => {
        println!("{} {:?}", info.auth_type, info.organization_id);
        println!("{:?} {:?}", info.key_id, info.label);
        if info.auth_subtype.as_deref() == Some(AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED) {
            // admin-only operations (filter_mode flips, rule updates/deletes, etc.)
        }
    }
    WhoamiResponse::Jwt(info) => {
        println!("{:?} {:?}", info.email, info.org_role);
    }
}
```

`WhoamiResponse` is a `serde(untagged)` enum discriminated on `auth_type`. The other scope constants are `AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED` and `AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED`.

## Tunnels

Bring a local server online at a public `https://{name}.inkboxwire.com` URL. Outbound HTTP/2 only — no inbound port to open. POSIX only. The data-plane runtime is behind the optional `tunnels-runtime` feature (it pulls in `tokio`, `rustls`, and `h2`); the control-plane surface is always available.

```toml
[dependencies]
inkbox = { version = "0.5", features = ["tunnels-runtime"] }
```

```rust
// Forward to a local URL (edge mode — Inkbox terminates TLS at the edge).
// This blocks, serving the tunnel until it is closed.
inkbox.tunnels().connect("my-app", "http://127.0.0.1:8080")?;

// Observe data-plane state changes: "connecting" / "connected" /
// "reconnecting" / "closed".
inkbox.tunnels().connect_with_status(
    "my-app",
    "http://127.0.0.1:8080",
    Box::new(|status| println!("tunnel: {status}")),
)?;
```

Rust forwards to a **URL** only — the in-process handler forms (Fetch handler in TS, ASGI app in Python) are not part of the Rust surface. Without the `tunnels-runtime` feature, `connect` returns `InkboxError::Tunnel`.

Passthrough TLS (the SDK terminates; cert auto-signed via the control plane) is fixed at identity-create time through `IdentityTunnelCreateOptions { tls_mode: Some("passthrough".into()) }`; the `connect` call is identical. In passthrough mode the state dir (`~/.inkbox/tunnels/{name}`) holds the per-tunnel private key — treat it like an SSH key dir.

Tunnels are provisioned atomically by `inkbox.create_identity(...)`; there is no standalone create / delete / restore / rotate-secret surface.

Reads + edit:

```rust
inkbox.tunnels().list()?;
inkbox.tunnels().get("tunnel-uuid")?;
inkbox.tunnels().update("tunnel-uuid", Some(Some(metadata_map)))?;
// Passthrough only:
inkbox.tunnels().sign_csr("tunnel-uuid", &csr_pem)?;
```

Data-plane auth uses the same API key the `Inkbox` client was constructed with — admin-scoped or identity-scoped (matching the tunnel's identity). Mint a per-agent identity-scoped key via `inkbox.api_keys().create(label, description, Some(identity_id))`.

**Redeploys are graceful.** A long-running listener reconnects make-before-break, so short HTTP requests see no gap. In-progress WebSocket and passthrough-TCP sessions cannot migrate across a redeploy — they end with a typed `server_draining` close and the third-party peer reconnects. Write handlers to reconnect idempotently.

For full options and the Python/TypeScript equivalents, see `skills/inkbox-tunnels/SKILL.md`.

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox, phone number, or agent identity — no separate registration.

```rust
use std::collections::HashMap;
use inkbox::signing_keys::verify_webhook;
use inkbox::webhooks::types::{TextWebhookEventType, TextWebhookPayload};

// Each agent identity has its own webhook signing key. Create/rotate it
// (plaintext returned once — save it), or read its status:
let key = identity.create_signing_key()?;                    // → SigningKey
let status = identity.get_signing_key_status()?;             // → SigningKeyStatus { configured, created_at }
// Org-level resource, keyed by agent_handle:
let key2 = inkbox.signing_keys().create_or_rotate("sales-agent")?;
let status2 = inkbox.signing_keys().get_status("sales-agent")?;
// DEPRECATED: org-level inkbox.create_signing_key() — with an agent-scoped key
// it still rotates that identity's key; with an admin key the server returns 409.

// Verify, then parse + discriminate. Pass the RAW body bytes — do not parse
// and re-serialize before verifying.
let valid = verify_webhook(&raw_body, &headers, "whsec_...")?;
if !valid {
    return Ok(Response::forbidden());
}
let payload: TextWebhookPayload = serde_json::from_slice(&raw_body)?;
if payload.event_type == TextWebhookEventType::TextDeliveryFailed {
    eprintln!("{:?} {:?}", payload.data.text_message.error_code, payload.data.text_message.error_detail);
}
```

`event_type` is a typed enum on every payload (`TextWebhookEventType`, `MailWebhookEventType`, `IMessageWebhookEventType`), not a bare string — match on the variant rather than comparing wire strings.

`headers` is a `&HashMap<String, String>`; lookups are case-insensitive. Headers checked: `x-inkbox-signature`, `x-inkbox-request-id`, `x-inkbox-timestamp`. Algorithm: HMAC-SHA256 over `"{request_id}.{timestamp}.{body}"`, compared in constant time; the `whsec_` prefix on the secret is optional.

**Event taxonomy:**

- **Mail** (envelope, fire-and-forget) — `message.received`, `message.sent`, `message.forwarded`, `message.delivered`, `message.bounced`, `message.failed`. Subscribe with `mailbox_id`. On `message.received`, `data.message` includes the plain-text `body` (whole under a size cap, else a prefix with `body_truncated: true` / `body_state: "truncated"`); when truncated, hydrate with `inkbox.messages().get(email_address, id)` — use `id` (row id), not `message_id` (RFC 5322 header).
- **Text** (envelope, fire-and-forget) — `text.received`, `text.sent`, `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed`. Subscribe with `phone_number_id`. The text-message body carries `delivery_status` as an outbound message-level rollup; 1:1 traffic also hoists `error_code`, `error_detail`, `sent_at`, `delivered_at`, and `failed_at`. On group outbound those legacy detail fields are null and per-recipient state lives in `recipients`.
- **iMessage** (envelope, fire-and-forget) — `imessage.received`, `imessage.reaction_received`, plus the outbound delivery lifecycle `imessage.sent`, `imessage.delivered`, `imessage.delivery_failed`. Subscribe with `agent_identity_id` — owned by the **agent identity**, since shared iMessage pool numbers are not org resources. Fan-out only happens while the identity is active and `imessage_enabled`; contact-rule-blocked traffic is never delivered.
- **Call lifecycle** (envelope, fire-and-forget + replayable) — `call.ended`, owned by the **agent identity** (like iMessage). The payload carries the `call` (with derived `duration_seconds`), resolved `contacts` / `agent_identities`, an always-present `transcript_url` (authoritative verbatim, fetch with an admin API key), and an inline abridged `transcript` block when the platform captured one. Voice AI calls fire `call.ended` on **every** terminal state (including never-connected ones like `no_answer`), not just connected calls.
- **A2A** (envelope) — the four task-lifecycle events, typed as `A2AWebhookPayload` in `inkbox::webhooks::types`.
- **Inbound call** (flat, synchronous) — `PhoneIncomingCallWebhookPayload` on a phone number's `incoming_call_webhook_url`. Not subscribable; the URL stays on the phone-number resource because the response (`action: "answer" | "reject"` plus optional `client_websocket_url`) decides the call's fate. Non-200, invalid bodies, and timeouts are treated as "decline routing" by Inkbox.

**Subscription resource:** `inkbox.webhooks().subscriptions()` — `list`, `get`, `create`, `update`, `delete`. Each subscription names exactly one owner (mailbox, phone number, **or** agent identity), one HTTPS destination URL, and a non-empty subset of one channel's event types. Multiple subscriptions on the same owner fan out independently (cap: 20 active per owner). The SDK runs structural + prefix validation client-side; the server remains authoritative for the exact event-name enum, so a typo with a valid prefix is rejected as 422 by the server.

`create(url, event_types, mailbox_id, phone_number_id, agent_identity_id, context_config)` returns a `WebhookSubscriptionCreateResponse`. The **first** subscription created for an identity that has no signing key yet carries that identity's `signing_key` **once** (otherwise `None`) — capture it then, it cannot be retrieved again. Every subscription also carries `owner_identity_id`.

```rust
use inkbox::webhooks::{WebhookContextClassConfig, WebhookContextConfig};

let created = inkbox.webhooks().subscriptions().create(
    "https://example.com/hook",
    &["message.received".to_string()],
    Some(mailbox.id),
    None,
    None,
    Some(&WebhookContextConfig {
        email: Some(WebhookContextClassConfig::Count { count: 10 }),
        ..Default::default()
    }),
)?;
// The base subscription is serde-flattened under `.subscription`.
println!("{:?}", created.subscription.owner_identity_id);
if let Some(key) = &created.signing_key {
    save_secret(key);   // populated once if the identity had no key yet
}

// context_config is tri-state on update: None = unchanged, Some(None) = clear,
// Some(Some(cfg)) = replace.
inkbox.webhooks().subscriptions().update(created.subscription.id, None, None, Some(None))?;
```

**Conversation context:** opt a mail, text, or iMessage subscription into per-class history on **received** events (`message.received`, `text.received`, `imessage.received`) with `context_config` — `email` / `texts` / `calls`, each `Count { count }` (1..50) or `Window { hours }` (1..168). A2A subscriptions do not support conversation context. Received-event payloads then carry an optional `data.context` keyed by class; a skipped class ships an empty item list plus a `skipped` reason.

**Deliveries:** `inkbox.webhooks().deliveries().list(subscription_id, phone_number_id, event_type, success, limit, offset)` and `.replay(delivery_id)`.

All webhook payload types in `inkbox::webhooks::types` use snake_case field names matching the raw JSON body.

## Error Handling

Everything returns `inkbox::Result<T>` = `Result<T, InkboxError>`. `InkboxError` is a `thiserror` enum, so match on the variant you care about and let `?` propagate the rest.

```rust
use inkbox::{ApiErrorDetail, InkboxError};

match inkbox.get_identity("unknown") {
    Ok(identity) => { /* ... */ }
    Err(InkboxError::Api { status_code, detail }) => {
        println!("{status_code}");        // HTTP status (e.g. 404)
        match detail {
            ApiErrorDetail::Message(s) => println!("{s}"),        // legacy string errors
            ApiErrorDetail::Structured(v) => println!("{v}"),     // machine-readable object
        }
    }
    Err(e) => return Err(e),
}
```

The structured variants carry parsed fields so you don't have to reach into the raw JSON:

- `InkboxError::Api { status_code, detail }` — the generic 4xx/5xx case.
- `InkboxError::DuplicateContactRule { existing_rule_id, .. }` — 409 when creating a contact rule with an already-taken `(match_type, match_target)` on the same resource.
- `InkboxError::RedundantContactAccessGrant { error, detail_message, .. }` — 409 when an identity-viewer grant is redundant (e.g. a specific viewer on top of an active wildcard).
- `InkboxError::RecipientBlocked { matched_rule_id, address, reason, .. }` — 403 when an SMS, call, or iMessage destination is blocked by an outbound contact rule (or the sender's `filter_mode` default).
- `InkboxError::StorageLimitExceeded { message, upgrade_url, limit_bytes, .. }` — 402 when a send / reply-all / forward would push the mailbox past its plan storage cap.
- `InkboxError::DedicatedIMessageNumberQuotaExceeded { number_type, limit, current, upgrade_url, .. }` — 402 on the dedicated-number allowance.
- `InkboxError::DedicatedIMessageNumberInventoryPending { retry_after_seconds, .. }` — 503 when no dedicated number is available to claim.
- `InkboxError::IdempotencyKeyReused { message, .. }` — 409 on an incompatible idempotency-key reuse.
- `InkboxError::MailImportQuotaExceeded { .. }` — 429 on the 20-jobs-per-24h import cap, carrying `Retry-After`.
- `InkboxError::VaultKey(_)` — vault key requirements or crypto failure (including "vault not unlocked").
- `InkboxError::InvalidArgument(_)` — local validation, raised before any HTTP call.
- `InkboxError::Timeout(_)` — a local wall-clock waiter expired (e.g. `imports().wait`); the server-side job is untouched.
- `InkboxError::Tunnel(_)` — tunnel validation or data-plane failure.
- `InkboxError::Transport(_)` / `InkboxError::Decode(_)` — `From` conversions for `reqwest::Error` and `serde_json::Error`.

### Handle collisions (409)

Identity handles live in a **unified global namespace** shared with tunnels and mail, and a deleted handle is not immediately reusable. `create_identity` / `update` therefore fail with a 409 more often than you'd expect. There is no dedicated `InkboxError` variant — it stays an `InkboxError::Api` — so use the typed view to read `blocking_namespace`:

```rust
use inkbox::identities::{BlockingNamespace, HandleUnavailableError};

match inkbox.create_identity("sales-agent") {
    Ok(identity) => { /* ... */ }
    Err(e) => match HandleUnavailableError::from_error(&e) {
        Some(handle_err) => {
            // detail.code is "agent_handle_unavailable"
            println!("{:?}", handle_err.blocking_namespace);   // Identities | Tunnels | Mail | None
            if handle_err.blocking_namespace == Some(BlockingNamespace::Tunnels) {
                // the handle is free on identities but taken as a tunnel hostname
            }
        }
        None => return Err(e),
    },
}
```

`from_error` returns `None` for any other error, so it composes as a filter. `map_identity_conflict_error` is the Python helper's analogue and is already applied internally by the identities resource; it returns the error unchanged, so callers use `HandleUnavailableError::from_error` for the typed fields.

## Key Conventions

- All method and field names are **snake_case**; enum variants are `CamelCase` and serialize to the shared snake_case wire values
- The client is an `Arc<Inkbox>` — clone the `Arc` to share it across threads; resource accessors (`inkbox.mailboxes()`, …) return borrows, so keep the `Arc` alive
- No keyword arguments: options are **positional**, `None` means "server default"
- Tri-state fields use `Unset<T>` (`Omit` / `Value(None)` / `Value(Some(v))`) or nested `Option<Option<T>>`
- `iter_emails()` / `iter_unread_emails()` return `Result<Vec<Message>>` — every page is fetched eagerly, not lazily
- `list_calls()` / `list_texts()` / `list_imessages()` use offset pagination; A2A history uses opaque cursors
- `*_filtered` siblings take a `&DateRangeFilter` for date-bounded listings
- Ids are `Uuid` on response models; most methods take `&str`, so `.to_string()` the id when passing it back
- The API is **blocking** — no `async`/`await`, no runtime to configure. Use `tokio::task::spawn_blocking` if you call it from an async context
- `identity.update()` / `.refresh()` return `Result<()>` and mutate the facade in place
- `UnlockedVault` mutators (`create_secret`, `update_secret`, `set_totp`, …) take `&mut self`
- The tunnels data plane needs the `tunnels-runtime` cargo feature

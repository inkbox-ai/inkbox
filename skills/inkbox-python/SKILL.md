---
name: inkbox-python
description: Use when writing Python code that imports from `inkbox`, uses `pip install inkbox`, or when adding email, phone, text/SMS, iMessage, contacts, notes, contact rules, vault, tunnels, mailbox storage, mail clients (IMAP/SMTP), or agent identity features using the Inkbox Python SDK.
user-invocable: false
---

# Inkbox Python SDK

API-first communication infrastructure for AI agents — email, phone, encrypted vault, and identities.

## Install & Init

```python
pip install inkbox
```

Always use the context manager — it manages the underlying HTTP session:

```python
from inkbox import Inkbox

with Inkbox(api_key="ApiKey_...") as inkbox:
    ...
```

Constructor: `Inkbox(api_key, base_url="https://inkbox.ai", timeout=30.0)`

## Core Model

```
Inkbox (admin-only client)
├── .create_identity(handle)  → AgentIdentity
├── .get_identity(handle)     → AgentIdentity
├── .list_identities()        → list[AgentIdentitySummary]
├── .mailboxes                → MailboxesResource
├── .phone_numbers            → PhoneNumbersResource
├── .texts                    → TextsResource
├── .imessages                → IMessagesResource
├── .imessage_contact_rules   → IMessageContactRulesResource
├── .mail_identity_contact_rules  → MailIdentityContactRulesResource   (keyed by agent_handle)
├── .phone_identity_contact_rules → PhoneIdentityContactRulesResource  (keyed by agent_handle)
├── .signing_keys             → SigningKeysResource  (per-identity: create_or_rotate/get_status)
├── .mail_contact_rules       → MailContactRulesResource   (DEPRECATED — per-mailbox)
├── .phone_contact_rules      → PhoneContactRulesResource  (DEPRECATED — per-number)
├── .sms_opt_ins              → SmsOptInsResource
├── .contacts                 → ContactsResource  (.facts, .correspondence, .access, .vcards)
├── .notes                    → NotesResource     (.access)
├── .vault                    → VaultResource
├── .whoami()                 → WhoamiResponse
└── .create_signing_key()     → SigningKey  (DEPRECATED — org-level; use .signing_keys)

AgentIdentity (identity-scoped helper)
├── .mailbox                 → IdentityMailbox | None
├── .phone_number            → IdentityPhoneNumber | None
├── .mail_filter_mode / .phone_filter_mode → FilterMode
├── .credentials             → Credentials  (requires vault unlocked)
├── .list_access()           → list[IdentityAccess]
├── .grant_access(viewer_id|None) → IdentityAccess
├── .revoke_access(viewer_id) → None
├── .list_mail_contact_rules() / .create_mail_contact_rule(...) / .get_/.update_/.delete_
├── .list_phone_contact_rules() / .create_phone_contact_rule(...) / ...  (requires phone number)
├── .get_signing_key_status() / .create_signing_key()
├── mail methods             (requires assigned mailbox)
├── phone methods            (requires assigned phone number)
└── text methods             (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is raised with a clear message.

## Agent Signup

For the full agent self-signup flow (register, verify, check status, restrictions, and direct API examples), read the shared reference:

> **See:** `skills/inkbox-agent-self-signup/SKILL.md`

Python SDK methods: `Inkbox.signup(...)`, `Inkbox.verify_signup(api_key, ...)`, `Inkbox.resend_signup_verification(api_key)`, `Inkbox.get_signup_status(api_key)`.

## Identities

```python
identity = inkbox.create_identity("sales-agent")
identity = inkbox.get_identity("sales-agent")
identities = inkbox.list_identities()  # → list[AgentIdentitySummary]

identity.update(new_handle="new-name")   # rename
identity.update(status="paused")         # or "active"
identity.refresh()                       # re-fetch from API, updates cached channels
identity.delete()                        # cascades: mailbox + tunnel + phone-number release
```

## Channel Management

```python
# Identity is created with a mailbox AND tunnel atomically — both come back on the response
print(identity.email_address)            # e.g. "sales-agent@inkboxmail.com"
print(identity.tunnel.public_host)       # e.g. "sales-agent.inkboxwire.com"

# Phone numbers are still opt-in
phone = identity.provision_phone_number(type="local", state="NY")  # local only; toll_free is rejected (422)
print(phone.number)                      # e.g. "+12125551234"

# Release the phone number (vendor + local)
identity.release_phone_number()
```

Mailboxes and tunnels are not separately linkable — they are 1:1 with their owning identity. Use `inkbox.create_identity()` to provision both; use `identity.delete()` to remove both (cascade).

## Identity Visibility

Controls which other agent identities can see an identity in API responses. Humans and admins always see every identity.

```python
rules = identity.list_access()    # list[IdentityAccess]
# One wildcard row (viewer_identity_id is None → every active identity sees it),
# explicit per-viewer rows, or [] (no agent can see it).

identity.grant_access(viewer.id)  # grant one viewer identity
identity.grant_access(None)       # reset to org-wide wildcard
identity.revoke_access(viewer.id) # revoke one viewer (keyed by viewer UUID)
```

Granting a viewer against an already-wildcard target raises `RedundantContactAccessGrantError` (409); revoking a non-existent grant raises `InkboxAPIError` (404).

## Mail

### Send

```python
sent = identity.send_email(
    to=["user@example.com"],
    subject="Hello",
    body_text="Hi there!",          # plain text (optional)
    body_html="<p>Hi there!</p>",   # HTML (optional)
    cc=["cc@example.com"],          # optional
    bcc=["bcc@example.com"],        # optional
    in_reply_to_message_id=sent.id, # for threaded replies
    attachments=[{                  # optional
        "filename": "report.pdf",
        "content_type": "application/pdf",
        "content_base64": "<base64>",
    }, {
        "filename": "chart.png",        # inline image: set content_id and
        "content_type": "image/png",    # reference it from body_html as
        "content_base64": "<base64>",   # <img src="cid:chart">. needs body_html
        "content_id": "chart",          # + image/*, unique per send; not on forwards.
    }],
    track_opens=True,               # optional; embed a tracking pixel
)
# track_opens tracks sends only when an HTML body is present. Opens
# surface on the returned Message as sent.first_opened_at / sent.open_count
# (approximate — proxy prefetch inflates it, the per-window debounce
# collapses repeats, so it can read above or below the true count; prefer
# first_opened_at. pixels can also raise spam scores).
#
# send_email / reply_all_email / forward_email all raise
# StorageLimitExceededError (402) when the mailbox is at its storage cap —
# see "Storage cap (402)" below.
```

### Read

```python
# Iterate all messages — pagination handled automatically (Iterator[Message])
for msg in identity.iter_emails():
    print(msg.subject, msg.from_address, msg.is_read)

# Filter by direction
for msg in identity.iter_emails(direction="inbound"):   # or "outbound"
    ...

# Unread only (client-side filtered)
for msg in identity.iter_unread_emails():
    ...

# Mark as read
ids = [msg.id for msg in identity.iter_unread_emails()]
identity.mark_emails_read(ids)
identity.mark_emails_unread(ids)   # batch counterpart
# Note: fetching a single inbound message by id (inkbox.messages.get) with
# an API key marks it read server-side; iterating does not, so
# mark_emails_read is the way to clear unread for list-only workflows.
# is_read (agent consumed via API) is distinct from first_opened_at
# (recipient's mail client loaded the tracking pixel).

# Get full thread (oldest-first)
thread = identity.get_thread(msg.thread_id)
for m in thread.messages:
    print(f"[{m.from_address}] {m.subject}")
```

### Thread Folders

Threads carry a `folder` field: `inbox`, `spam`, `archive`, or `blocked` (server-assigned, never client-set).

```python
from inkbox import ThreadFolder
# Thread.folder / ThreadDetail.folder is always one of the four values above.
```

Low-level folder listing / per-thread updates (`list(folder=…)`, `list_folders(email)`, `update(..., folder=…)`) live on `ThreadsResource`. Passing `folder="blocked"` to `update` raises `ValueError` before the HTTP call.

### Storage cap (402)

Every mailbox has a plan storage cap. **All three send paths** — `send_email`, `reply_all_email`, and `forward_email` (and the `inkbox.messages.*` equivalents) — raise `StorageLimitExceededError` (HTTP 402) when the send would push the mailbox over it.

```python
from inkbox import StorageLimitExceededError

try:
    identity.send_email(to=["user@example.com"], subject="Hi", body_text="…")
except StorageLimitExceededError as e:
    print(e.message)      # human sentence, includes the limit
    print(e.limit_bytes)  # e.g. 2147483648 (2 GiB)
    print(e.upgrade_url)  # console billing page
    # Free space — reclaim is immediate — or upgrade the plan:
    inkbox.messages.delete(identity.email_address, "<message-uuid>")
    inkbox.threads.delete(identity.email_address, "<thread-uuid>")
```

Read usage off the mailbox (`inkbox.mailboxes.get(...)`): `storage_used_bytes` and `storage_limit_bytes` (`None` = the server resolved no cap). The caps are **binary** — 2 GiB is `2 * 1024**3` = 2,147,483,648 bytes, so divide by 1024 and label GiB/MiB, never GB.

**Free plan:** a footer is appended to the **stored** body of outgoing mail, so `inkbox.messages.get(...)` does not return byte-for-byte what you sent (a body-less send comes back with the footer as its body). Don't assert `sent_body == fetched_body` on a Free plan.

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

The password is the same agent-scoped key an identity-scoped `Inkbox(...)` client authenticates with; mint one with `inkbox.api_keys.create(scoped_identity_id=...)`. Admin-scoped keys are rejected — one key maps to exactly one mailbox. Revoking the key revokes mail-client access.

Constraints that bite:

- **`From` must be the authenticated inbox address**, and exactly one address — aliases / "send as" are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over SMTP** — the required footer can't be injected without breaking the signature, so the send is refused. Send unsigned, or upgrade.
- Leave "save a copy of sent messages" **on** — Inkbox recognizes the client's copy as the message it already stored, so you get one Sent entry, charged against the storage cap once.

Full walkthrough: https://inkbox.ai/docs/capabilities/email/mail-clients

## Phone

```python
# Place outbound call — stream audio via WebSocket
call = identity.place_call(
    to_number="+15551234567",
    client_websocket_url="wss://your-agent.example.com/ws",
)
print(call.status)
print(call.rate_limit.calls_remaining)

# Or let Inkbox Voice AI drive the call — no WebSocket,
# no code. reason is the agent's task brief (required with
# mode="hosted_agent", invalid otherwise; server 422).
call = identity.place_call(
    to_number="+15551234567",
    mode="hosted_agent",     # CallMode.HOSTED_AGENT; default "client_websocket"
    reason="Confirm tomorrow's 3pm appointment; reschedule if needed.",
)
print(call.mode, call.reason)
# where Voice AI isn't available (or is at capacity), the server's
# 503 (hosted_agent_unavailable / hosted_agent_at_capacity) surfaces verbatim.

# List calls (offset pagination). Every call carries mode / reason plus
# post_call_action_items — open items Voice AI recorded
# (seq-ascending; empty for client_websocket calls)
calls = identity.list_calls(limit=10, offset=0)
for c in calls:
    print(c.id, c.direction, c.remote_phone_number, c.status, c.mode)
    for item in c.post_call_action_items:
        print(f"  [{item.seq}] {item.action}: {item.details}")

# Transcript segments (ordered by seq)
for t in identity.list_transcripts(calls[0].id):
    print(f"[{t.party}] {t.text}")   # party: "local" or "remote"

# Hang up a live call from outside it (teardown confirms asynchronously,
# so the returned call can still show its live status; already-ended
# calls surface the server's 409)
call = identity.hangup_call(calls[0].id)

# Per-identity Inkbox Voice AI config: voice / model / instructions,
# all nullable (None means the server default). set is a FULL REPLACE —
# an omitted field resets to the server default.
cfg = identity.get_hosted_agent_config()
cfg = identity.set_hosted_agent_config(instructions="Be brief and friendly.")

# Inbound-call handling: auto_accept | auto_reject | webhook | hosted_agent.
# hosted_agent is the only action needing no URL — Voice AI answers.
identity.set_incoming_call_action(incoming_call_action="hosted_agent")
print(identity.get_incoming_call_action().incoming_call_action)
```

## Text Messages (SMS/MMS)

**Outbound SMS limits and gates (current):**

- Allowed only from **local** numbers, not toll-free.
- **100 recipient sends per phone number per rolling 24h.** A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- New local numbers need **~10-15 min** for 10DLC carrier propagation. `identity.phone_number.sms_status` is `SmsStatus.PENDING` until ready; sends in this window return `409 sender_sms_pending`.
- Recipient must have texted **`START`** to any number in the org. Unknown → `403 recipient_not_opted_in`. `STOP` → `403 recipient_opted_out`. Inspect / override consent state via `inkbox.sms_opt_ins` (see below).
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands/campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

```python
# Send SMS/MMS from this identity's phone number.
# Returns a queued TextMessage; final delivery state arrives via any
# webhook subscription on the sender's phone number whose event_types
# include the text.* lifecycle events.
sent = identity.send_text(to="+15551234567", text="Hello from Inkbox")
print(sent.id, sent.delivery_status)   # SmsDeliveryStatus.QUEUED

# Group MMS beta: pass a list of recipients plus optional media URLs.
group = identity.send_text(
    to=["+15551234567", "+15557654321"],
    text="Hello group",
    media_urls=["https://example.com/photo.jpg"],
)
print(group.conversation_id, group.recipients)

# Reply to an existing conversation by UUID. Do not pass "to" with this form.
reply = identity.send_text(
    conversation_id=group.conversation_id,
    text="Following up in the same conversation.",
)

# List text messages (offset pagination)
texts = identity.list_texts(limit=20, offset=0)
for t in texts:
    print(t.id, t.direction, t.remote_phone_number, t.text, t.is_read)

# Filter by read state
unread = identity.list_texts(is_read=False)

# Get a single text message
text = identity.get_text("text-uuid")
print(text.type)   # "sms" or "mms"
if text.media:     # MMS media attachments (temporary signed URLs)
    for m in text.media:
        print(m.content_type, m.size, m.url)

# List one-to-one conversation summaries; opt into groups explicitly.
convos = identity.list_text_conversations(limit=20, include_groups=True)
for c in convos:
    print(c.id, c.participants, c.latest_has_media, c.latest_text)

# Get messages in a specific conversation by remote number or conversation UUID.
msgs = identity.get_text_conversation("+15551234567", limit=50)

# Mark a text as read (identity convenience method)
identity.mark_text_read("text-uuid")

# Mark all messages in a conversation as read
result = identity.mark_text_conversation_read("+15551234567")
print(result["updated_count"])

# Admin-only: search, update, delete
results = inkbox.texts.search(phone.id, q="invoice", limit=20)
inkbox.texts.update(phone.id, "text-uuid", status="deleted")
```

## iMessage

iMessage can use the shared service or an organization-owned dedicated number. On shared service, recipients ask the triage number to connect them to `@agent_handle`; the shared local number is never exposed. Shared service and `dedicated_inbound` require the recipient to message first. A `dedicated_outbound` number may start a conversation, subject to consent, contact-rule, and rate-limit checks.

Discover the router (triage) number at runtime — it can change, so never hardcode it:

```python
triage = inkbox.imessages.get_triage_number()
print(triage.number, triage.connect_command)  # "+1646...", "connect @your-handle"
# Humans connect by texting that command to that number.
```

Reachability is **opt-in per identity** (`imessage_enabled`, default `False`):

```python
identity = inkbox.create_identity("my-agent", imessage_enabled=True)
# or toggle later
identity.update(imessage_enabled=True)
# admin-only: flip contact-rule mode (default "blacklist")
identity.update(imessage_filter_mode="whitelist")
print(identity.imessage_enabled, identity.imessage_filter_mode)
```

Dedicated numbers follow the phone-number resource style: list or claim them on
the org-level iMessage resource, then inspect the typed number model. Claims
require admin credentials.

```python
from inkbox import IMessageNumberType

numbers = inkbox.imessages.list_numbers()  # attached and unattached
number = inkbox.imessages.claim_number(
    type=IMessageNumberType.DEDICATED_OUTBOUND,
    idempotency_key="claim-outbound-agent-2026-07-18",
)
print(number.number, number.status, number.agent_identity_id)
print(number.can_start_conversations)  # True only for dedicated_outbound
```

Claim and attach atomically during identity create/update. Do not make a
separate attach call after an atomic claim. `imessage_number_id=None` is
intentional wire data that moves an identity back to shared service; omitting
the argument leaves its attachment unchanged.

```python
identity = inkbox.create_identity(
    "outbound-agent",
    imessage_enabled=True,
    imessage_number_type="dedicated_outbound",
)
print(identity.imessage_number.number)

identity.update(
    imessage_number_type="dedicated_inbound",
    idempotency_key="swap-my-agent-inbound-2026-07-18",
)                                                         # claim + swap
identity.update(imessage_number_id=number.id)             # attach owned number
identity.update(imessage_number_id=None)                  # return to shared
```

`claim_number` and atomic identity claims may raise
`DedicatedIMessageNumberQuotaExceededError`,
`DedicatedIMessageNumberInventoryPendingError`, or
`IdempotencyKeyReusedError`. The inventory error exposes
`retry_after_seconds`; do not retry sooner. Reuse the same caller-generated
idempotency key when retrying an ambiguous claim.

Messaging (identity convenience methods; `inkbox.imessages` is the org-level resource with the same operations plus `agent_identity_id` / `is_blocked` filters):

```python
# Send to a connected recipient, or reply into a conversation by UUID.
sent = identity.send_imessage(to="+15551234567", text="Hello over iMessage")
reply = identity.send_imessage(
    conversation_id=sent.conversation_id,
    text="With style",
    send_style="slam",          # IMessageSendStyle: confetti, lasers, slam, ...
)
print(sent.service, sent.status)  # IMessageService.IMESSAGE, IMessageDeliveryStatus.QUEUED

# List messages / conversations
msgs = identity.list_imessages(limit=20, is_read=False)
convos = identity.list_imessage_conversations(limit=20)
convo = identity.get_imessage_conversation(sent.conversation_id)
# assignment_status tells you whether the recipient is still connected:
# anything other than "active" means sends/reactions will be refused
# until they reconnect through triage.
print(convo.assignment_status)

# Who is actively connected to this identity right now (paginated)?
connections = identity.list_imessage_assignments(limit=20)
for a in connections:
    print(a.remote_number, a.status, a.created_at)

# Tapback reactions. Sends accept the classic six (love, like, dislike,
# laugh, emphasize, question); inbound can also be "custom" with the
# literal emoji in custom_emoji.
identity.send_imessage_reaction(message_id=msgs[0].id, reaction="like")

# Live tapbacks come back on message reads, oldest first.
for r in msgs[0].reactions or []:
    print(r.direction, r.reaction, r.custom_emoji)

# Read receipts + typing indicator
identity.mark_imessage_conversation_read(sent.conversation_id)
identity.send_imessage_typing(sent.conversation_id)

# Media: upload bytes (max 10 MiB), then send the returned URL (one per message)
upload = identity.upload_imessage_media(
    content=open("photo.jpg", "rb").read(),
    filename="photo.jpg",
    content_type="image/jpeg",
)
identity.send_imessage(to="+15551234567", media_urls=[upload.media_url])
```

Contact rules are scoped to the **identity**, including when it has a dedicated number:

```python
from inkbox import IMessageRuleAction

rule = inkbox.imessage_contact_rules.create(
    "my-agent", action=IMessageRuleAction.BLOCK, match_target="+15559999999",
)
rules = inkbox.imessage_contact_rules.list("my-agent")
inkbox.imessage_contact_rules.update("my-agent", rule.id, status="paused")  # admin-only
inkbox.imessage_contact_rules.delete("my-agent", rule.id)                   # admin-only
all_rules = inkbox.imessage_contact_rules.list_all()                        # admin-only, org-wide
```

Inbound messages and reactions arrive via **identity-owned** webhook subscriptions — see Webhooks below.

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The registry is updated automatically when recipients text `START` / `STOP` to any of your numbers (`source="sms"`). Reads are admin-only; writes are admin-only **and** require your org to be on its own active, customer-managed 10DLC campaign (Inkbox-default-campaign orgs share consent state and get `409 customer_campaign_required` on writes — `source="api"` writes record an audit event).

```python
from inkbox import SmsOptInStatus

# List your org's consent rows, newest-updated first (server caps limit at 200)
rows = inkbox.sms_opt_ins.list(limit=50)
opted_out = inkbox.sms_opt_ins.list(status=SmsOptInStatus.OPTED_OUT)

# Look up one recipient — 404 → InkboxAPIError if no row exists
row = inkbox.sms_opt_ins.get("+15551234567")
print(row.status, row.source, row.opted_in_at, row.opted_out_at)

# Programmatic writes (customer-managed 10DLC campaign only)
inkbox.sms_opt_ins.opt_in("+15551234567")
inkbox.sms_opt_ins.opt_out("+15551234567")
```

## Vault

Encrypted credential vault with client-side Argon2id key derivation and AES-256-GCM encryption. The server never sees plaintext secrets. Requires `argon2-cffi` and `cryptography` (included as dependencies).

### Initialize

```python
# Initialize a new vault (org ID is fetched automatically from the API key)
result = inkbox.vault.initialize("my-Vault-key-01!")
print(result.vault_id, result.vault_key_id)
for code in result.recovery_codes:
    print(code)  # save these immediately — they cannot be retrieved again
```

### Unlock & Read

```python
from inkbox import LoginPayload, APIKeyPayload, SSHKeyPayload, OtherPayload

# Unlock with a vault key — derives key via Argon2id, decrypts all secrets
unlocked = inkbox.vault.unlock("my-Vault-key-01!")

# Optionally filter to secrets an agent identity has access to
unlocked = inkbox.vault.unlock("my-Vault-key-01!", identity_id="agent-uuid")

# All decrypted secrets from the unlock bundle
for secret in unlocked.secrets:
    print(secret.name, secret.secret_type)
    print(secret.payload)   # LoginPayload, APIKeyPayload, SSHKeyPayload, or OtherPayload

# Fetch and decrypt a single secret by ID
secret = unlocked.get_secret("secret-uuid")
print(secret.payload.username, secret.payload.password)   # for login type
```

### Create & Update

```python
# Create a login secret (secret_type inferred from payload type)
unlocked.create_secret(
    "AWS Production",
    LoginPayload(password="s3cret", username="admin", url="https://aws.amazon.com"),
    description="Production IAM user",
)

# Create an API key secret
unlocked.create_secret(
    "GitHub PAT",
    APIKeyPayload(api_key="ghp_xxx"),
)

# Create an SSH key secret
unlocked.create_secret(
    "Deploy Key",
    SSHKeyPayload(private_key="-----BEGIN OPENSSH PRIVATE KEY-----..."),
)

# Create a freeform secret
unlocked.create_secret("Misc", OtherPayload(data="any freeform content"))

# Update name/description and/or re-encrypt payload
unlocked.update_secret("secret-uuid", name="New Name")
unlocked.update_secret("secret-uuid", payload=LoginPayload(password="new", username="new"))

# Delete
unlocked.delete_secret("secret-uuid")
```

### Metadata (no unlock needed)

```python
info = inkbox.vault.info()                                   # VaultInfo
keys = inkbox.vault.list_keys()                              # list[VaultKey]
keys = inkbox.vault.list_keys(key_type="recovery")           # filter by type
secrets = inkbox.vault.list_secrets()                         # list[VaultSecret] (metadata only)
secrets = inkbox.vault.list_secrets(secret_type="login")     # filter by type
inkbox.vault.delete_secret("secret-uuid")                    # delete without unlocking
```

### Payload Types

| Type | Class | Fields |
|------|-------|--------|
| `login` | `LoginPayload` | `password`, `username?`, `email?`, `url?`, `notes?` |
| `api_key` | `APIKeyPayload` | `api_key`, `endpoint?`, `notes?` |
| `key_pair` | `KeyPairPayload` | `access_key`, `secret_key`, `endpoint?`, `notes?` |
| `ssh_key` | `SSHKeyPayload` | `private_key`, `public_key?`, `fingerprint?`, `passphrase?`, `notes?` |
| `other` | `OtherPayload` | `data` |

`secret_type` is immutable after creation. To change it, delete and recreate.

### Agent Credentials (identity-scoped)

Agent-facing credential access — typed, identity-scoped. The vault stays as the admin surface; `identity.credentials` is the agent runtime surface.

```python
from inkbox import Credentials

# Unlock the vault first (stores state on the client)
inkbox.vault.unlock("my-Vault-key-01!")

identity = inkbox.get_identity("support-bot")

# Discovery — returns list[DecryptedVaultSecret] with name/metadata
all_creds = identity.credentials.list()
logins    = identity.credentials.list_logins()
api_keys  = identity.credentials.list_api_keys()
ssh_keys  = identity.credentials.list_ssh_keys()
key_pairs = identity.credentials.list_key_pairs()

# Access by UUID — returns typed payload directly
login    = identity.credentials.get_login("secret-uuid")      # → LoginPayload
api_key  = identity.credentials.get_api_key("secret-uuid")    # → APIKeyPayload
ssh_key  = identity.credentials.get_ssh_key("secret-uuid")    # → SSHKeyPayload
key_pair = identity.credentials.get_key_pair("secret-uuid")   # → KeyPairPayload

# Generic access — returns DecryptedVaultSecret
secret = identity.credentials.get("secret-uuid")
```

- Requires `inkbox.vault.unlock()` first — raises `InkboxError` if vault is not unlocked
- Results are filtered to secrets the identity has access to (via access rules)
- Cached after first access; call `identity.refresh()` to clear the cache
- `get_*` raises `KeyError` if not found, `TypeError` if wrong secret type

## One-Time Passwords (TOTP)

TOTP secrets are stored inside `LoginPayload.totp` in the encrypted vault. Codes are generated client-side — no server call needed.

### From an agent identity (recommended)

```python
from inkbox.vault.totp import parse_totp_uri
from inkbox.vault.types import LoginPayload

# Create a login with TOTP
secret = identity.create_secret(
    name="GitHub",
    payload=LoginPayload(
        username="user@example.com",
        password="s3cret",
        totp=parse_totp_uri("otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"),
    ),
)

# Generate TOTP code
code = identity.get_totp_code(str(secret.id))
print(code.code)              # e.g. "482901"
print(code.seconds_remaining) # e.g. 17

# Add/replace TOTP on existing login
identity.set_totp(secret_id, "otpauth://totp/...?secret=...")

# Remove TOTP
identity.remove_totp(secret_id)
```

### From the unlocked vault (admin-only)

```python
unlocked = inkbox.vault.unlock("my-Vault-key-01!")

# Same methods available on UnlockedVault
unlocked.set_totp(secret_id, totp_config_or_uri)
unlocked.remove_totp(secret_id)
code = unlocked.get_totp_code(secret_id)
```

### TOTPCode fields

| Field | Type | Description |
|---|---|---|
| `code` | `str` | The OTP code (e.g. `"482901"`) |
| `period_start` | `int` | Unix timestamp when the code became valid |
| `period_end` | `int` | Unix timestamp when the code expires |
| `seconds_remaining` | `int` | Seconds until expiry |

## Admin-only Resources

### Mailboxes (`inkbox.mailboxes`)

```python
mailboxes = inkbox.mailboxes.list()
mailbox   = inkbox.mailboxes.get("abc@inkboxmail.com")

# To rename, use `identity.update(display_name="New Name")` — the
# mailbox PATCH endpoint hard-rejects `display_name` with a 422. To
# attach a webhook receiver, see "Webhooks" below.

# DEPRECATED channel path — the mail filter mode now lives on the identity.
# Prefer `identity.update(mail_filter_mode="whitelist")` (which does NOT return
# a change notice). This legacy mailbox flip still works and still returns one:
updated = inkbox.mailboxes.update(mailbox.email_address, filter_mode="whitelist")
if updated.filter_mode_change_notice:
    # Populated when filter_mode actually changed — tells you how many
    # rules are now redundant under the new mode.
    n = updated.filter_mode_change_notice
    print(n.redundant_rule_count, n.redundant_rule_action, n.new_filter_mode)

# Mailbox responses now also carry mailbox.agent_identity_id when the
# mailbox is linked to an identity.
# `mailbox.sending_domain` is the bare domain the mailbox sends from
# (platform default or a verified custom domain — see "Custom email domains" below).

# Storage (list / get / update all carry these):
print(mailbox.storage_used_bytes)               # bytes stored, e.g. 1288490188
print(mailbox.storage_limit_bytes)              # plan cap, e.g. 2147483648 (2 GiB), or None
used_gib = mailbox.storage_used_bytes / 1024**3  # caps are BINARY — GiB, not GB
# Over-cap sends raise StorageLimitExceededError (402) — see "Storage cap (402)".

results = inkbox.mailboxes.search(mailbox.email_address, q="invoice", limit=20)
# Mailboxes are deleted via the owning identity's cascade — there is no standalone delete:
#   identity.delete()  # removes the mailbox + tunnel atomically (cascade)
```

### Custom email domains (`inkbox.domains`)

If your org has registered custom sending domains in the console, list them
and (admin-only) set the org default. New mailboxes inherit the org default
unless you pass ``sending_domain_id`` (standalone) or ``sending_domain``
(identity).

```python
from inkbox import SendingDomainStatus

verified = inkbox.domains.list(status=SendingDomainStatus.VERIFIED)

# Admin-scoped API key only — non-admin keys get 403.
# Returns the bare new default domain name (or None when reverted to platform).
new_default = inkbox.domains.set_default("mail.acme.com")
# Pass the platform domain (e.g. "inkboxmail.com" in prod) to clear the org default.

# Identity create: pick by bare domain name (not id).
inkbox.create_identity("sales-bot", sending_domain="mail.acme.com")
# Force the platform default:
inkbox.create_identity("sales-bot-2", sending_domain=None)
# Standalone mailbox creation is gone — provision via create_identity above.
```

### Phone Numbers (`inkbox.phone_numbers`)

```python
numbers = inkbox.phone_numbers.list()
number  = inkbox.phone_numbers.get("phone-number-uuid")
number  = inkbox.phone_numbers.provision(agent_handle="my-agent", type="local", state="NY")  # local only; toll_free is rejected (422)

inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="webhook",            # "webhook", "auto_accept", "auto_reject", or "hosted_agent"
    incoming_call_webhook_url="https://...",
)
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="auto_accept",
    client_websocket_url="wss://...",
)
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="hosted_agent",       # no URL — Voice AI answers
)

hits = inkbox.phone_numbers.search_transcripts(number.id, q="refund", party="remote", limit=50)
inkbox.phone_numbers.release(number.id)
```

Phone numbers carry the same `filter_mode` / `agent_identity_id` / `filter_mode_change_notice` fields as mailboxes; flipping `filter_mode` here is the **deprecated** channel path (admin-only; returns a change-notice when the value actually changed). Prefer `identity.update(phone_filter_mode="whitelist")`, which sets the mode on the identity and does not return a change notice.

## Contact Rules

Allow/block lists are scoped to the **agent identity** (mirroring iMessage), addressed by `agent_handle`. The identity's `mail_filter_mode` / `phone_filter_mode` decides whether each channel's rules act as a whitelist or blacklist. Mail matches by exact email or domain; phone matches by exact E.164 number. Returned rows are `MailIdentityContactRule` / `PhoneIdentityContactRule`, keyed by `rule.agent_identity_id` (not a mailbox/phone-number id).

```python
from inkbox import (
    MailRuleAction, MailRuleMatchType, PhoneRuleAction, PhoneRuleMatchType,
    DuplicateContactRuleError,
)

identity = inkbox.get_identity("sales-agent")

# Mail rules via the identity convenience methods. New rules always start
# active; call `update(..., status="paused")` afterwards to pause one.
rule = identity.create_mail_contact_rule(
    action=MailRuleAction.ALLOW,         # or BLOCK
    match_type=MailRuleMatchType.DOMAIN, # or EXACT_EMAIL
    match_target="example.com",
)
identity.list_mail_contact_rules()
identity.get_mail_contact_rule(rule.id)
identity.update_mail_contact_rule(rule.id, status="paused")  # admin-only
identity.delete_mail_contact_rule(rule.id)                   # admin-only

# Phone rules — same shape, only match_type="exact_number" is supported.
# Phone helpers require the identity to have a phone number (else InkboxError).
identity.create_phone_contact_rule(
    action=PhoneRuleAction.BLOCK,
    match_target="+15551234567",
    match_type=PhoneRuleMatchType.EXACT_NUMBER,
)
identity.list_phone_contact_rules()

# Equivalent org-level resources, keyed by agent_handle, with an org-wide list_all:
inkbox.mail_identity_contact_rules.create(
    "sales-agent", action="allow", match_type="domain", match_target="example.com",
)
inkbox.mail_identity_contact_rules.list("sales-agent")
inkbox.mail_identity_contact_rules.list_all(agent_identity_id=str(identity.id))  # admin-only, org-wide
inkbox.phone_identity_contact_rules.list_all()                                   # admin-only, org-wide

# Duplicate (match_type, match_target) on the same identity raises 409:
try:
    identity.create_mail_contact_rule(action="allow", match_type="domain", match_target="example.com")
except DuplicateContactRuleError as e:
    print(e.existing_rule_id)   # UUID of the rule that already matched
```

### Filter mode

The whitelist/blacklist mode lives on the identity. Flip it with `identity.update`
(admin-only). Unlike the deprecated channel update, this does **not** return a
`FilterModeChangeNotice`. `phone_filter_mode` requires the identity to have a phone
number (else a 422).

```python
identity.update(mail_filter_mode="whitelist", phone_filter_mode="blacklist")
print(identity.mail_filter_mode, identity.phone_filter_mode)
```

### Deprecated: per-mailbox / per-number rules

The legacy per-mailbox `inkbox.mail_contact_rules` and per-number
`inkbox.phone_contact_rules` resources still work but hit deprecated server routes
(Sunset 2026-08-31). Prefer the identity-keyed surface above.

```python
# Deprecated — per-mailbox mail rule:
inkbox.mail_contact_rules.create(
    mailbox.email_address,
    action="allow", match_type="domain", match_target="example.com",
)
inkbox.mail_contact_rules.list_all(mailbox_id=str(mailbox.id))
# Deprecated — per-number phone rule:
inkbox.phone_contact_rules.create(
    number.id, action="block", match_type="exact_number", match_target="+15551234567",
)
```

## Contacts

Organization-wide address book with lifecycle review, memory, correspondence, and vCard import/export.

```python
from inkbox import (
    Contact, ContactCorrespondenceOptions, ContactEmail, ContactPhone,
    ContactAddress, ContactReviewStatus,
)

# CRUD
contact = inkbox.contacts.create(
    given_name="Ada",
    family_name="Lovelace",
    emails=[ContactEmail(label="work", value="ada@example.com")],
    phones=[ContactPhone(label="mobile", value="+15551234567")],
)
inkbox.contacts.get(str(contact.id))
inkbox.contacts.list(
    q="ada", order="recent", review_status=[ContactReviewStatus.CONFIRMED]
)
inkbox.contacts.update(str(contact.id), job_title="Analyst")
inkbox.contacts.delete(str(contact.id))

# Reverse-lookup — exactly one filter required (else ValueError before HTTP)
inkbox.contacts.lookup(email="ada@example.com")
inkbox.contacts.lookup(email_domain="example.com")
inkbox.contacts.lookup(phone="+15551234567")
inkbox.contacts.lookup(email_contains="ada")
inkbox.contacts.lookup(phone_contains="555")

# Compatibility access information is read-only
inkbox.contacts.access.list(str(contact.id))

# Facts, citations, correspondence, and duplicate merging
facts = inkbox.contacts.facts.list(str(contact.id))
if facts and facts[0].citations and facts[0].citations[0].source_url:
    print(facts[0].citations[0].source_url)
history = inkbox.contacts.correspondence.get(
    str(contact.id),
    ContactCorrespondenceOptions(identity_id="identity-uuid", channels=["email", "sms"]),
)
survivor = inkbox.contacts.merge(
    str(contact.id), losing_contact_ids=["duplicate-contact-uuid"]
)

# vCards
result = inkbox.contacts.vcards.import_vcards(vcf_text)   # bulk, ≤5 MiB, ≤1000 cards
print(result.created_ids)     # list[UUID]
for item in result.errors:    # list[ContactImportResultItem]
    print(item.index, item.error)

vcf = inkbox.contacts.vcards.export_vcard(str(contact.id))  # vCard 4.0 string
```

## Notes

Admin-only free-form notes with per-identity access grants. Identities must be granted access explicitly — there is no wildcard for notes.

```python
note = inkbox.notes.create(body="Customer prefers email follow-up.", title="Ada")
inkbox.notes.get(str(note.id))
inkbox.notes.list(q="email", identity_id="agent-uuid", order="recent", limit=50)
inkbox.notes.update(str(note.id), body="Updated body")
inkbox.notes.update(str(note.id), title=None)   # clear title (body cannot be null)
inkbox.notes.delete(str(note.id))

# Access grants (admin + JWT only)
inkbox.notes.access.list(str(note.id))
inkbox.notes.access.grant(str(note.id), identity_id="agent-uuid")
inkbox.notes.access.revoke(str(note.id), "agent-uuid")
```

## Whoami

```python
# Check the authenticated caller's identity
info = inkbox.whoami()
print(info.auth_type)        # "api_key" or "jwt"
print(info.organization_id)
```

Returns `WhoamiApiKeyResponse` (with `key_id`, `label`, `creator_type`, `auth_subtype`, etc.) or `WhoamiJwtResponse` (with `email`, `org_role`, etc.) based on `auth_type`.

For branching on API-key scope, compare against the exported constants:

```python
from inkbox import (
    AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED,
    AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
    AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED,
)

if info.auth_type == "api_key" and info.auth_subtype == AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED:
    ...   # admin-only operations (filter_mode flips, rule updates/deletes, etc.)
```

## Tunnels

Bring a local process online at a public `https://{name}.inkboxwire.com` URL. Outbound HTTP/2 only — no inbound port to open. POSIX only.

```python
# Forward to a local URL (edge mode — Inkbox terminates TLS at the edge)
listener = inkbox.tunnels.connect(
    name="my-app",
    forward_to="http://127.0.0.1:8080",
)
print(listener.public_url)        # https://my-app.inkboxwire.com
listener.wait()                   # blocks until close()/Ctrl-C

# Forward to an in-process ASGI app (FastAPI / Starlette / your own)
listener = inkbox.tunnels.connect(name="my-app", forward_to=fastapi_app)

# Passthrough TLS is fixed at create time (see below); the connect() call is
# identical. In passthrough the SDK auto-signs a cert via the control plane.
listener = inkbox.tunnels.connect(
    name="my-app",
    forward_to="http://127.0.0.1:8080",
)
```

Async usage:

```python
async with ...:
    listener = inkbox.tunnels.connect(name="my-app", forward_to="http://127.0.0.1:8080")
    try:
        await listener.serve_forever()
    finally:
        await listener.aclose()
```

`wait()`/`close()` and `serve_forever()`/`aclose()` are mutually exclusive — pick one pair.

Tunnels are provisioned atomically by `inkbox.create_identity(...)`; there is no standalone `create` / `delete` / `restore` / `rotate_secret` surface. For passthrough, opt in at create time: `inkbox.create_identity("my-app", tunnel={"tls_mode": "passthrough"})` — `tls_mode` is fixed at create.

Reads + edit:

```python
inkbox.tunnels.list()                       # list[Tunnel]
inkbox.tunnels.get("tunnel-uuid")
inkbox.tunnels.update(                      # metadata-only
    "tunnel-uuid",
    metadata={"team": "gtm"},
)
# Passthrough only:
inkbox.tunnels.sign_csr("tunnel-uuid", csr_pem=csr_bytes)
```

Data-plane auth uses the same `api_key` the `Inkbox` client was constructed with — admin-scoped or identity-scoped (matching the tunnel's identity). Mint a per-agent identity-scoped key via `inkbox.api_keys.create(scoped_identity_id=...)`. Selected `connect()` kwargs: `pool_size` (1–32), `state_dir` (default `~/.inkbox/tunnels/{name}`), `on_status` callback, `allow_remote_forwarding=False` (loopback-only allowlist), `forward_to_verify_tls=True`. In passthrough mode the state dir holds the per-tunnel private key — treat it like an SSH key dir.

For full options, lifecycle notes, and TS examples, see `skills/inkbox-tunnels/SKILL.md`.

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox or phone number — no separate registration.

```python
import json
from typing import cast
from inkbox import (
    verify_webhook,
    MailWebhookPayload, TextWebhookPayload, PhoneIncomingCallWebhookPayload,
)

# Each agent identity has its own webhook signing key. Create/rotate it
# (plaintext returned once — save it), or read its status:
key = identity.create_signing_key()                        # → SigningKey
status = identity.get_signing_key_status()                 # → SigningKeyStatus(configured, created_at)
# Org-level resource, keyed by agent_handle:
key = inkbox.signing_keys.create_or_rotate("sales-agent")
status = inkbox.signing_keys.get_status("sales-agent")
# DEPRECATED: org-level inkbox.create_signing_key() — with an agent-scoped key it
# still rotates that identity's key; with an admin key the server returns 409.

# Verify, then parse + discriminate
if not verify_webhook(payload=raw_body, headers=request.headers, secret="whsec_..."):
    raise HTTPException(status_code=403)
payload = cast(TextWebhookPayload, json.loads(raw_body))
if payload["event_type"] == "text.delivery_failed":
    msg = payload["data"]["text_message"]
    logger.error("SMS failed: %s (%s)", msg["error_code"], msg["error_detail"])
```

Algorithm: HMAC-SHA256 over `"{request_id}.{timestamp}.{body}"`.

**Event taxonomy:**

- **Mail** (envelope, fire-and-forget) — `message.received`, `message.sent`, `message.forwarded`, `message.delivered`, `message.bounced`, `message.failed`. Subscribe via `inkbox.webhooks.subscriptions.create(mailbox_id=..., url=..., event_types=[...])`. On `message.received`, `data["message"]` includes the plain-text `body` (whole under a size cap, else a prefix with `body_truncated: True` / `body_state: "truncated"`); when truncated, fetch the full message with `inkbox.messages.get(message["email_address"], message["id"])` — use `id` (row id), not `message_id` (RFC 5322 header). These fields are present-with-`null` on the other events and absent on pre-feature payloads.
- **Text** (envelope, fire-and-forget) — `text.received`, `text.sent`, `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed`. Subscribe via `inkbox.webhooks.subscriptions.create(phone_number_id=..., url=..., event_types=[...])`. The text-message body carries `delivery_status` as an outbound message-level rollup; 1:1 traffic also hoists `error_code`, `error_detail`, `sent_at`, `delivered_at`, and `failed_at`. On group outbound those legacy detail fields are `None` and per-recipient state lives in `recipients[]`.
- **iMessage** (envelope, fire-and-forget) — `imessage.received`, `imessage.reaction_received`, plus the outbound delivery lifecycle `imessage.sent`, `imessage.delivered`, `imessage.delivery_failed` (declined/error; details on the message object). Subscribe via `inkbox.webhooks.subscriptions.create(agent_identity_id=..., url=..., event_types=[...])` — owned by the **agent identity**, since shared iMessage pool numbers are not org resources. `data["message"]` is populated on `imessage.received` and the three delivery-lifecycle events; `data["reaction"]` on `imessage.reaction_received`. Fan-out only happens while the identity is active and `imessage_enabled`; contact-rule-blocked traffic is never delivered.
- **Call lifecycle** (envelope, fire-and-forget + replayable) — `call.ended`, owned by the **agent identity** (like iMessage). Subscribe via `inkbox.webhooks.subscriptions.create(agent_identity_id=..., url=..., event_types=["call.ended"])`. `CallEndedWebhookPayload.data` carries the `call` (`WebhookPhoneCall`, with derived `duration_seconds`), resolved `contacts` / `agent_identities`, an always-present `transcript_url` (authoritative verbatim, fetch with an admin API key), and an inline `transcript` block (`WebhookCallTranscript`, middle-cut/abridged) present when the platform captured a transcript for the call, otherwise `None` — discriminate a turn from the abridgment marker on `"marker" in entry`. Voice AI call fields (all optional so pre-Voice AI payloads parse): `data["call"]` carries `mode` / `reason`; `data` carries `outcome` (`"completed" | "no_answer" | "declined" | "failed"`, `None` iff `mode` is `client_websocket`) and `post_call_action_items` (open items only, seq-ascending, mirroring `PhoneCall.post_call_action_items`). Voice AI calls fire `call.ended` on **every** terminal state (including never-connected ones like `no_answer`), not just connected calls. An identity may hold a `call.ended` sub and an `imessage.*` sub independently, but one subscription carries a single channel.
- **Inbound call** (flat, synchronous) — `PhoneIncomingCallWebhookPayload` on a phone number's `incoming_call_webhook_url`. Not subscribable; the URL stays on the phone-number resource because the response (`action: "answer" | "reject"` + optional `client_websocket_url`) decides the call's fate. Non-200, invalid bodies, and timeouts are treated as "decline routing" by Inkbox. (Contrast `call.ended` above, which is the replayable post-call fan-out.)

**Subscription resource:** `inkbox.webhooks.subscriptions.{list,get,create,update,delete}`. Each subscription names exactly one owner (mailbox, phone number, **or** agent identity), one HTTPS destination URL, and a non-empty subset of the catalog's event types. Multiple subscriptions on the same owner fan out independently (cap: 20 active per owner). The SDK runs structural + prefix validation client-side (exactly-one-FK, non-empty distinct events, no `phone.incoming_call`, and one channel per subscription — `message.` / `text.` / `imessage.` / `call.` prefix matching the owner's channel, where an agent identity owns both `imessage.*` and `call.ended`) so most shape mistakes surface as `ValueError` before the request leaves the client. The server remains authoritative for the exact event-name enum, so a typo with a valid prefix (e.g. `message.received_typo`) passes the SDK's check and is rejected as 422 by the server.

`create(...)` returns a `WebhookSubscriptionCreateResponse`. The **first** subscription created for an identity that has no signing key yet carries that identity's `signing_key` **once** (otherwise `None`) — capture it then, it cannot be retrieved again. Every subscription (read or created) also carries `owner_identity_id`, the resolved owning agent identity (mail/phone/iMessage).

```python
created = inkbox.webhooks.subscriptions.create(
    mailbox_id=str(mailbox.id), url="https://example.com/hook", event_types=["message.received"],
)
print(created.owner_identity_id)
if created.signing_key:                # populated once if the identity had no key yet
    save_secret(created.signing_key)
```

**Conversation context:** opt a subscription into per-class history on **received** events (`message.received`, `text.received`, `imessage.received`) with `context_config` — `email` / `texts` / `calls`, each `{"mode": "count", "count": N}` (1..50) or `{"mode": "window", "hours": H}` (1..168). On `update` it is tri-state: omit = unchanged, `None` = clear, dict = replace. Received-event payloads then carry an optional `data["context"]` keyed by class; optional fields are absent, not `null`, so read with `.get(...)`. A skipped class ships `items: []` plus a `skipped` reason; call transcript entries are turns or an abridgment marker, discriminated on `"marker" in entry`. Config types `WebhookContextConfig` / `WebhookContextClassConfig` and receiver wire shapes `WebhookContextWire` / `WebhookContextBlockWire` / `WebhookTranscriptEntryWire` (and the item wire types) are exported from `inkbox`.

```python
inkbox.webhooks.subscriptions.create(
    mailbox_id=str(mailbox.id), url="https://example.com/hook",
    event_types=["message.received"],
    context_config={"email": {"mode": "count", "count": 10}},
)
inkbox.webhooks.subscriptions.update(created.id, context_config=None)  # clear
```

**Mail contact / identity resolution:** `data["contacts"]` and `data["agent_identities"]` are lists of `{"bucket", "address", "id", ...}` entries (always present, possibly empty). Inbound events resolve `from` + every `cc`; outbound events resolve every `to` + `cc` + `bcc`. Pair entries to the source field by `(bucket, address)`. Outbound payloads also carry `data["message"]["bcc_addresses"]` (`None` on inbound, since BCC is not visible to recipients).

**Phone/text contact / identity resolution:** `data["contacts"]` (text) and top-level `contacts` (inbound call) are lists of `{"id", "name"}` matches; `data["agent_identities"]` mirrors that for matched agent identities. Scoped to the identity that owns the receiving phone number; both default to `[]` when nothing matches. Group text events carry per-recipient delivery rows in `data["text_message"]["recipients"]`; **outbound group lifecycle** events name the event target in `data["recipient_phone_number"]` (one webhook per recipient leg). Inbound and outbound 1:1 events leave `data["recipient_phone_number"]` as `None` — the singular peer is already in `data["text_message"]["remote_phone_number"]` (inbound) or `data["text_message"]["recipients"][0]` (outbound 1:1).

Exported wire types: `MailWebhookPayload`, `TextWebhookPayload`, `IMessageWebhookPayload`, `PhoneIncomingCallWebhookPayload`, `WebhookContact`, `WebhookAgentIdentity`, `WebhookMailContact`, `WebhookMailAgentIdentity`, `TextMessageRecipientWire`, the conversation-context shapes (`WebhookContextWire`, `WebhookContextBlockWire`, `WebhookTranscriptEntryWire`, and item wire types), plus event-type `Literal` unions (`MailWebhookEventType`, `TextWebhookEventType`, `IMessageWebhookEventType`) and wire enums (`MessageStatus`, `CallStatusWire`, `HangupReasonWire`, `SmsDeliveryStatusWire`, etc.). All fields are snake_case `TypedDict`s to match the raw JSON body.

## Error Handling

```python
from inkbox import (
    InkboxAPIError,
    DuplicateContactRuleError,
    RedundantContactAccessGrantError,
    StorageLimitExceededError,
)

try:
    identity = inkbox.get_identity("unknown")
except InkboxAPIError as e:
    print(e.status_code)   # HTTP status (e.g. 404)
    print(e.detail)        # str for legacy errors, dict for structured ones
```

`InkboxAPIError.detail` can now be a `dict` for structured responses (e.g. contact-rule / access conflicts). Catch the narrower subclasses when you need the parsed fields:

- `DuplicateContactRuleError` — 409 when creating a contact rule with an already-taken `(match_type, match_target)` on the same resource. Exposes `.existing_rule_id: UUID`.
- `RedundantContactAccessGrantError` — 409 when an identity-viewer grant is redundant (e.g. a specific viewer on top of an active wildcard). Exposes `.error` and `.detail_message`.
- `StorageLimitExceededError` — 402 when a send / reply-all / forward would push the mailbox past its plan storage cap. Exposes `.message`, `.upgrade_url`, and `.limit_bytes`. Delete messages or threads to free space (immediate), or upgrade. A `402` whose `detail` is a plain string stays a plain `InkboxAPIError`.

## Key Conventions

- All method and property names are **snake_case**
- `iter_emails()` / `iter_unread_emails()` return `Iterator[Message]` — auto-paginated, lazy
- `list_calls()` returns `list[PhoneCall]` — offset pagination, not an iterator
- To clear a nullable field (e.g. webhook URL), pass `field=None`
- The `Inkbox` client **must** be used as a context manager (`with` statement) or `.close()` called manually
- Mail/phone methods on `AgentIdentity` raise `InkboxError` if the relevant channel isn't assigned

# inkbox

Python SDK for the [Inkbox API](https://inkbox.ai/docs) — API-first communication infrastructure for AI agents (email, phone, identities, encrypted vault — login credentials, API keys, key pairs, SSH keys, OTP, etc.).

## Install

```bash
pip install inkbox
```

Requires Python ≥ 3.11.

## Authentication

You'll need an API key to use this SDK. Get one at [inkbox.ai/console](https://inkbox.ai/console).

## Quick start

```python
import os
from inkbox import Inkbox

with Inkbox(
    api_key=os.environ["INKBOX_API_KEY"],
    vault_key=os.environ.get("INKBOX_VAULT_KEY"),
) as inkbox:
    # Create an agent identity with a linked mailbox
    identity = inkbox.create_identity("support-bot", display_name="Support Bot")
    identity.provision_phone_number(type="toll_free")

    # Send email directly from the identity
    identity.send_email(
        to=["customer@example.com"],
        subject="Your order has shipped",
        body_text="Tracking number: 1Z999AA10123456784",
    )

    # Place an outbound call
    identity.place_call(
        to_number="+18005559999",
        client_websocket_url="wss://my-app.com/voice",
    )

    # Read inbox
    for message in identity.iter_emails():
        print(message.subject)

    # List calls
    calls = identity.list_calls()

    # Access credentials (vault unlocked at construction)
    for login in identity.credentials.list_logins():
        print(login.name, login.payload.username)
```

## Authentication

| Argument | Type | Default | Description |
|---|---|---|---|
| `api_key` | `str` | required | Your `ApiKey_...` token |
| `base_url` | `str` | API default | Override for self-hosting or testing |
| `timeout` | `float` | `30.0` | Request timeout in seconds |

Use `with Inkbox(...) as inkbox:` (recommended) or call `inkbox.close()` manually to clean up HTTP connections.

---

## Agent Signup

Agents can self-register without a pre-existing API key. All signup methods are **class methods** — no `Inkbox` instance required.

```python
from inkbox import Inkbox

# Sign up (public — no API key needed)
result = Inkbox.signup(
    human_email="john@example.com",
    note_to_human="Hey John, this is your sales bot signing up!",  # required
    display_name="Sales Agent",          # optional
    agent_handle="sales-agent",          # optional
    email_local_part="sales.agent",      # optional
)
api_key = result.api_key          # save — shown only once
email = result.email_address      # e.g. "sales-agent-a1b2c3@inkboxmail.com"
handle = result.agent_handle      # e.g. "sales-agent-a1b2c3"

# Verify (after human shares the 6-digit code from the email)
Inkbox.verify_signup(api_key, verification_code="483921")

# Resend verification email (5-minute cooldown)
Inkbox.resend_signup_verification(api_key)

# Check status and restrictions
status = Inkbox.get_signup_status(api_key)
print(status.claim_status)                    # "agent_unclaimed" or "agent_claimed"
print(status.restrictions.max_sends_per_day)  # 10 (unclaimed) or 500 (claimed)
```

| Method | Auth | Returns |
|---|---|---|
| `Inkbox.signup(human_email, *, note_to_human, display_name=None, agent_handle=None, email_local_part=None)` | None | `AgentSignupResponse` |
| `Inkbox.verify_signup(api_key, verification_code)` | API key | `AgentSignupVerifyResponse` |
| `Inkbox.resend_signup_verification(api_key)` | API key | `AgentSignupResendResponse` |
| `Inkbox.get_signup_status(api_key)` | API key | `AgentSignupStatusResponse` |

`signup()` requires `human_email` and `note_to_human`. `display_name`, `agent_handle`, and `email_local_part` are optional. All methods accept optional `base_url` and `timeout` keyword arguments.

> **Note:** Unclaimed agents have a limited send quota and can only email the `human_email` specified at signup. After verification or human approval in the console, full capabilities are unlocked.

> **Note:** The `organization_id` returned at signup may change after verification or human approval. Always use the `organization_id` from the most recent response (`verify_signup` or `resend_signup_verification`) rather than caching the value from the initial `signup()` call.

---

## Identities

`inkbox.create_identity()` and `inkbox.get_identity()` return an `AgentIdentity` object that holds the identity's channels and exposes convenience methods scoped to those channels.

```python
# create_identity atomically provisions the mailbox AND the tunnel —
# both come back on the response. Phone numbers stay opt-in.
identity = inkbox.create_identity(
    "sales-bot",
    display_name="Sales Bot",
    description="Sales-outreach agent",
)
phone = identity.provision_phone_number(type="toll_free")

print(identity.email_address)            # sales-bot@inkboxmail.com
print(identity.tunnel.public_host)       # sales-bot.inkboxwire.com
print(phone.number)

# Pin the identity's mailbox to a verified custom sending domain
# (bare name; see "Custom Sending Domains" below).
inkbox.create_identity("sales-bot-2", sending_domain="mail.acme.com")

# Provision a passthrough tunnel (tls_mode is fixed at create time)
from inkbox import IdentityTunnelCreateOptions
inkbox.create_identity("sales-bot-pt", tunnel=IdentityTunnelCreateOptions(tls_mode="passthrough"))

# Get an existing identity
identity = inkbox.get_identity("sales-bot")
identity.refresh()  # re-fetch channels from API

# List all identities for your org
all_identities = inkbox.list_identities()

# Update handle, display name, description, status. For description,
# pass None to clear and omit the kwarg to leave untouched.
identity.update(status="paused")
identity.update(new_handle="sales-bot-v2")
identity.update(display_name="New Name", description="New blurb")
identity.update(description=None)  # clear

# Release the phone number (vendor + local).
identity.release_phone_number()

# Delete (cascades to mailbox + tunnel + phone-number release; revokes scoped API keys).
identity.delete()
```

### Identity visibility

Control which other agent identities can see this identity in API responses.
Humans and admins always see every identity regardless.

```python
identity = inkbox.get_identity("sales-bot")

# List the current visibility rules. Either a single wildcard row
# (viewer_identity_id is None — every active identity sees it) or
# explicit per-viewer rows. An empty list means no agent can see it.
rules = identity.list_access()

# Grant one viewer identity visibility
viewer = inkbox.get_identity("support-bot")
identity.grant_access(viewer.id)

# Make it visible to every active identity in the org (wildcard)
identity.grant_access(None)

# Revoke one viewer (keyed by the viewer identity's UUID)
identity.revoke_access(viewer.id)
```

---

## Mail

```python
# Send an email (plain text and/or HTML)
sent = identity.send_email(
    to=["user@example.com"],
    subject="Hello from Inkbox",
    body_text="Hi there!",
    body_html="<p>Hi there!</p>",
    cc=["manager@example.com"],
    bcc=["archive@example.com"],
)

# Send a threaded reply
identity.send_email(
    to=["user@example.com"],
    subject=f"Re: {sent.subject}",
    body_text="Following up!",
    in_reply_to_message_id=sent.id,
)

# Send with attachments
identity.send_email(
    to=["user@example.com"],
    subject="See attached",
    body_text="Please find the file attached.",
    attachments=[{
        "filename": "report.pdf",
        "content_type": "application/pdf",
        "content_base64": "<base64-encoded-content>",
    }],
)

# Iterate inbox (paginated automatically)
for msg in identity.iter_emails():
    print(msg.subject, msg.from_address, msg.is_read)

# Filter by direction: "inbound" or "outbound"
for msg in identity.iter_emails(direction="inbound"):
    print(msg.subject)

# Iterate only unread emails
for msg in identity.iter_unread_emails():
    print(msg.subject)

# Mark messages as read
identity.mark_emails_read([msg.id for msg in identity.iter_unread_emails()])

# Get all emails in a thread (thread_id comes from msg.thread_id)
thread = identity.get_thread(msg.thread_id)
for m in thread.messages:
    print(m.subject, m.from_address)
```

---

## Phone

```python
# Place an outbound call — stream audio over WebSocket
call = identity.place_call(
    to_number="+15551234567",
    client_websocket_url="wss://your-agent.example.com/ws",
)
print(call.status, call.rate_limit.calls_remaining)

# List calls (paginated)
calls = identity.list_calls(limit=10, offset=0)
for call in calls:
    print(call.id, call.direction, call.remote_phone_number, call.status)

# Fetch transcript segments for a call
segments = identity.list_transcripts(calls[0].id)
for t in segments:
    print(f"[{t.party}] {t.text}")  # party: "local" or "remote"

# Read transcripts across all recent calls
for call in identity.list_calls(limit=10):
    segments = identity.list_transcripts(call.id)
    if not segments:
        continue
    print(f"\n--- Call {call.id} ({call.direction}) ---")
    for t in segments:
        print(f"  [{t.party:6}] {t.text}")

# Filter to only the remote party's speech
for t in identity.list_transcripts(calls[0].id):
    if t.party == "remote":
        print(t.text)

# Search transcripts across a phone number (org-level)
hits = inkbox.phone_numbers.search_transcripts(phone.id, q="refund", party="remote")
for t in hits:
    print(f"[{t.party}] {t.text}")
```

---

## Text Messages (SMS/MMS)

Send and receive SMS/MMS through the identity's assigned phone number.

**Outbound SMS rules (read before sending):**

- Outbound SMS is currently allowed only from **local** numbers, not toll-free.
- Each sender phone number is rate-limited to **15 outbound texts per rolling 24-hour window**.
- A new local number takes **~10-15 minutes** for the 10DLC campaign to propagate at the carrier — `phone_number.sms_status` reads `pending` until then, and sends will return `409 sender_sms_pending`.
- The recipient must have texted **`START`** to any number within your organization to opt in. Unknown recipients will fail with `403 recipient_not_opted_in`; recipients who later send `STOP` flip to `403 recipient_opted_out`. You can inspect consent state directly via `inkbox.sms_opt_ins` — see [SMS Opt-Ins](#sms-opt-ins).

**Coming soon:**

- Toll-free SMS sending.
- Customer-managed 10DLC brands and campaigns, which lift the per-number 24-hour limit dramatically.

```python
# Send an SMS. Returns a queued TextMessage; final delivery state arrives
# via any webhook subscription on the sender's phone number whose
# event_types include the text.* lifecycle events.
sent = identity.send_text(to="+15551234567", text="Hello from Inkbox")
print(sent.id, sent.delivery_status)   # SmsDeliveryStatus.QUEUED

# List text messages
texts = identity.list_texts(limit=20)
for t in texts:
    print(t.remote_phone_number, t.text, t.is_read)

# Filter to unread only
unread = identity.list_texts(is_read=False)

# Get a single text
text = identity.get_text("text-uuid")
print(text.type)  # "sms" or "mms"
if text.media:    # MMS attachments (temporary signed URLs)
    for m in text.media:
        print(m.content_type, m.size, m.url)

# List conversation summaries (one row per remote number)
convos = identity.list_text_conversations(limit=20)
for c in convos:
    print(c.remote_phone_number, c.latest_text, c.unread_count)

# Get messages in a specific conversation
msgs = identity.get_text_conversation("+15551234567", limit=50)

# Mark as read
identity.mark_text_read("text-uuid")
identity.mark_text_conversation_read("+15551234567")

# Org-level: search and delete
results = inkbox.texts.search(phone.id, q="invoice", limit=20)
inkbox.texts.update(phone.id, "text-uuid", status="deleted")
```

---

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The
registry is updated automatically when recipients text `START` / `STOP` to any
of your numbers (`source="sms"`).

**Reads** — open to admin API keys and Clerk JWT.

```python
from inkbox import SmsOptInStatus

# List the org's consent rows (newest-updated first; server caps limit at 200)
rows = inkbox.sms_opt_ins.list(limit=50)
opted_out = inkbox.sms_opt_ins.list(status=SmsOptInStatus.OPTED_OUT)

# Look up one recipient — 404 → InkboxAPIError if no row exists
row = inkbox.sms_opt_ins.get("+15551234567")
print(row.status, row.source, row.opted_in_at, row.opted_out_at)
```

**Writes** — admin-only, and only if your org runs its own active, customer-managed 10DLC
campaign. Orgs on the Inkbox-default campaign share consent state and get a
`409 customer_campaign_required` on write attempts. Writes record an audit
event with `source="api"`.

```python
# Record consent captured outside of STOP/START (signup form, paper waiver, etc.)
inkbox.sms_opt_ins.opt_in("+15551234567")

# Honor an opt-out collected outside of inbound STOP
inkbox.sms_opt_ins.opt_out("+15551234567")
```

---

## Credentials

Access credentials stored in the vault through the agent-facing `credentials` surface. The vault must be unlocked first.

```python
# Unlock the vault (once per session)
inkbox.vault.unlock("my-Vault-key-01!")

identity = inkbox.get_identity("my-agent")

# Discovery — list credentials this identity has access to
for login in identity.credentials.list_logins():
    print(login.name, login.payload.username)

for key in identity.credentials.list_api_keys():
    print(key.name, key.payload.access_key)

# Access by UUID — returns the typed payload directly
login   = identity.credentials.get_login("secret-uuid")      # → LoginPayload
api_key = identity.credentials.get_api_key("secret-uuid")    # → APIKeyPayload
ssh_key = identity.credentials.get_ssh_key("secret-uuid")    # → SSHKeyPayload

# Generic access
secret = identity.credentials.get("secret-uuid")             # → DecryptedVaultSecret
```

---

## Vault Management

Manage the encrypted vault at the org level. Access via `inkbox.vault`.

```python
# Get vault metadata (key counts, secret counts)
info = inkbox.vault.info()
print(info.secret_count, info.key_count)

# Initialize a new vault (creates primary key + recovery keys)
result = inkbox.vault.initialize("my-Vault-key-01!")
for recovery_key in result.recovery_keys:
    print(recovery_key.recovery_code)  # save these immediately

# Rotate the vault password
inkbox.vault.update_key("new-Vault-key-02!", current_vault_key="my-Vault-key-01!")

# Rotate using a recovery code (if primary key is lost)
inkbox.vault.update_key("new-Vault-key-02!", recovery_code="recovery-code-here")

# List vault keys
keys = inkbox.vault.list_keys()                         # all keys
primary_keys = inkbox.vault.list_keys(key_type="PRIMARY")
recovery_keys = inkbox.vault.list_keys(key_type="RECOVERY")

# List secrets (metadata only — no encrypted payloads)
secrets = inkbox.vault.list_secrets()
logins  = inkbox.vault.list_secrets(secret_type="login")

# Delete a secret
inkbox.vault.delete_secret("secret-uuid")

# Unlock the vault for decryption (returns an UnlockedVault)
unlocked = inkbox.vault.unlock("my-Vault-key-01!")
secret = unlocked.get_secret("secret-uuid")
print(secret.name, secret.payload)
```

### Access control

Control which identities can access which secrets.

```python
# List access rules for a secret
rules = inkbox.vault.list_access_rules("secret-uuid")
for rule in rules:
    print(rule.identity_id)

# Grant an identity access to a secret
inkbox.vault.grant_access("secret-uuid", "identity-uuid")

# Revoke access
inkbox.vault.revoke_access("secret-uuid", "identity-uuid")
```

---

## Identity Secret Management

Manage vault secrets scoped to a specific identity. These methods create secrets and automatically grant the identity access.

```python
from inkbox.vault.models import LoginPayload, APIKeyPayload

identity = inkbox.get_identity("my-agent")

# Create a secret and auto-grant this identity access
secret = identity.create_secret(
    name="CRM Login",
    payload=LoginPayload(username="bot@crm.com", password="s3cret"),
    description="CRM service account",
)

# Fetch and decrypt a secret
decrypted = identity.get_secret(secret.id)
print(decrypted.payload.username)

# Delete a secret
identity.delete_secret(secret.id)

# Revoke this identity's access (without deleting the secret)
identity.revoke_credential_access(secret.id)
```

### TOTP (one-time passwords)

Add, remove, and generate TOTP codes for login secrets.

```python
# Add TOTP to a login secret (accepts otpauth:// URI or TOTPConfig)
identity.set_totp(secret.id, "otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&issuer=Example")

# Generate the current TOTP code
code = identity.get_totp_code(secret.id)
print(code.code, code.expires_in)

# Remove TOTP from a secret
identity.remove_totp(secret.id)
```

---

## Org-level Messages and Threads

Access messages and threads directly without going through an identity. Useful for org-wide operations.

```python
# List messages for a mailbox (paginated automatically)
for msg in inkbox.messages.list("abc@inkboxmail.com"):
    print(msg.subject)

# Get a single message with full body
detail = inkbox.messages.get("abc@inkboxmail.com", "message-uuid")
print(detail.body_text)

# Send a message from a mailbox
inkbox.messages.send(
    "abc@inkboxmail.com",
    to=["user@example.com"],
    subject="Hello",
    body_text="Hi there!",
)

# Update message flags
inkbox.messages.update_flags("abc@inkboxmail.com", "message-uuid", is_read=True)
inkbox.messages.mark_read("abc@inkboxmail.com", "message-uuid")
inkbox.messages.mark_unread("abc@inkboxmail.com", "message-uuid")
inkbox.messages.star("abc@inkboxmail.com", "message-uuid")
inkbox.messages.unstar("abc@inkboxmail.com", "message-uuid")

# Delete a message
inkbox.messages.delete("abc@inkboxmail.com", "message-uuid")

# Get a temporary signed URL for an attachment
attachment = inkbox.messages.get_attachment("abc@inkboxmail.com", "message-uuid", "report.pdf")
print(attachment["url"])

# List threads (paginated automatically)
for thread in inkbox.threads.list("abc@inkboxmail.com"):
    print(thread.subject, thread.message_count)

# Get a thread with all messages
thread = inkbox.threads.get("abc@inkboxmail.com", "thread-uuid")

# Delete a thread
inkbox.threads.delete("abc@inkboxmail.com", "thread-uuid")
```

---

## Org-level Calls and Transcripts

Access calls and transcripts directly. Access via `inkbox.calls` and `inkbox.transcripts`.

```python
# List calls for a phone number
calls = inkbox.calls.list("phone-number-uuid", limit=10)
for call in calls:
    print(call.id, call.direction, call.status)

# Get a single call
call = inkbox.calls.get("phone-number-uuid", "call-uuid")

# Place an outbound call
call = inkbox.calls.place(
    from_number="phone-number-uuid",
    to_number="+15551234567",
    client_websocket_url="wss://example.com/ws",
)

# List transcript segments for a call
segments = inkbox.transcripts.list("phone-number-uuid", "call-uuid")
for t in segments:
    print(f"[{t.party}] {t.text}")
```

---

## Org-level Mailboxes

Mailboxes are provisioned atomically by `inkbox.create_identity(...)`
and removed by `identity.delete()` (cascade). The `inkbox.mailboxes`
surface is read + update + search only.

```python
# List all mailboxes in the organisation
mailboxes = inkbox.mailboxes.list()

# Get a specific mailbox
mailbox = inkbox.mailboxes.get("abc-xyz@inkboxmail.com")
print(mailbox.email_address)
print(mailbox.sending_domain)        # bare domain the mailbox sends from
print(mailbox.agent_identity_id)     # non-null for live customer mailboxes (1:1 invariant)

# Update filter mode. display_name has moved to the identity — set
# it via identity.update(display_name=...). The mailbox PATCH
# endpoint hard-rejects display_name with a 422. To attach a webhook
# receiver, see "Webhooks" below.
inkbox.mailboxes.update(mailbox.email_address, filter_mode="whitelist")  # admin-scoped key only

# Full-text search across messages in a mailbox
results = inkbox.mailboxes.search(mailbox.email_address, q="invoice", limit=20)
for msg in results:
    print(msg.subject, msg.from_address)

# To remove a mailbox, delete its owning identity (cascades to the
# linked mailbox AND tunnel; revokes scoped API keys):
inkbox.get_identity("support-agent").delete()
```

---

## Custom Sending Domains

If your org has registered custom sending domains in the console, list them and (admin-only) set the org default. New mailboxes inherit the org default unless you pass `sending_domain` to `create_identity`. Domain registration, DNS records, verification, DKIM rotation, and deletion stay in the console.

```python
from inkbox import SendingDomainStatus

# List custom sending domains for the org (optionally filter by status)
verified = inkbox.domains.list(status=SendingDomainStatus.VERIFIED)
for d in verified:
    print(d.id, d.domain, d.status, d.is_default)

# Set the org default — admin-scoped API key only.
# Returns the bare new default domain name (or None when reverted to platform).
new_default = inkbox.domains.set_default("mail.acme.com")

# Pass the platform domain (e.g. "inkboxmail.com" in prod) to revert.
inkbox.domains.set_default("inkboxmail.com")  # -> None
```

---

## Org-level Phone Numbers

Read, search, and release phone numbers org-wide via `inkbox.phone_numbers`. Provisioning still goes through an identity — pass `agent_handle` so the new number is bound to it from the start.

```python
# List all phone numbers in the organisation
numbers = inkbox.phone_numbers.list()

# Get a specific phone number by ID
number = inkbox.phone_numbers.get("phone-number-uuid")

# Provision a new number
number = inkbox.phone_numbers.provision(agent_handle="sales-bot", type="toll_free")
local  = inkbox.phone_numbers.provision(agent_handle="sales-bot", type="local", state="NY")

# Update incoming call behaviour
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="webhook",
    incoming_call_webhook_url="https://example.com/calls",
)
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="auto_accept",
    client_websocket_url="wss://example.com/ws",
)

# Full-text search across transcripts
hits = inkbox.phone_numbers.search_transcripts(number.id, q="refund", party="remote")
for t in hits:
    print(f"[{t.party}] {t.text}")

# Release a number
inkbox.phone_numbers.release(number.id)
```

---

## Tunnels

Bring a local Python process online at a public `https://{name}.inkboxwire.com` URL via outbound HTTP/2. No inbound port to open, no static IP needed. POSIX only.

```python
with Inkbox(api_key="ApiKey_...") as inkbox:
    # Forward to a local HTTP server (edge mode — Inkbox terminates TLS)
    listener = inkbox.tunnels.connect(
        name="my-app",
        forward_to="http://127.0.0.1:8080",
    )
    print(listener.public_url)        # https://my-app.inkboxwire.com
    listener.wait()                   # blocks until close()/Ctrl-C

    # Or forward to an in-process ASGI app (FastAPI / Starlette / yours)
    listener = inkbox.tunnels.connect(name="my-app", forward_to=fastapi_app)

    # Passthrough TLS — tls_mode is fixed at identity-create time:
    inkbox.create_identity("my-app-pt", tunnel={"tls_mode": "passthrough"})
    listener = inkbox.tunnels.connect(
        name="my-app-pt",
        forward_to="http://127.0.0.1:8080",
    )
```

Async variant (`serve_forever()` / `aclose()`) is available for callers already inside an event loop. Pick one pair; don't mix `wait`/`close` with the async APIs.

Tunnels are provisioned atomically by `inkbox.create_identity(...)`;
there is no standalone `create` / `delete` / `restore` /
`rotate_secret` surface. Read + edit on the resource:

```python
inkbox.tunnels.list()
inkbox.tunnels.get("tunnel-uuid")
inkbox.tunnels.update("tunnel-uuid", metadata={"team": "gtm"})
# Passthrough only:
inkbox.tunnels.sign_csr("tunnel-uuid", csr_pem=csr_bytes)
```

Data-plane authentication uses the same `api_key` the `Inkbox` client
was constructed with — admin-scoped or identity-scoped (matching the
tunnel's identity). Mint a per-agent scoped key via
`inkbox.api_keys.create(scoped_identity_id=...)`. There is no
per-tunnel connect secret to rotate. State (passthrough cert/key,
cached tunnel id) lives under `~/.inkbox/tunnels/{name}/`; treat it
like an SSH key dir. `forward_to` is loopback-only by default; pass
`allow_remote_forwarding=True` after reviewing the SSRF tradeoff.

---

## Webhooks

Webhook delivery uses a dedicated subscription resource. Each
subscription names exactly one owner (a mailbox **or** a phone
number), one HTTPS destination URL, and a non-empty subset of the
catalog's event types. Multiple subscriptions on the same owner fan
out independently.

The one exception is `phone.incoming_call`, which is a synchronous
control-plane callback (the response body decides whether Inkbox
answers). That URL still lives on the phone-number resource as
`incoming_call_webhook_url`.

### Subscribing to mail or text events

```python
# Mail subscription: pick the message.* events you want.
inkbox.webhooks.subscriptions.create(
    mailbox_id=mailbox.id,
    url="https://example.com/hook",
    event_types=["message.received", "message.bounced"],
)

# Text subscription: pick the text.* events you want.
inkbox.webhooks.subscriptions.create(
    phone_number_id=number.id,
    url="https://example.com/texts",
    event_types=[
        "text.received",
        "text.sent",
        "text.delivered",
        "text.delivery_failed",
        "text.delivery_unconfirmed",
    ],
)

# List, update, remove.
subs = inkbox.webhooks.subscriptions.list(mailbox_id=mailbox.id)
inkbox.webhooks.subscriptions.update(subs[0].id, url="https://new/hook")
inkbox.webhooks.subscriptions.delete(subs[0].id)
```

Available event types:

| Channel | `event_type` values |
|---|---|
| Mail | `message.received`, `message.sent`, `message.forwarded`, `message.delivered`, `message.bounced`, `message.failed` |
| Phone text | `text.received`, `text.sent`, `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed` |

Server-side validation: exactly one of `mailbox_id` /
`phone_number_id` must be set; `event_types` must be non-empty and
distinct; every event type must belong to the owner's channel (mailbox
-> `message.*`, phone number -> `text.*`). On `create` the SDK mirrors
all four checks client-side so typos surface as `ValueError` rather
than 422. On `update` the SDK mirrors the non-empty / distinct /
no-`phone.incoming_call` checks; channel coherence is deferred to the
server because the SDK doesn't know the owner FK from a sub_id alone.

### Incoming-call webhooks (still per-number)

```python
# Route incoming calls to a webhook. The response body controls call routing.
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="webhook",
    incoming_call_webhook_url="https://example.com/calls",
)
```

### Wire shapes

Every mail and text payload uses the standard `{event_type,
timestamp, data}` envelope. `data["contacts"]` (mail) and
`data["contacts"]` (text) are always present, possibly empty.
`data["agent_identities"]` mirrors `contacts` but matches active
agent identities in the same org. On mail, each list entry carries a
`bucket: "from" | "to" | "cc" | "bcc"` plus `address`; receivers
should pair to the source field by `(bucket, address)`.
`data["message"]["bcc_addresses"]` is populated only on outbound
events.

Phone-text payloads added several fields for group sends:

- `text_message["recipients"]` -- `None` on inbound, a one-element
  list on outbound 1:1, multiple entries on group outbound.
- `text_message["remote_phone_number"]` -- `None` on group outbound
  (the per-recipient state is in `recipients[]`).
- `data["recipient_phone_number"]` -- set on outbound lifecycle
  events, names the recipient the event is about. `None` on inbound
  and on 1:1 outbound.

The inbound-call payload is **flat** -- no envelope -- and carries
`contacts: list[WebhookContact]` and `agent_identities:
list[WebhookAgentIdentity]` at the top level.

### Receiving webhooks (typed)

The SDK exports `TypedDict` wire shapes for every payload. Pair `verify_webhook` with `cast(TextWebhookPayload, json.loads(body))` and discriminate on `event_type`:

```python
import json
from typing import cast

from inkbox import (
    MailWebhookPayload,
    PhoneIncomingCallWebhookPayload,
    TextWebhookPayload,
    verify_webhook,
)

# FastAPI
@app.post("/hooks/mail")
async def mail_hook(request: Request):
    raw_body = await request.body()
    if not verify_webhook(payload=raw_body, headers=request.headers, secret="whsec_..."):
        raise HTTPException(status_code=403)
    payload = cast(MailWebhookPayload, json.loads(raw_body))
    for match in payload["data"]["contacts"]:
        logger.info(
            "%s %s -> %s (%s)",
            match["bucket"], match["address"], match["name"], match["id"],
        )

@app.post("/hooks/text")
async def text_hook(request: Request):
    raw_body = await request.body()
    if not verify_webhook(payload=raw_body, headers=request.headers, secret="whsec_..."):
        raise HTTPException(status_code=403)
    payload = cast(TextWebhookPayload, json.loads(raw_body))
    match payload["event_type"]:
        case "text.delivery_failed":
            msg = payload["data"]["text_message"]
            logger.error(
                "SMS to %s failed: %s (%s)",
                msg["remote_phone_number"], msg["error_code"], msg["error_detail"],
            )
        case "text.delivered":
            # delivery_status, sent_at, delivered_at are all populated.
            ...
        case "text.received":
            for contact in payload["data"]["contacts"]:
                logger.info("inbound from known contact %s", contact["id"])
            for agent in payload["data"]["agent_identities"]:
                logger.info("inbound from agent identity %s", agent["agent_handle"])
```

Wire shapes are intentionally **snake_case** (the raw JSON body, not the SDK's parsed dataclasses) so `json.loads(body)` round-trips into the `TypedDict` without a transformer. Enum-valued fields like `direction`, `status`, and `delivery_status` are `Literal[...]` string unions rather than the SDK's `StrEnum`s — `json.loads` produces bare strings, and `Literal` unions narrow cleanly under mypy / pyright.

---

## Whoami

```python
# Check the authenticated caller's identity
info = inkbox.whoami()
print(info.auth_type)        # "api_key" or "jwt"
print(info.organization_id)

# Narrow by auth type
if isinstance(info, inkbox.WhoamiApiKeyResponse):
    print(info.key_id, info.label)
elif isinstance(info, inkbox.WhoamiJwtResponse):
    print(info.email, info.org_role)
```

---

## Signing Keys

```python
# Create or rotate the org-level webhook signing key (plaintext returned once)
key = inkbox.create_signing_key()
print(key.signing_key)  # save this immediately
```

---

## Verifying Webhook Signatures

Use `verify_webhook` to confirm that an incoming request was sent by Inkbox.

```python
from inkbox import verify_webhook

# FastAPI
@app.post("/hooks/mail")
async def mail_hook(request: Request):
    raw_body = await request.body()
    if not verify_webhook(
        payload=raw_body,
        headers=request.headers,
        secret="whsec_...",
    ):
        raise HTTPException(status_code=403)
    ...

# Flask
@app.post("/hooks/mail")
def mail_hook():
    raw_body = request.get_data()
    if not verify_webhook(
        payload=raw_body,
        headers=request.headers,
        secret="whsec_...",
    ):
        abort(403)
    ...
```

---

## Examples

Runnable example scripts are available in the [examples/python](https://github.com/vectorlyapp/inkbox/tree/main/inkbox/examples/python) directory:

| Script | What it demonstrates |
|---|---|
| `register_agent_identity.py` | Create an identity with a linked mailbox and phone number |
| `agent_send_email.py` | Send an email and a threaded reply |
| `read_agent_messages.py` | List messages and threads |
| `create_agent_mailbox.py` | Create, update, search, and delete a mailbox |
| `create_agent_phone_number.py` | Provision, update, and release a number |
| `list_agent_phone_numbers.py` | List all phone numbers in the org |
| `read_agent_calls.py` | List calls and print transcripts |
| `receive_agent_email_webhook.py` | Register and delete a mailbox webhook |
| `receive_agent_call_webhook.py` | Register, update, and delete a phone webhook |

## License

MIT

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
    human_email="alex@example.com",
    display_name="Sales Agent",
    note_to_human="Hey Alex, this is your sales bot signing up!",  # required
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
| `Inkbox.signup(human_email, display_name, note_to_human)` | None | `AgentSignupResponse` |
| `Inkbox.verify_signup(api_key, verification_code)` | API key | `AgentSignupVerifyResponse` |
| `Inkbox.resend_signup_verification(api_key)` | API key | `AgentSignupResendResponse` |
| `Inkbox.get_signup_status(api_key)` | API key | `AgentSignupStatusResponse` |

All three arguments to `signup()` (`human_email`, `display_name`, `note_to_human`) are required. All methods accept optional `base_url` and `timeout` keyword arguments.

> **Note:** Unclaimed agents can only send to the `human_email` specified at signup (max 10/day). After verification or human approval in the console, full capabilities are unlocked.

---

## Identities

`inkbox.create_identity()` and `inkbox.get_identity()` return an `AgentIdentity` object that holds the identity's channels and exposes convenience methods scoped to those channels.

```python
# Create and fully provision an identity
identity = inkbox.create_identity("sales-bot", display_name="Sales Bot")
phone    = identity.provision_phone_number(type="toll_free")      # provisions + links

print(identity.email_address)
print(phone.number)

# Link an existing mailbox or phone number instead of creating new ones
identity.assign_mailbox("mailbox-uuid-here")
identity.assign_phone_number("phone-number-uuid-here")

# Get an existing identity
identity = inkbox.get_identity("sales-bot")
identity.refresh()  # re-fetch channels from API

# List all identities for your org
all_identities = inkbox.list_identities()

# Update status or handle
identity.update(status="paused")
identity.update(new_handle="sales-bot-v2")

# Unlink channels (without deleting them)
identity.unlink_mailbox()
identity.unlink_phone_number()

# Delete
identity.delete()
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
    to_number="+15167251294",
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

Receive and read inbound text messages. Outbound SMS sending is coming soon.

```python
# List text messages
texts = identity.list_texts(limit=20)
for t in texts:
    print(t.remote_phone_number, t.text, t.is_read)

# Filter to unread only
unread = identity.list_texts(is_read=False)

# Get a single text
text = identity.get_text("text-uuid")
print(text.type)  # "sms" or "mms"
if text.media:    # MMS attachments (presigned S3 URLs, 1hr expiry)
    for m in text.media:
        print(m.content_type, m.size, m.url)

# List conversation summaries (one row per remote number)
convos = identity.list_text_conversations(limit=20)
for c in convos:
    print(c.remote_phone_number, c.latest_text, c.unread_count)

# Get messages in a specific conversation
msgs = identity.get_text_conversation("+15167251294", limit=50)

# Mark as read
identity.mark_text_read("text-uuid")
identity.mark_text_conversation_read("+15167251294")

# Org-level: search and delete
results = inkbox.texts.search(phone.id, q="invoice", limit=20)
inkbox.texts.update(phone.id, "text-uuid", status="deleted")
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

# Get an attachment presigned URL
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
    to_number="+15167251294",
    client_websocket_url="wss://example.com/ws",
)

# List transcript segments for a call
segments = inkbox.transcripts.list("phone-number-uuid", "call-uuid")
for t in segments:
    print(f"[{t.party}] {t.text}")
```

---

## Org-level Mailboxes

Manage mailboxes directly without going through an identity. Access via `inkbox.mailboxes`.

```python
# List all mailboxes in the organisation
mailboxes = inkbox.mailboxes.list()

# Get a specific mailbox
mailbox = inkbox.mailboxes.get("abc-xyz@inkboxmail.com")

# Create a mailbox linked to an agent identity
mailbox = inkbox.mailboxes.create(
    agent_handle="support-agent",
    display_name="Support Inbox",
)
print(mailbox.email_address)

# Update display name or webhook URL
inkbox.mailboxes.update(mailbox.email_address, display_name="New Name")
inkbox.mailboxes.update(mailbox.email_address, webhook_url="https://example.com/hook")
inkbox.mailboxes.update(mailbox.email_address, webhook_url=None)  # remove webhook

# Full-text search across messages in a mailbox
results = inkbox.mailboxes.search(mailbox.email_address, q="invoice", limit=20)
for msg in results:
    print(msg.subject, msg.from_address)

# Delete a mailbox
inkbox.mailboxes.delete(mailbox.email_address)
```

---

## Org-level Phone Numbers

Manage phone numbers directly without going through an identity. Access via `inkbox.phone_numbers`.

```python
# List all phone numbers in the organisation
numbers = inkbox.phone_numbers.list()

# Get a specific phone number by ID
number = inkbox.phone_numbers.get("phone-number-uuid")

# Provision a new number
number = inkbox.phone_numbers.provision(type="toll_free")
local  = inkbox.phone_numbers.provision(type="local", state="NY")

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

## Webhooks

Webhooks are configured on the mailbox or phone number resource — no separate registration step.

### Mailbox webhooks

Set a URL on a mailbox to receive `message.received` and `message.sent` events.

```python
# Set webhook
inkbox.mailboxes.update("abc@inkboxmail.com", webhook_url="https://example.com/hook")

# Remove webhook
inkbox.mailboxes.update("abc@inkboxmail.com", webhook_url=None)
```

### Phone webhooks

Set an incoming call webhook URL and action on a phone number.

```python
# Route incoming calls to a webhook
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="webhook",
    incoming_call_webhook_url="https://example.com/calls",
)
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
| `register_agent_identity.py` | Create an identity, assign mailbox + phone number |
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

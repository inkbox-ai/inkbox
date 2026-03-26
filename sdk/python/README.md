# inkbox

Python SDK for the [Inkbox API](https://inkbox.ai/docs) — API-first communication infrastructure for AI agents (email, phone, identities, encrypted vault — login credentials, API keys, key pairs, SSH keys, OTP, etc.).

## Install

```bash
pip install inkbox
```

Requires Python ≥ 3.11.

## Authentication

You'll need an API key to use this SDK. Get one at [console.inkbox.ai](https://console.inkbox.ai/).

## Quick start

```python
import os
from inkbox import Inkbox

with Inkbox(
    api_key=os.environ["INKBOX_API_KEY"],
    vault_key=os.environ.get("INKBOX_VAULT_KEY"),
) as inkbox:
    # Create an agent identity
    identity = inkbox.create_identity("support-bot")

    # Create and link new channels
    identity.create_mailbox(display_name="Support Bot")
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

## Identities

`inkbox.create_identity()` and `inkbox.get_identity()` return an `AgentIdentity` object that holds the identity's channels and exposes convenience methods scoped to those channels.

```python
# Create and fully provision an identity
identity = inkbox.create_identity("sales-bot")
mailbox  = identity.create_mailbox(display_name="Sales Bot")      # creates + links
phone    = identity.provision_phone_number(type="toll_free")      # provisions + links

print(mailbox.email_address)
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

## Org-level Mailboxes

Manage mailboxes directly without going through an identity. Access via `inkbox.mailboxes`.

```python
# List all mailboxes in the organisation
mailboxes = inkbox.mailboxes.list()

# Get a specific mailbox
mailbox = inkbox.mailboxes.get("abc-xyz@inkboxmail.com")

# Create a mailbox linked to an agent identity
mailbox = inkbox.mailboxes.create(agent_handle="support-agent", display_name="Support Inbox")
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
inkbox.phone_numbers.release(number=number.number)
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

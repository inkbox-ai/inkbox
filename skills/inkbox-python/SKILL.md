---
name: inkbox-python
description: Use when writing Python code that imports from `inkbox`, uses `pip install inkbox`, or when adding email, phone, or agent identity features using the Inkbox Python SDK.
user-invocable: false
---

# Inkbox Python SDK

API-first communication infrastructure for AI agents — email, phone, and identities.

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

Constructor: `Inkbox(api_key, base_url="https://api.inkbox.ai", timeout=30.0)`

## Core Model

```
Inkbox (org-level client)
├── .create_identity(handle) → AgentIdentity
├── .get_identity(handle)    → AgentIdentity
├── .list_identities()       → list[AgentIdentitySummary]
├── .mailboxes               → MailboxesResource
├── .phone_numbers           → PhoneNumbersResource
└── .create_signing_key()    → SigningKey

AgentIdentity (identity-scoped helper)
├── .mailbox                 → IdentityMailbox | None
├── .phone_number            → IdentityPhoneNumber | None
├── mail methods             (requires assigned mailbox)
└── phone methods            (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is raised with a clear message.

## Identities

```python
identity = inkbox.create_identity("sales-agent")
identity = inkbox.get_identity("sales-agent")
identities = inkbox.list_identities()  # → list[AgentIdentitySummary]

identity.update(new_handle="new-name")   # rename
identity.update(status="paused")         # or "active"
identity.refresh()                       # re-fetch from API, updates cached channels
identity.delete()                        # soft-delete; unlinks channels
```

## Channel Management

```python
# Create and auto-link new channels
mailbox = identity.create_mailbox(display_name="Sales Agent")
phone   = identity.provision_phone_number(type="toll_free")       # or type="local", state="NY"

print(mailbox.email_address)   # e.g. "abc-xyz@inkboxmail.com"
print(phone.number)            # e.g. "+18005551234"

# Link existing channels
identity.assign_mailbox("mailbox-uuid")
identity.assign_phone_number("phone-number-uuid")

# Unlink without deleting
identity.unlink_mailbox()
identity.unlink_phone_number()
```

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
    }],
)
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

# Get full thread (oldest-first)
thread = identity.get_thread(msg.thread_id)
for m in thread.messages:
    print(f"[{m.from_address}] {m.subject}")
```

## Phone

```python
# Place outbound call — stream audio via WebSocket
call = identity.place_call(
    to_number="+15167251294",
    client_websocket_url="wss://your-agent.example.com/ws",
)
print(call.status)
print(call.rate_limit.calls_remaining)   # rolling 24h budget

# List calls (offset pagination)
calls = identity.list_calls(limit=10, offset=0)
for c in calls:
    print(c.id, c.direction, c.remote_phone_number, c.status)

# Transcript segments (ordered by seq)
for t in identity.list_transcripts(calls[0].id):
    print(f"[{t.party}] {t.text}")   # party: "local" or "remote"
```

## Org-level Resources

### Mailboxes (`inkbox.mailboxes`)

```python
mailboxes = inkbox.mailboxes.list()
mailbox   = inkbox.mailboxes.get("abc@inkboxmail.com")
mailbox   = inkbox.mailboxes.create(agent_handle="support", display_name="Support Inbox")

inkbox.mailboxes.update(mailbox.email_address, display_name="New Name")
inkbox.mailboxes.update(mailbox.email_address, webhook_url="https://example.com/hook")
inkbox.mailboxes.update(mailbox.email_address, webhook_url=None)   # remove webhook

results = inkbox.mailboxes.search(mailbox.email_address, q="invoice", limit=20)
inkbox.mailboxes.delete(mailbox.email_address)
```

### Phone Numbers (`inkbox.phone_numbers`)

```python
numbers = inkbox.phone_numbers.list()
number  = inkbox.phone_numbers.get("phone-number-uuid")
number  = inkbox.phone_numbers.provision(type="toll_free")
local   = inkbox.phone_numbers.provision(type="local", state="NY")

inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="webhook",            # "webhook", "auto_accept", or "auto_reject"
    incoming_call_webhook_url="https://...",
)
inkbox.phone_numbers.update(
    number.id,
    incoming_call_action="auto_accept",
    client_websocket_url="wss://...",
)

hits = inkbox.phone_numbers.search_transcripts(number.id, q="refund", party="remote", limit=50)
inkbox.phone_numbers.release(number=number.number)
```

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox or phone number — no separate registration.

```python
from inkbox import verify_webhook

# Rotate signing key (plaintext returned once — save it)
key = inkbox.create_signing_key()

# Verify an incoming webhook request
is_valid = verify_webhook(
    payload=raw_body,                                    # bytes
    signature=request.headers["X-Inkbox-Signature"],
    request_id=request.headers["X-Inkbox-Request-ID"],
    timestamp=request.headers["X-Inkbox-Timestamp"],
    secret="whsec_...",
)
```

Algorithm: HMAC-SHA256 over `"{request_id}.{timestamp}.{body}"`.

## Error Handling

```python
from inkbox import InkboxAPIError

try:
    identity = inkbox.get_identity("unknown")
except InkboxAPIError as e:
    print(e.status_code)   # HTTP status (e.g. 404)
    print(e.detail)        # message from API
```

## Key Conventions

- All method and property names are **snake_case**
- `iter_emails()` / `iter_unread_emails()` return `Iterator[Message]` — auto-paginated, lazy
- `list_calls()` returns `list[PhoneCall]` — offset pagination, not an iterator
- To clear a nullable field (e.g. webhook URL), pass `field=None`
- The `Inkbox` client **must** be used as a context manager (`with` statement) or `.close()` called manually
- Mail/phone methods on `AgentIdentity` raise `InkboxError` if the relevant channel isn't assigned

---
name: inkbox-python
description: Use when writing Python code that imports from `inkbox`, uses `pip install inkbox`, or when adding email, phone, text/SMS, vault, or agent identity features using the Inkbox Python SDK.
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
Inkbox (org-level client)
├── .create_identity(handle) → AgentIdentity
├── .get_identity(handle)    → AgentIdentity
├── .list_identities()       → list[AgentIdentitySummary]
├── .mailboxes               → MailboxesResource
├── .phone_numbers           → PhoneNumbersResource
├── .texts                   → TextsResource
├── .vault                   → VaultResource
├── .whoami()                → WhoamiResponse
└── .create_signing_key()    → SigningKey

AgentIdentity (identity-scoped helper)
├── .mailbox                 → IdentityMailbox | None
├── .phone_number            → IdentityPhoneNumber | None
├── .credentials             → Credentials  (requires vault unlocked)
├── mail methods             (requires assigned mailbox)
├── phone methods            (requires assigned phone number)
└── text methods             (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is raised with a clear message.

## Agent Signup

For the full agent self-signup flow (register, verify, check status, restrictions, and direct API examples), read the shared reference:

> **See:** `skills/agent-signup/SKILL.md`

Python SDK methods: `Inkbox.signup(...)`, `Inkbox.verify_signup(api_key, ...)`, `Inkbox.resend_signup_verification(api_key)`, `Inkbox.get_signup_status(api_key)`.

## Identities

```python
identity = inkbox.create_identity("sales-agent")
identity = inkbox.get_identity("sales-agent")
identities = inkbox.list_identities()  # → list[AgentIdentitySummary]

identity.update(new_handle="new-name")   # rename
identity.update(status="paused")         # or "active"
identity.refresh()                       # re-fetch from API, updates cached channels
identity.delete()                        # unlinks channels
```

## Channel Management

```python
# Identity is created with a mailbox automatically — provision a phone number
phone = identity.provision_phone_number(type="toll_free")       # or type="local", state="NY"
print(identity.email_address)  # e.g. "sales-agent@inkboxmail.com"
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

## Text Messages (SMS/MMS)

```python
# List text messages (offset pagination)
texts = identity.list_texts(limit=20, offset=0)
for t in texts:
    print(t.id, t.direction, t.remote_phone_number, t.text, t.is_read)

# Filter by read state
unread = identity.list_texts(is_read=False)

# Get a single text message
text = identity.get_text("text-uuid")
print(text.type)   # "sms" or "mms"
if text.media:     # MMS media attachments (presigned S3 URLs, 1hr expiry)
    for m in text.media:
        print(m.content_type, m.size, m.url)

# List conversation summaries (one row per remote number)
convos = identity.list_text_conversations(limit=20)
for c in convos:
    print(c.remote_phone_number, c.latest_text, c.unread_count, c.total_count)

# Get messages in a specific conversation
msgs = identity.get_text_conversation("+15167251294", limit=50)

# Mark a text as read (identity convenience method)
identity.mark_text_read("text-uuid")

# Mark all messages in a conversation as read
result = identity.mark_text_conversation_read("+15167251294")
print(result["updated_count"])

# Org-level: search, update, delete
results = inkbox.texts.search(phone.id, q="invoice", limit=20)
inkbox.texts.update(phone.id, "text-uuid", status="deleted")
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

### From the unlocked vault (org-level)

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

## Org-level Resources

### Mailboxes (`inkbox.mailboxes`)

```python
mailboxes = inkbox.mailboxes.list()
mailbox   = inkbox.mailboxes.get("abc@inkboxmail.com")

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
number  = inkbox.phone_numbers.provision(agent_handle="my-agent", type="toll_free")
local   = inkbox.phone_numbers.provision(agent_handle="my-agent", type="local", state="NY")

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
inkbox.phone_numbers.release(number.id)
```

## Whoami

```python
# Check the authenticated caller's identity
info = inkbox.whoami()
print(info.auth_type)        # "api_key" or "jwt"
print(info.organization_id)
```

Returns `WhoamiApiKeyResponse` (with `key_id`, `label`, `creator_type`, etc.) or `WhoamiJwtResponse` (with `email`, `org_role`, etc.) based on `auth_type`.

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox or phone number — no separate registration.

```python
from inkbox import verify_webhook

# Rotate signing key (plaintext returned once — save it)
key = inkbox.create_signing_key()

# Verify an incoming webhook request
is_valid = verify_webhook(
    payload=raw_body,                                    # bytes
    headers=request.headers,
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

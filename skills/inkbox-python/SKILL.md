---
name: inkbox-python
description: Use when writing Python code that imports from `inkbox`, uses `pip install inkbox`, or when adding email, phone, authenticator app, vault, or agent identity features using the Inkbox Python SDK.
user-invocable: false
---

# Inkbox Python SDK

API-first communication infrastructure for AI agents — email, phone, authenticator apps, encrypted vault, and identities.

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
├── .authenticator_apps      → AuthenticatorAppsResource
├── .vault                   → VaultResource
└── .create_signing_key()    → SigningKey

AgentIdentity (identity-scoped helper)
├── .mailbox                 → IdentityMailbox | None
├── .phone_number            → IdentityPhoneNumber | None
├── .authenticator_app       → IdentityAuthenticatorApp | None
├── .credentials             → Credentials  (requires vault unlocked)
├── mail methods             (requires assigned mailbox)
├── phone methods            (requires assigned phone number)
└── authenticator methods    (requires assigned authenticator app)
```

An identity must have a channel assigned before you can use mail/phone/authenticator methods. If not assigned, an `InkboxError` is raised with a clear message.

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
# Create and auto-link new channels
mailbox = identity.create_mailbox(display_name="Sales Agent")
phone   = identity.provision_phone_number(type="toll_free")       # or type="local", state="NY"
auth_app = identity.create_authenticator_app()

print(mailbox.email_address)   # e.g. "abc-xyz@inkboxmail.com"
print(phone.number)            # e.g. "+18005551234"

# Link existing channels
identity.assign_mailbox("mailbox-uuid")
identity.assign_phone_number("phone-number-uuid")
identity.assign_authenticator_app("authenticator-app-uuid")

# Unlink without deleting
identity.unlink_mailbox()
identity.unlink_phone_number()
identity.unlink_authenticator_app()
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

## Authenticator

```python
# Create an authenticator app and link it to an identity
app = identity.create_authenticator_app()

# Add an OTP account from an otpauth:// URI
account = identity.create_authenticator_account(
    otpauth_uri="otpauth://totp/Example:user@example.com?secret=EXAMPLESECRET&issuer=Example",
    display_name="My OTP Account",      # optional (max 255 chars)
    description="Login MFA for Example", # optional
)

# List all accounts in this identity's authenticator app
accounts = identity.list_authenticator_accounts()

# Get a single account
account = identity.get_authenticator_account("account-uuid")

# Update account metadata (pass None to clear a field)
identity.update_authenticator_account("account-uuid", display_name="New Label")

# Generate an OTP code
otp = identity.generate_otp("account-uuid")
print(otp.otp_code)            # e.g. "482901"
print(otp.valid_for_seconds)   # seconds until expiry (None for HOTP)
print(otp.otp_type)            # "totp" or "hotp"

# Delete an account
identity.delete_authenticator_account("account-uuid")
```

## Vault

Encrypted credential vault with client-side Argon2id key derivation and AES-256-GCM encryption. The server never sees plaintext secrets. Requires `argon2-cffi` and `cryptography` (included as dependencies).

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
    APIKeyPayload(access_key="ghp_xxx", secret_key="ghs_xxx"),
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
| `api_key` | `APIKeyPayload` | `access_key`, `secret_key?`, `endpoint?`, `notes?` |
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

# Access by UUID — returns typed payload directly
login   = identity.credentials.get_login("secret-uuid")      # → LoginPayload
api_key = identity.credentials.get_api_key("secret-uuid")    # → APIKeyPayload
ssh_key = identity.credentials.get_ssh_key("secret-uuid")    # → SSHKeyPayload

# Generic access — returns DecryptedVaultSecret
secret = identity.credentials.get("secret-uuid")
```

- Requires `inkbox.vault.unlock()` first — raises `InkboxError` if vault is not unlocked
- Results are filtered to secrets the identity has access to (via access rules)
- Cached after first access; call `identity.refresh()` to clear the cache
- `get_*` raises `KeyError` if not found, `TypeError` if wrong secret type

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

### Authenticator Apps (`inkbox.authenticator_apps`)

```python
apps = inkbox.authenticator_apps.list()
app  = inkbox.authenticator_apps.get("app-uuid")
app  = inkbox.authenticator_apps.create(agent_handle="support")   # linked to identity
app  = inkbox.authenticator_apps.create()                         # unbound
inkbox.authenticator_apps.delete("app-uuid")                      # deletes app + all accounts
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

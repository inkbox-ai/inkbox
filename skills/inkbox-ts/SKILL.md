---
name: inkbox-ts
description: Use when writing TypeScript or JavaScript code that imports from `@inkbox/sdk`, uses `npm install @inkbox/sdk`, or when adding email, phone, text/SMS, vault, or agent identity features using the Inkbox TypeScript SDK.
user-invocable: false
---

# Inkbox TypeScript SDK

API-first communication infrastructure for AI agents — email, phone, encrypted vault, and identities.

## Install & Init

```bash
npm install @inkbox/sdk
```

Requires Node.js ≥ 18. ESM module — no context manager needed:

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });
```

Constructor options: `{ apiKey: string, baseUrl?: string, timeoutMs?: number }`

## Core Model

```
Inkbox (org-level client)
├── .createIdentity(handle) → Promise<AgentIdentity>
├── .getIdentity(handle)    → Promise<AgentIdentity>
├── .listIdentities()       → Promise<AgentIdentitySummary[]>
├── .mailboxes              → MailboxesResource
├── .phoneNumbers           → PhoneNumbersResource
├── .texts                  → TextsResource
├── .vault                  → VaultResource
├── .whoami()               → Promise<WhoamiResponse>
└── .createSigningKey()     → Promise<SigningKey>

AgentIdentity (identity-scoped helper)
├── .mailbox                → IdentityMailbox | null
├── .phoneNumber            → IdentityPhoneNumber | null
├── .getCredentials()       → Promise<Credentials>  (requires vault unlocked)
├── mail methods            (requires assigned mailbox)
├── phone methods           (requires assigned phone number)
└── text methods            (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is thrown.

## Agent Signup

For the full agent self-signup flow (register, verify, check status, restrictions, and direct API examples), read the shared reference:

> **See:** `skills/agent-signup/SKILL.md`

TypeScript SDK methods: `Inkbox.signup({...})`, `Inkbox.verifySignup(apiKey, {...})`, `Inkbox.resendSignupVerification(apiKey)`, `Inkbox.getSignupStatus(apiKey)`.

## Identities

```typescript
const identity = await inkbox.createIdentity("sales-agent");
const identity = await inkbox.getIdentity("sales-agent");
const identities = await inkbox.listIdentities();   // AgentIdentitySummary[]

await identity.update({ newHandle: "new-name" });   // rename
await identity.update({ status: "paused" });         // or "active"
await identity.refresh();                            // re-fetch from API, updates cached channels
await identity.delete();                             // unlinks channels
```

## Channel Management

```typescript
// Identity is created with a mailbox automatically — provision a phone number
const phone = await identity.provisionPhoneNumber({ type: "toll_free" });   // or type: "local", state: "NY"

console.log(identity.emailAddress);  // e.g. "sales-agent@inkboxmail.com"
console.log(phone.number);           // e.g. "+18005551234"

// Link existing channels
await identity.assignMailbox("mailbox-uuid");
await identity.assignPhoneNumber("phone-number-uuid");

// Unlink without deleting
await identity.unlinkMailbox();
await identity.unlinkPhoneNumber();
```

## Mail

### Send

```typescript
const sent = await identity.sendEmail({
  to: ["user@example.com"],
  subject: "Hello",
  bodyText: "Hi there!",           // plain text (optional)
  bodyHtml: "<p>Hi there!</p>",    // HTML (optional)
  cc: ["cc@example.com"],          // optional
  bcc: ["bcc@example.com"],        // optional
  inReplyToMessageId: sent.id,     // for threaded replies
  attachments: [{                  // optional
    filename: "report.pdf",
    contentType: "application/pdf",
    contentBase64: "<base64>",
  }],
});
```

### Read

```typescript
// Iterate all messages — auto-paginated async generator
for await (const msg of identity.iterEmails()) {
  console.log(msg.subject, msg.fromAddress, msg.isRead);
}

// Filter by direction
for await (const msg of identity.iterEmails({ direction: "inbound" })) {   // or "outbound"
  ...
}

// Unread only (client-side filtered)
for await (const msg of identity.iterUnreadEmails()) {
  ...
}

// Mark as read
const ids: string[] = [];
for await (const msg of identity.iterUnreadEmails()) ids.push(msg.id);
await identity.markEmailsRead(ids);

// Get full thread (oldest-first)
const thread = await identity.getThread(msg.threadId);
for (const m of thread.messages) {
  console.log(`[${m.fromAddress}] ${m.subject}`);
}
```

## Phone

```typescript
// Place outbound call — stream audio via WebSocket
const call = await identity.placeCall({
  toNumber: "+15167251294",
  clientWebsocketUrl: "wss://your-agent.example.com/ws",
});
console.log(call.status);
console.log(call.rateLimit.callsRemaining);   // rolling 24h budget

// List calls (offset pagination)
const calls = await identity.listCalls({ limit: 10, offset: 0 });
for (const c of calls) {
  console.log(c.id, c.direction, c.remotePhoneNumber, c.status);
}

// Transcript segments (ordered by seq)
const segments = await identity.listTranscripts(calls[0].id);
for (const t of segments) {
  console.log(`[${t.party}] ${t.text}`);   // party: "local" or "remote"
}
```

## Text Messages (SMS/MMS)

```typescript
// List text messages (offset pagination)
const texts = await identity.listTexts({ limit: 20, offset: 0 });
for (const t of texts) {
  console.log(t.id, t.direction, t.remotePhoneNumber, t.text, t.isRead);
}

// Filter by read state
const unread = await identity.listTexts({ isRead: false });

// Get a single text message
const text = await identity.getText("text-uuid");
console.log(text.type);   // "sms" or "mms"
if (text.media) {          // MMS media attachments (presigned S3 URLs, 1hr expiry)
  for (const m of text.media) {
    console.log(m.contentType, m.size, m.url);
  }
}

// List conversation summaries (one row per remote number)
const convos = await identity.listTextConversations({ limit: 20 });
for (const c of convos) {
  console.log(c.remotePhoneNumber, c.latestText, c.unreadCount, c.totalCount);
}

// Get messages in a specific conversation
const msgs = await identity.getTextConversation("+15167251294", { limit: 50 });

// Mark a text as read (identity convenience method)
await identity.markTextRead("text-uuid");

// Mark all messages in a conversation as read
const readResult = await identity.markTextConversationRead("+15167251294");
console.log(readResult.updatedCount);

// Org-level: search, update, delete
const results = await inkbox.texts.search(phone.id, { q: "invoice", limit: 20 });
await inkbox.texts.update(phone.id, "text-uuid", { status: "deleted" });
```

## Vault

Encrypted credential vault with client-side Argon2id key derivation and AES-256-GCM encryption. The server never sees plaintext secrets. Requires `hash-wasm` (included as a dependency).

### Initialize

```typescript
// Initialize a new vault (org ID is fetched automatically from the API key)
const result = await inkbox.vault.initialize("my-Vault-key-01!");
console.log(result.vaultId, result.vaultKeyId);
for (const code of result.recoveryCodes) {
  console.log(code); // save these immediately — they cannot be retrieved again
}
```

### Unlock & Read

```typescript
import type { LoginPayload, APIKeyPayload, SSHKeyPayload, OtherPayload } from "@inkbox/sdk";

// Unlock with a vault key — derives key via Argon2id, decrypts all secrets
const unlocked = await inkbox.vault.unlock("my-Vault-key-01!");

// Optionally filter to secrets an agent identity has access to
const unlocked = await inkbox.vault.unlock("my-Vault-key-01!", { identityId: "agent-uuid" });

// All decrypted secrets from the unlock bundle
for (const secret of unlocked.secrets) {
  console.log(secret.name, secret.secretType);
  console.log(secret.payload);   // LoginPayload, APIKeyPayload, SSHKeyPayload, or OtherPayload
}

// Fetch and decrypt a single secret by ID
const secret = await unlocked.getSecret("secret-uuid");
const login = secret.payload as LoginPayload;
console.log(login.username, login.password);
```

### Create & Update

```typescript
// Create a login secret (secretType inferred from payload shape)
await unlocked.createSecret({
  name: "AWS Production",
  description: "Production IAM user",
  payload: { password: "s3cret", username: "admin", url: "https://aws.amazon.com" },
});

// Create an API key secret
await unlocked.createSecret({
  name: "GitHub PAT",
  payload: { apiKey: "ghp_xxx" },
});

// Create an SSH key secret
await unlocked.createSecret({
  name: "Deploy Key",
  payload: { privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----..." },
});

// Create a freeform secret
await unlocked.createSecret({
  name: "Misc",
  payload: { data: "any freeform content" },
});

// Update name/description and/or re-encrypt payload
await unlocked.updateSecret("secret-uuid", { name: "New Name" });
await unlocked.updateSecret("secret-uuid", {
  payload: { password: "new", username: "new" },
});

// Delete
await unlocked.deleteSecret("secret-uuid");
```

### Metadata (no unlock needed)

```typescript
const info    = await inkbox.vault.info();                                  // VaultInfo
const keys    = await inkbox.vault.listKeys();                              // VaultKey[]
const keys    = await inkbox.vault.listKeys({ keyType: "recovery" });       // filter by type
const secrets = await inkbox.vault.listSecrets();                           // VaultSecret[] (metadata only)
const secrets = await inkbox.vault.listSecrets({ secretType: "login" });    // filter by type
await inkbox.vault.deleteSecret("secret-uuid");                             // delete without unlocking
```

### Payload Types

| Type | Interface | Fields |
|------|-----------|--------|
| `login` | `LoginPayload` | `password`, `username?`, `email?`, `url?`, `notes?` |
| `api_key` | `APIKeyPayload` | `apiKey`, `endpoint?`, `notes?` |
| `key_pair` | `KeyPairPayload` | `accessKey`, `secretKey`, `endpoint?`, `notes?` |
| `ssh_key` | `SSHKeyPayload` | `privateKey`, `publicKey?`, `fingerprint?`, `passphrase?`, `notes?` |
| `other` | `OtherPayload` | `data` |

`secretType` is immutable after creation. To change it, delete and recreate.

### Agent Credentials (identity-scoped)

Agent-facing credential access — typed, identity-scoped. The vault stays as the admin surface; `identity.getCredentials()` is the agent runtime surface.

```typescript
import type { Credentials } from "@inkbox/sdk";

// Unlock the vault first (stores state on the client)
await inkbox.vault.unlock("my-Vault-key-01!");

const identity = await inkbox.getIdentity("support-bot");
const creds = await identity.getCredentials();

// Discovery — returns DecryptedVaultSecret[] with name/metadata
const allCreds = creds.list();
const logins   = creds.listLogins();
const apiKeys  = creds.listApiKeys();
const sshKeys  = creds.listSshKeys();
const keyPairs = creds.listKeyPairs();

// Access by UUID — returns typed payload directly
const login   = creds.getLogin("secret-uuid");    // → LoginPayload
const apiKey  = creds.getApiKey("secret-uuid");    // → APIKeyPayload
const sshKey  = creds.getSshKey("secret-uuid");    // → SSHKeyPayload
const keyPair = creds.getKeyPair("secret-uuid");   // → KeyPairPayload

// Generic access — returns DecryptedVaultSecret
const secret = creds.get("secret-uuid");
```

- Requires `inkbox.vault.unlock()` first — throws `InkboxError` if vault is not unlocked
- Results are filtered to secrets the identity has access to (via access rules)
- Cached after first call; call `identity.refresh()` to clear the cache
- `get*` throws `Error` if not found, `TypeError` if wrong secret type

## One-Time Passwords (TOTP)

TOTP secrets are stored inside `LoginPayload.totp` in the encrypted vault. Codes are generated client-side — no server call needed.

### From an agent identity (recommended)

```typescript
import { parseTotpUri } from "@inkbox/sdk";
import type { LoginPayload } from "@inkbox/sdk";

// Create a login with TOTP
const secret = await identity.createSecret({
  name: "GitHub",
  payload: {
    username: "user@example.com",
    password: "s3cret",
    totp: parseTotpUri("otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"),
  } satisfies LoginPayload,
});

// Generate TOTP code
const code = await identity.getTotpCode(secret.id);
console.log(code.code);              // e.g. "482901"
console.log(code.secondsRemaining);  // e.g. 17

// Add/replace TOTP on existing login
await identity.setTotp(secretId, "otpauth://totp/...?secret=...");

// Remove TOTP
await identity.removeTotp(secretId);
```

### From the unlocked vault (org-level)

```typescript
const unlocked = await inkbox.vault.unlock("my-Vault-key-01!");

// Same methods available on UnlockedVault
await unlocked.setTotp(secretId, totpConfigOrUri);
await unlocked.removeTotp(secretId);
const code = await unlocked.getTotpCode(secretId);
```

### TOTPCode fields

| Field | Type | Description |
|---|---|---|
| `code` | `string` | The OTP code (e.g. `"482901"`) |
| `periodStart` | `number` | Unix timestamp when the code became valid |
| `periodEnd` | `number` | Unix timestamp when the code expires |
| `secondsRemaining` | `number` | Seconds until expiry |

## Org-level Resources

### Mailboxes (`inkbox.mailboxes`)

```typescript
const mailboxes = await inkbox.mailboxes.list();
const mailbox   = await inkbox.mailboxes.get("abc@inkboxmail.com");

await inkbox.mailboxes.update(mailbox.emailAddress, { displayName: "New Name" });
await inkbox.mailboxes.update(mailbox.emailAddress, { webhookUrl: "https://example.com/hook" });
await inkbox.mailboxes.update(mailbox.emailAddress, { webhookUrl: null });   // remove webhook

const results = await inkbox.mailboxes.search(mailbox.emailAddress, { q: "invoice", limit: 20 });
await inkbox.mailboxes.delete(mailbox.emailAddress);
```

### Phone Numbers (`inkbox.phoneNumbers`)

```typescript
const numbers = await inkbox.phoneNumbers.list();
const number  = await inkbox.phoneNumbers.get("phone-number-uuid");
const num     = await inkbox.phoneNumbers.provision({ agentHandle: "my-agent", type: "toll_free" });
const local   = await inkbox.phoneNumbers.provision({ agentHandle: "my-agent", type: "local", state: "NY" });

await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "webhook",               // "webhook", "auto_accept", or "auto_reject"
  incomingCallWebhookUrl: "https://...",
});
await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "auto_accept",
  clientWebsocketUrl: "wss://...",
});

const hits = await inkbox.phoneNumbers.searchTranscripts(num.id, { q: "refund", party: "remote", limit: 50 });
await inkbox.phoneNumbers.release(num.id);
```

## Whoami

```typescript
// Check the authenticated caller's identity
const info = await inkbox.whoami();
console.log(info.authType);        // "api_key" or "jwt"
console.log(info.organizationId);

if (info.authType === "api_key") {
  console.log(info.keyId, info.label);
}
```

Returns `WhoamiApiKeyResponse` (with `keyId`, `label`, `creatorType`, etc.) or `WhoamiJwtResponse` (with `email`, `orgRole`, etc.) — discriminated on `authType`.

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox or phone number — no separate registration.

```typescript
import { verifyWebhook } from "@inkbox/sdk";

// Rotate signing key (plaintext returned once — save it)
const key = await inkbox.createSigningKey();

// Verify an incoming webhook request
const valid = verifyWebhook({
  payload: req.body,                                           // Buffer or string
  headers: req.headers as Record<string, string>,
  secret: "whsec_...",
});
```

Headers checked: `x-inkbox-signature`, `x-inkbox-request-id`, `x-inkbox-timestamp`.
Algorithm: HMAC-SHA256 over `"{requestId}.{timestamp}.{body}"`.

## Error Handling

```typescript
import { InkboxAPIError } from "@inkbox/sdk";

try {
  const identity = await inkbox.getIdentity("unknown");
} catch (e) {
  if (e instanceof InkboxAPIError) {
    console.log(e.statusCode);   // HTTP status (e.g. 404)
    console.log(e.detail);       // message from API
  }
}
```

## Key Conventions

- All method and property names are **camelCase**
- `iterEmails()` / `iterUnreadEmails()` return `AsyncGenerator<Message>` — use `for await...of`
- `listCalls()` returns `Promise<PhoneCall[]>` — offset pagination, not a generator
- To clear a nullable field (e.g. webhook URL), pass `field: null`
- No context manager needed — `new Inkbox({...})` is all that's required
- All methods are `async` and return Promises — always `await` them

---
name: inkbox-ts
description: Use when writing TypeScript or JavaScript code that imports from `@inkbox/sdk`, uses `npm install @inkbox/sdk`, or when adding email, phone, text/SMS, iMessage, contacts, notes, contact rules, vault, tunnels, mailbox storage, mail clients (IMAP/SMTP), or agent identity features using the Inkbox TypeScript SDK.
user-invocable: false
---

# Inkbox TypeScript SDK

API-first communication infrastructure for AI agents — email, phone, encrypted vault, and identities.

## Install & Init

```bash
npm install @inkbox/sdk
```

Requires Node.js ≥ 22. ESM module — no context manager needed:

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });
```

Constructor options: `{ apiKey: string, baseUrl?: string, timeoutMs?: number }`

## Core Model

```
Inkbox (admin-only client)
├── .createIdentity(handle)   → Promise<AgentIdentity>
├── .getIdentity(handle)      → Promise<AgentIdentity>
├── .listIdentities()         → Promise<AgentIdentitySummary[]>
├── .mailboxes                → MailboxesResource
├── .phoneNumbers             → PhoneNumbersResource
├── .texts                    → TextsResource
├── .imessages                → IMessagesResource
├── .imessageContactRules     → IMessageContactRulesResource
├── .mailIdentityContactRules  → MailIdentityContactRulesResource    (keyed by agentHandle)
├── .phoneIdentityContactRules → PhoneIdentityContactRulesResource   (keyed by agentHandle)
├── .signingKeys              → SigningKeysResource  (per-identity: createOrRotate/getStatus)
├── .mailContactRules         → MailContactRulesResource    (DEPRECATED — per-mailbox)
├── .phoneContactRules        → PhoneContactRulesResource   (DEPRECATED — per-number)
├── .smsOptIns                → SmsOptInsResource
├── .contacts                 → ContactsResource   (.facts, .correspondence, .access, .vcards)
├── .notes                    → NotesResource      (.access)
├── .vault                    → VaultResource
├── .whoami()                 → Promise<WhoamiResponse>
└── .createSigningKey()       → Promise<SigningKey>  (DEPRECATED — org-level; use .signingKeys)

AgentIdentity (identity-scoped helper)
├── .mailbox                → IdentityMailbox | null
├── .phoneNumber            → IdentityPhoneNumber | null
├── .mailFilterMode / .phoneFilterMode → FilterMode
├── .getCredentials()       → Promise<Credentials>  (requires vault unlocked)
├── .listAccess()           → Promise<IdentityAccess[]>
├── .grantAccess(viewerId|null) → Promise<IdentityAccess>
├── .revokeAccess(viewerId) → Promise<void>
├── .listMailContactRules() / .createMailContactRule(...) / .get/.update/.delete
├── .listPhoneContactRules() / .createPhoneContactRule(...) / ...  (requires phone number)
├── .getSigningKeyStatus() / .createSigningKey()
├── mail methods            (requires assigned mailbox)
├── phone methods           (requires assigned phone number)
└── text methods            (requires assigned phone number)
```

An identity must have a channel assigned before you can use mail/phone methods. If not assigned, an `InkboxError` is thrown.

## Agent Signup

For the full agent self-signup flow (register, verify, check status, restrictions, and direct API examples), read the shared reference:

> **See:** `skills/inkbox-agent-self-signup/SKILL.md`

TypeScript SDK methods: `Inkbox.signup({...})`, `Inkbox.verifySignup(apiKey, {...})`, `Inkbox.resendSignupVerification(apiKey)`, `Inkbox.getSignupStatus(apiKey)`.

## Identities

```typescript
const identity = await inkbox.createIdentity("sales-agent");
const identity = await inkbox.getIdentity("sales-agent");
const identities = await inkbox.listIdentities();   // AgentIdentitySummary[]

await identity.update({ newHandle: "new-name" });   // rename
await identity.update({ status: "paused" });         // or "active"
await identity.refresh();                            // re-fetch from API, updates cached channels
await identity.delete();                             // cascades: mailbox + tunnel + phone-number release
```

## Channel Management

```typescript
// Identity is created with a mailbox AND tunnel atomically — both are on the response
console.log(identity.emailAddress);            // e.g. "sales-agent@inkboxmail.com"
console.log(identity.tunnel?.publicHost);      // e.g. "sales-agent.inkboxwire.com"

// Phone numbers are still opt-in
const phone = await identity.provisionPhoneNumber({ type: "local", state: "NY" });  // local only; toll_free is rejected (422)
console.log(phone.number);                     // e.g. "+12125551234"

// Release the phone number (vendor + local)
await identity.releasePhoneNumber();
```

Mailboxes and tunnels are not separately linkable — they are 1:1 with their owning identity. Use `inkbox.createIdentity()` to provision both; use `identity.delete()` to remove both (cascade).

## Identity Visibility

Controls which other agent identities can see an identity in API responses. Humans and admins always see every identity.

```typescript
const rules = await identity.listAccess();   // IdentityAccess[]
// One wildcard row (viewerIdentityId === null → every active identity sees it),
// explicit per-viewer rows, or [] (no agent can see it).

await identity.grantAccess(viewer.id);        // grant one viewer identity
await identity.grantAccess(null);             // reset to org-wide wildcard
await identity.revokeAccess(viewer.id);       // revoke one viewer (keyed by viewer UUID)
```

Granting a viewer against an already-wildcard target raises `RedundantContactAccessGrantError` (409); revoking a non-existent grant raises `InkboxAPIError` (404).

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
  }, {
    filename: "chart.png",         // inline image: set contentId and reference
    contentType: "image/png",      // it from bodyHtml as <img src="cid:chart">.
    contentBase64: "<base64>",      // needs bodyHtml + image/*, unique per send;
    contentId: "chart",            // not on forwards. Not counted in hasAttachments.
  }],
  trackOpens: true,                // optional; embed a tracking pixel
});
// trackOpens tracks sends only when an HTML body is present. Opens surface
// on the returned Message as sent.firstOpenedAt / sent.openCount (an upper
// bound — image proxies prefetch pixels; pixels can also raise spam scores).
//
// sendEmail / replyAllEmail / forwardEmail all throw StorageLimitExceededError
// (402) when the mailbox is at its storage cap — see "Storage cap (402)" below.
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
await identity.markEmailsUnread(ids);   // batch counterpart
// Note: fetching a single inbound message by id (inkbox.messages.get) with
// an API key marks it read server-side; iterating does not, so
// markEmailsRead is the way to clear unread for list-only workflows. isRead
// (agent consumed via API) is distinct from firstOpenedAt (recipient's mail
// client loaded the tracking pixel).

// Get full thread (oldest-first)
const thread = await identity.getThread(msg.threadId);
for (const m of thread.messages) {
  console.log(`[${m.fromAddress}] ${m.subject}`);
}
```

### Thread Folders

Threads carry a `folder` field: `inbox`, `spam`, `archive`, or `blocked` (server-assigned, never client-set).

```typescript
import { ThreadFolder } from "@inkbox/sdk";
// thread.folder / threadDetail.folder is always one of the four values above.
```

Low-level folder listing / per-thread updates (`list({ folder })`, `listFolders(email)`, `update(..., { folder })`) live on `ThreadsResource`. Passing `folder: "blocked"` to `update` throws before the HTTP call.

### Storage cap (402)

Every mailbox has a plan storage cap. **All three send paths** — `sendEmail`, `replyAllEmail`, and `forwardEmail` (and the `inkbox.messages.*` equivalents) — throw `StorageLimitExceededError` (HTTP 402) when the send would push the mailbox over it.

```typescript
import { StorageLimitExceededError } from "@inkbox/sdk";

try {
  await identity.sendEmail({ to: ["user@example.com"], subject: "Hi", bodyText: "…" });
} catch (e) {
  if (e instanceof StorageLimitExceededError) {
    console.log(e.message);      // human sentence, includes the limit
    console.log(e.limitBytes);   // e.g. 2147483648 (2 GiB)
    console.log(e.upgradeUrl);   // console billing page
    // Free space — reclaim is immediate — or upgrade the plan:
    await inkbox.messages.delete(identity.emailAddress!, "<message-uuid>");
    await inkbox.threads.delete(identity.emailAddress!, "<thread-uuid>");
  }
}
```

Read usage off the mailbox (`inkbox.mailboxes.get(...)`): `storageUsedBytes` and `storageLimitBytes` (`null` = the server resolved no cap). The caps are **binary** — 2 GiB is `2 * 1024 ** 3` = 2,147,483,648 bytes, so divide by 1024 and label GiB/MiB, never GB.

**Free plan:** a footer is appended to the **stored** body of outgoing mail, so `inkbox.messages.get(...)` does not return byte-for-byte what you sent (a body-less send comes back with the footer as its body). Don't assert `sentBody === fetchedBody` on a Free plan.

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

The password is the same agent-scoped key an identity-scoped `Inkbox({...})` client authenticates with; mint one with `inkbox.apiKeys.create({ scopedIdentityId })`. Admin-scoped keys are rejected — one key maps to exactly one mailbox. Revoking the key revokes mail-client access.

Constraints that bite:

- **`From` must be the authenticated inbox address**, and exactly one address — aliases / "send as" are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over SMTP** — the required footer can't be injected without breaking the signature, so the send is refused. Send unsigned, or upgrade.
- Leave "save a copy of sent messages" **on** — Inkbox recognizes the client's copy as the message it already stored, so you get one Sent entry, charged against the storage cap once.

Full walkthrough: https://inkbox.ai/docs/capabilities/email/mail-clients

## Phone

```typescript
import { CallMode, IncomingCallAction } from "@inkbox/sdk";

// Place outbound call — stream audio via WebSocket
const call = await identity.placeCall({
  toNumber: "+15551234567",
  clientWebsocketUrl: "wss://your-agent.example.com/ws",
});
console.log(call.status);
console.log(call.rateLimit.callsRemaining);

// Or let Inkbox Voice AI drive the call — no WebSocket,
// no code. reason is the agent's task brief (required with
// mode=hosted_agent, invalid otherwise; server 422).
const hosted = await identity.placeCall({
  toNumber: "+15551234567",
  mode: CallMode.HOSTED_AGENT,   // default CallMode.CLIENT_WEBSOCKET
  reason: "Confirm tomorrow's 3pm appointment; reschedule if needed.",
});
console.log(hosted.mode, hosted.reason);
// where Voice AI isn't available (or is at capacity), the server's
// 503 (hosted_agent_unavailable / hosted_agent_at_capacity) surfaces verbatim.

// List calls (offset pagination). Every call carries mode / reason plus
// postCallActionItems — open items Voice AI recorded
// (seq-ascending; empty for client_websocket calls)
const calls = await identity.listCalls({ limit: 10, offset: 0 });
for (const c of calls) {
  console.log(c.id, c.direction, c.remotePhoneNumber, c.status, c.mode);
  for (const item of c.postCallActionItems) {
    console.log(`  [${item.seq}] ${item.action}: ${item.details}`);
  }
}

// Transcript segments (ordered by seq)
const segments = await identity.listTranscripts(calls[0].id);
for (const t of segments) {
  console.log(`[${t.party}] ${t.text}`);   // party: "local" or "remote"
}

// Hang up a live call from outside it (teardown confirms asynchronously,
// so the returned call can still show its live status; already-ended
// calls surface the server's 409)
const hungUp = await identity.hangupCall(calls[0].id);

// Per-identity Inkbox Voice AI config: voice / model / instructions,
// all nullable (null means the server default). setHostedAgentConfig is
// a FULL REPLACE — an omitted field resets to the server default.
const cfg = await identity.getHostedAgentConfig();
await identity.setHostedAgentConfig({ instructions: "Be brief and friendly." });

// Inbound-call handling: auto_accept | auto_reject | webhook | hosted_agent.
// hosted_agent is the only action needing no URL — Voice AI answers.
await identity.setIncomingCallAction({
  incomingCallAction: IncomingCallAction.HOSTED_AGENT,
});
console.log((await identity.getIncomingCallAction()).incomingCallAction);
```

## Text Messages (SMS/MMS)

**Outbound SMS limits and gates (current):**

- Allowed only from **local** numbers, not toll-free.
- **100 recipient sends per phone number per rolling 24h.** A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- New local numbers need **~10-15 min** for 10DLC carrier propagation. `identity.phoneNumber.smsStatus` is `SmsStatus.PENDING` until ready; sends in this window return `409 sender_sms_pending`.
- Recipient must have texted **`START`** to any number in the org. Unknown → `403 recipient_not_opted_in`. `STOP` → `403 recipient_opted_out`. Inspect / override consent state via `inkbox.smsOptIns` (see below).
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands/campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

```typescript
// Send SMS/MMS from this identity's phone number.
// Returns a queued TextMessage; final delivery state arrives via any
// webhook subscription on the sender's phone number whose eventTypes
// include the text.* lifecycle events.
const sent = await identity.sendText({
  to: "+15551234567",
  text: "Hello from Inkbox",
});
console.log(sent.id, sent.deliveryStatus);   // "queued"

// Group MMS beta: pass an array of recipients plus optional media URLs.
const group = await identity.sendText({
  to: ["+15551234567", "+15557654321"],
  text: "Hello group",
  mediaUrls: ["https://example.com/photo.jpg"],
});
console.log(group.conversationId, group.recipients);

// Reply to an existing conversation by UUID. Do not pass `to` with this form.
const reply = await identity.sendText({
  conversationId: group.conversationId,
  text: "Following up in the same conversation.",
});

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
if (text.media) {          // MMS media attachments (temporary signed URLs)
  for (const m of text.media) {
    console.log(m.contentType, m.size, m.url);
  }
}

// List one-to-one conversation summaries; opt into groups explicitly.
const convos = await identity.listTextConversations({ limit: 20, includeGroups: true });
for (const c of convos) {
  console.log(c.id, c.participants, c.latestHasMedia, c.latestText);
}

// Get messages in a specific conversation by remote number or conversation UUID.
const msgs = await identity.getTextConversation("+15551234567", { limit: 50 });

// Mark a text as read (identity convenience method)
await identity.markTextRead("text-uuid");

// Mark all messages in a conversation as read
const readResult = await identity.markTextConversationRead("+15551234567");
console.log(readResult.updatedCount);

// Admin-only: search, update, delete
const results = await inkbox.texts.search(phone.id, { q: "invoice", limit: 20 });
await inkbox.texts.update(phone.id, "text-uuid", { status: "deleted" });
```

## iMessage

iMessage works differently from SMS: there is no per-identity iMessage number. Recipients connect to an agent identity through a small shared pool of numbers — they ask the triage line to connect them to `@agent_handle`, and that creates an assignment between that one recipient and the identity. Everything agent-facing is keyed by `conversationId` / `remoteNumber`; the shared local number is never exposed, and there is **no cold outreach** — you can only message recipients who connected first.

Discover the router (triage) line at runtime — it can change, so never hardcode it:

```typescript
const triage = await inkbox.imessages.getTriageNumber();
console.log(triage.number, triage.connectCommand);  // "+1646...", "connect @your-handle"
// Humans connect by texting that command to that number.
```

Reachability is **opt-in per identity** (`imessageEnabled`, default `false`):

```typescript
const identity = await inkbox.createIdentity("my-agent", { imessageEnabled: true });
// or toggle later
await identity.update({ imessageEnabled: true });
// admin-only: flip contact-rule mode (default "blacklist")
await identity.update({ imessageFilterMode: "whitelist" });
console.log(identity.imessageEnabled, identity.imessageFilterMode);
```

Messaging (identity convenience methods; `inkbox.imessages` is the org-level resource with the same operations plus `agentIdentityId` / `isBlocked` filters):

```typescript
// Send to a connected recipient, or reply into a conversation by UUID.
const sent = await identity.sendIMessage({ to: "+15551234567", text: "Hello over iMessage" });
const reply = await identity.sendIMessage({
  conversationId: sent.conversationId,
  text: "With style",
  sendStyle: "slam",            // IMessageSendStyle: confetti, lasers, slam, ...
});
console.log(sent.service, sent.status);  // "imessage", "queued"

// List messages / conversations
const msgs = await identity.listIMessages({ limit: 20, isRead: false });
const convos = await identity.listIMessageConversations({ limit: 20 });
const convo = await identity.getIMessageConversation(sent.conversationId);
// assignmentStatus tells you whether the recipient is still connected:
// anything other than "active" means sends/reactions will be refused
// until they reconnect through triage.
console.log(convo.assignmentStatus);

// Who is actively connected to this identity right now (paginated)?
const connections = await identity.listIMessageAssignments({ limit: 20 });
for (const a of connections) {
  console.log(a.remoteNumber, a.status, a.createdAt);
}

// Tapback reactions. Sends accept the classic six (love, like, dislike,
// laugh, emphasize, question); inbound can also be "custom" with the
// literal emoji in customEmoji.
await identity.sendIMessageReaction({ messageId: msgs[0].id, reaction: "like" });

// Live tapbacks come back on message reads, oldest first.
for (const r of msgs[0].reactions ?? []) {
  console.log(r.direction, r.reaction, r.customEmoji);
}

// Read receipts + typing indicator
await identity.markIMessageConversationRead(sent.conversationId);
await identity.sendIMessageTyping(sent.conversationId);

// Media: upload bytes (max 10 MiB), then send the returned URL (one per message)
const upload = await identity.uploadIMessageMedia({
  content: await readFile("photo.jpg"),
  filename: "photo.jpg",
  contentType: "image/jpeg",
});
await identity.sendIMessage({ to: "+15551234567", mediaUrls: [upload.mediaUrl] });
```

Contact rules are scoped to the **identity** (not a phone number) because pool numbers are shared infrastructure:

```typescript
import { IMessageRuleAction } from "@inkbox/sdk";

const rule = await inkbox.imessageContactRules.create("my-agent", {
  action: IMessageRuleAction.BLOCK,
  matchTarget: "+15559999999",
});
const rules = await inkbox.imessageContactRules.list("my-agent");
await inkbox.imessageContactRules.update("my-agent", rule.id, { status: "paused" }); // admin-only
await inkbox.imessageContactRules.delete("my-agent", rule.id);                       // admin-only
const allRules = await inkbox.imessageContactRules.listAll();                        // admin-only, org-wide
```

Inbound messages and reactions arrive via **identity-owned** webhook subscriptions — see Webhooks below.

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The registry is updated automatically when recipients text `START` / `STOP` to any of your numbers (`source: "sms"`). Reads are admin-only; writes are admin-only **and** require your org to be on its own active, customer-managed 10DLC campaign (Inkbox-default-campaign orgs share consent state and get `409 customer_campaign_required` on writes — `source: "api"` writes record an audit event).

```typescript
import { SmsOptInStatus } from "@inkbox/sdk";

// List your org's consent rows, newest-updated first (server caps limit at 200)
const rows = await inkbox.smsOptIns.list({ limit: 50 });
const optedOut = await inkbox.smsOptIns.list({ status: SmsOptInStatus.OPTED_OUT });

// Look up one recipient — 404 → InkboxAPIError if no row exists
const row = await inkbox.smsOptIns.get("+15551234567");
console.log(row.status, row.source, row.optedInAt, row.optedOutAt);

// Programmatic writes (customer-managed 10DLC campaign only)
await inkbox.smsOptIns.optIn("+15551234567");
await inkbox.smsOptIns.optOut("+15551234567");
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

### From the unlocked vault (admin-only)

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

## Admin-only Resources

### Mailboxes (`inkbox.mailboxes`)

```typescript
const mailboxes = await inkbox.mailboxes.list();
const mailbox   = await inkbox.mailboxes.get("abc@inkboxmail.com");

// To rename, use `identity.update({ displayName: "New Name" })` —
// the mailbox PATCH endpoint hard-rejects `display_name` with a 422.
// To attach a webhook receiver, see "Webhooks" below.

// DEPRECATED channel path — the mail filter mode now lives on the identity.
// Prefer `identity.update({ mailFilterMode: "whitelist" })` (which does NOT
// return a change notice). This legacy mailbox flip still works and returns one:
const updated = await inkbox.mailboxes.update(mailbox.emailAddress, {
  filterMode: "whitelist",   // or "blacklist" — see FilterMode enum
});
if (updated.filterModeChangeNotice) {
  // Populated when filterMode actually changed.
  const n = updated.filterModeChangeNotice;
  console.log(n.redundantRuleCount, n.redundantRuleAction, n.newFilterMode);
}

// Mailbox responses now also carry mailbox.agentIdentityId when linked.
// `mailbox.sendingDomain` is the bare domain the mailbox sends from
// (platform default or a verified custom domain — see "Custom email domains" below).

// Storage (list / get / update all carry these):
console.log(mailbox.storageUsedBytes);   // bytes stored, e.g. 1288490188
console.log(mailbox.storageLimitBytes);  // plan cap, e.g. 2147483648 (2 GiB), or null
const usedGib = mailbox.storageUsedBytes / 1024 ** 3;  // caps are BINARY — GiB, not GB
// Over-cap sends throw StorageLimitExceededError (402) — see "Storage cap (402)".

const results = await inkbox.mailboxes.search(mailbox.emailAddress, { q: "invoice", limit: 20 });
// Mailboxes are deleted via the owning identity's cascade — there is no standalone delete:
//   await identity.delete();  // removes the mailbox + tunnel atomically (cascade)
```

### Custom email domains (`inkbox.domains`)

If your org has registered custom sending domains in the console, list them
and (admin-only) set the org default. New mailboxes inherit the org default
unless you pass `sendingDomainId` (standalone) or `sendingDomain` (identity).

```typescript
import { SendingDomainStatus } from "@inkbox/sdk";

const verified = await inkbox.domains.list({ status: SendingDomainStatus.VERIFIED });

// Admin-scoped API key only — non-admin keys get 403.
// Returns the bare new default domain name (or null when reverted to platform).
const newDefault = await inkbox.domains.setDefault("mail.acme.com");
// Pass the platform domain (e.g. "inkboxmail.com" in prod) to clear the org default.

// Identity create: pick by bare domain name (not id).
await inkbox.createIdentity("sales-bot", { sendingDomain: "mail.acme.com" });
// Force the platform default:
await inkbox.createIdentity("sales-bot-2", { sendingDomain: null });
// Standalone mailbox creation is gone — provision via createIdentity above.
```

### Phone Numbers (`inkbox.phoneNumbers`)

```typescript
const numbers = await inkbox.phoneNumbers.list();
const number  = await inkbox.phoneNumbers.get("phone-number-uuid");
const num     = await inkbox.phoneNumbers.provision({ agentHandle: "my-agent", type: "local", state: "NY" });  // local only; toll_free is rejected (422)

await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "webhook",               // "webhook", "auto_accept", "auto_reject", or "hosted_agent"
  incomingCallWebhookUrl: "https://...",
});
await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "auto_accept",
  clientWebsocketUrl: "wss://...",
});
await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "hosted_agent",          // no URL — Voice AI answers
});

const hits = await inkbox.phoneNumbers.searchTranscripts(num.id, { q: "refund", party: "remote", limit: 50 });
await inkbox.phoneNumbers.release(num.id);
```

Phone numbers carry the same `filterMode` / `agentIdentityId` / `filterModeChangeNotice` fields as mailboxes; flipping `filterMode` here is the **deprecated** channel path (admin-only; returns a change-notice when the value actually changed). Prefer `identity.update({ phoneFilterMode: "whitelist" })`, which sets the mode on the identity and does not return a change notice.

## Contact Rules

Allow/block lists are scoped to the **agent identity** (mirroring iMessage), addressed by `agentHandle`. The identity's `mailFilterMode` / `phoneFilterMode` decides whether each channel's rules act as a whitelist or blacklist. Mail matches by exact email or domain; phone matches by exact E.164 number. Returned rows are `MailIdentityContactRule` / `PhoneIdentityContactRule`, keyed by `rule.agentIdentityId` (not a mailbox/phone-number id).

```typescript
import {
  MailRuleAction, MailRuleMatchType, PhoneRuleAction, PhoneRuleMatchType,
  DuplicateContactRuleError,
} from "@inkbox/sdk";

const identity = await inkbox.getIdentity("sales-agent");

// Mail rules via the identity convenience methods. New rules always start
// active; call `update(..., { status: "paused" })` afterwards to pause one.
const rule = await identity.createMailContactRule({
  action: MailRuleAction.ALLOW,          // or BLOCK
  matchType: MailRuleMatchType.DOMAIN,   // or EXACT_EMAIL
  matchTarget: "example.com",
});
await identity.listMailContactRules();
await identity.getMailContactRule(rule.id);
await identity.updateMailContactRule(rule.id, { status: "paused" });  // admin-only
await identity.deleteMailContactRule(rule.id);                        // admin-only

// Phone rules — same shape, only matchType: "exact_number" is supported.
// Phone helpers require the identity to have a phone number (else InkboxError).
await identity.createPhoneContactRule({
  action: PhoneRuleAction.BLOCK,
  matchTarget: "+15551234567",
  matchType: PhoneRuleMatchType.EXACT_NUMBER,
});
await identity.listPhoneContactRules();

// Equivalent org-level resources, keyed by agentHandle, with an org-wide listAll:
await inkbox.mailIdentityContactRules.create("sales-agent", {
  action: "allow", matchType: "domain", matchTarget: "example.com",
});
await inkbox.mailIdentityContactRules.list("sales-agent");
await inkbox.mailIdentityContactRules.listAll({ agentIdentityId: identity.id });  // admin-only, org-wide
await inkbox.phoneIdentityContactRules.listAll();                                 // admin-only, org-wide

// Duplicate (matchType, matchTarget) on the same identity throws 409:
try {
  await identity.createMailContactRule({
    action: "allow", matchType: "domain", matchTarget: "example.com",
  });
} catch (e) {
  if (e instanceof DuplicateContactRuleError) {
    console.log(e.existingRuleId);   // id of the rule that already matched
  }
}
```

### Filter mode

The whitelist/blacklist mode lives on the identity. Flip it with `identity.update`
(admin-only). Unlike the deprecated channel update, this does **not** return a
`FilterModeChangeNotice`. `phoneFilterMode` requires the identity to have a phone
number (else a 422).

```typescript
await identity.update({ mailFilterMode: "whitelist", phoneFilterMode: "blacklist" });
console.log(identity.mailFilterMode, identity.phoneFilterMode);
```

### Deprecated: per-mailbox / per-number rules

The legacy per-mailbox `inkbox.mailContactRules` and per-number
`inkbox.phoneContactRules` resources still work but hit deprecated server routes
(Sunset 2026-08-31). Prefer the identity-keyed surface above.

```typescript
// Deprecated — per-mailbox mail rule:
await inkbox.mailContactRules.create(mailbox.emailAddress, {
  action: "allow", matchType: "domain", matchTarget: "example.com",
});
await inkbox.mailContactRules.listAll({ mailboxId: mailbox.id });
// Deprecated — per-number phone rule:
await inkbox.phoneContactRules.create(num.id, {
  action: "block", matchType: "exact_number", matchTarget: "+15551234567",
});
```

## Contacts

Organization-wide address book with lifecycle review, memory, correspondence, and vCard import/export.

```typescript
import type { CreateContactOptions, ContactEmail, ContactPhone } from "@inkbox/sdk";

// CRUD
const contact = await inkbox.contacts.create({
  givenName: "Ada",
  familyName: "Lovelace",
  emails: [{ label: "work", value: "ada@example.com" }],
  phones: [{ label: "mobile", value: "+15551234567" }],
});
await inkbox.contacts.get(contact.id);
await inkbox.contacts.list({ q: "ada", order: "recent", reviewStatus: ["confirmed"] });
await inkbox.contacts.update(contact.id, { jobTitle: "Analyst" });
await inkbox.contacts.delete(contact.id);
await inkbox.contacts.bulkDelete(["contact-uuid-1", "contact-uuid-2"]);

// Reverse-lookup — exactly one filter required (else thrown before HTTP)
await inkbox.contacts.lookup({ email: "ada@example.com" });
await inkbox.contacts.lookup({ emailDomain: "example.com" });
await inkbox.contacts.lookup({ phone: "+15551234567" });
await inkbox.contacts.lookup({ emailContains: "ada" });
await inkbox.contacts.lookup({ phoneContains: "555" });

// Compatibility access information is read-only
await inkbox.contacts.access.list(contact.id);

// Facts, citations, correspondence, and duplicate merging
const facts = await inkbox.contacts.facts.list(contact.id);
const sourceUrl = facts[0]?.citations[0]?.sourceUrl;
if (sourceUrl) await inkbox.contacts.facts.resolveCitationUrl(sourceUrl);
if (facts[0]) await inkbox.contacts.facts.delete(contact.id, facts[0].id);  // admin only
const history = await inkbox.contacts.correspondence.get(contact.id, {
  identityId: "identity-uuid",
  channels: ["email", "sms"],
});
const survivor = await inkbox.contacts.merge(contact.id, {
  losingContactIds: ["duplicate-contact-uuid"],
});

// vCards
const result = await inkbox.contacts.vcards.import(vcfText);  // bulk, ≤5 MiB, ≤1000 cards
console.log(result.createdIds);
for (const item of result.errors) {
  console.log(item.index, item.error);
}
for (const item of result.conflicts) {
  console.log(item.index, item.conflictingContactId);
}

const vcf = await inkbox.contacts.vcards.export(contact.id);  // vCard 4.0 string
const batch = await inkbox.contacts.vcards.exportMany(["contact-uuid-1", "contact-uuid-2"]);
console.log(batch.vcard);
```

## Notes

Admin-only free-form notes with per-identity access grants. There is no wildcard for notes — grant identities explicitly.

```typescript
const note = await inkbox.notes.create({ body: "Customer prefers email follow-up.", title: "Ada" });
await inkbox.notes.get(note.id);
await inkbox.notes.list({ q: "email", identityId: "agent-uuid", order: "recent", limit: 50 });
await inkbox.notes.update(note.id, { body: "Updated body" });
await inkbox.notes.update(note.id, { title: null });   // clear title; body cannot be null
await inkbox.notes.delete(note.id);

// Access grants (admin + JWT only)
await inkbox.notes.access.list(note.id);
await inkbox.notes.access.grant(note.id, "agent-uuid");
await inkbox.notes.access.revoke(note.id, "agent-uuid");
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

Returns `WhoamiApiKeyResponse` (with `keyId`, `label`, `creatorType`, `authSubtype`, etc.) or `WhoamiJwtResponse` (with `email`, `orgRole`, etc.) — discriminated on `authType`.

For branching on API-key scope, compare against the exported constants:

```typescript
import {
  AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED,
  AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
  AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED,
} from "@inkbox/sdk";

if (info.authType === "api_key" && info.authSubtype === AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED) {
  // admin-only operations (filter_mode flips, rule updates/deletes, etc.)
}
```

## Tunnels

Bring a local Node process online at a public `https://{name}.inkboxwire.com` URL. Outbound HTTP/2 only — no inbound port to open. POSIX only; the data-plane runtime lives on a separate package subpath so the main `@inkbox/sdk` entry stays browser-safe.

```typescript
import { connect } from "@inkbox/sdk/tunnels/connect";

// Forward to a local URL (edge mode — Inkbox terminates TLS at the edge)
const listener = await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",
});
console.log(listener.publicUrl);    // https://my-app.inkboxwire.com
await listener.wait();              // until SIGINT/SIGTERM

// In-process Fetch-API HTTP handler
import type { InkboxHandler } from "@inkbox/sdk/tunnels/connect";

const handler: InkboxHandler = async (req, ctx) => {
  return new Response("hi", { headers: { "content-type": "text/plain" } });
};
await connect(inkbox, { name: "my-app", handler });

// In-process WebSocket handler (HTTP path still required)
import type { InkboxWsHandler } from "@inkbox/sdk/tunnels/connect";

const wsHandler: InkboxWsHandler = async (ws) => {
  await ws.accept();
  for await (const msg of ws) {
    await ws.send(typeof msg === "string" ? `echo: ${msg}` : msg);
  }
};
await connect(inkbox, { name: "my-app", handler, wsHandler });

// Passthrough TLS (SDK terminates; cert auto-signed via the control plane)
// Set tls_mode when you create the identity — it's fixed at create time.
await inkbox.createIdentity("my-app", { tunnel: { tlsMode: "passthrough" } });
await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",
});
```

Tunnels are provisioned atomically by `inkbox.createIdentity(...)`; there is no standalone `create` / `delete` / `restore` / `rotateSecret` surface.

Reads + edit:

```typescript
await inkbox.tunnels.list();
await inkbox.tunnels.get("tunnel-uuid");
await inkbox.tunnels.update("tunnel-uuid", {
  metadata: { team: "gtm" },
});
// Passthrough only:
await inkbox.tunnels.signCsr("tunnel-uuid", { csrPem });
```

Data-plane auth uses the same `apiKey` the `Inkbox` client was constructed with — admin-scoped or identity-scoped (matching the tunnel's identity). Mint a per-agent identity-scoped key via `inkbox.apiKeys.create({ scopedIdentityId })`. Selected `connect()` options: `poolSize` (1–32), `stateDir` (default `~/.inkbox/tunnels/{name}`), `onStatus` callback, `allowRemoteForwarding: false` (loopback-only allowlist), `forwardToVerifyTls: true`, `forwardToCaBundle`. In passthrough mode the state dir holds the per-tunnel private key — treat it like an SSH key dir.

For full options, lifecycle notes, and Python examples, see `skills/inkbox-tunnels/SKILL.md`.

## Webhooks & Signature Verification

Webhooks are configured directly on the mailbox or phone number — no separate registration.

```typescript
import {
  verifyWebhook,
  MailWebhookPayload, TextWebhookPayload, PhoneIncomingCallWebhookPayload,
} from "@inkbox/sdk";

// Each agent identity has its own webhook signing key. Create/rotate it
// (plaintext returned once — save it), or read its status:
const key = await identity.createSigningKey();                 // → SigningKey
const status = await identity.getSigningKeyStatus();           // → SigningKeyStatus { configured, createdAt }
// Org-level resource, keyed by agentHandle:
const key2 = await inkbox.signingKeys.createOrRotate("sales-agent");
const status2 = await inkbox.signingKeys.getStatus("sales-agent");
// DEPRECATED: org-level inkbox.createSigningKey() — with an agent-scoped key it
// still rotates that identity's key; with an admin key the server returns 409.

// Verify, then parse + discriminate
const valid = verifyWebhook({
  payload: req.body,                                           // Buffer or string
  headers: req.headers as Record<string, string>,
  secret: "whsec_...",
});
if (!valid) return res.status(403).end();
const payload = JSON.parse(req.body.toString()) as TextWebhookPayload;
if (payload.event_type === "text.delivery_failed") {
  console.error(payload.data.text_message.error_code, payload.data.text_message.error_detail);
}
```

Headers checked: `x-inkbox-signature`, `x-inkbox-request-id`, `x-inkbox-timestamp`.
Algorithm: HMAC-SHA256 over `"{requestId}.{timestamp}.{body}"`.

**Event taxonomy:**

- **Mail** (envelope, fire-and-forget) — `message.received`, `message.sent`, `message.forwarded`, `message.delivered`, `message.bounced`, `message.failed`. Subscribe via `inkbox.webhooks.subscriptions.create({ mailboxId, url, eventTypes })`. On `message.received`, `data.message` includes the plain-text `body` (whole under a size cap, else a prefix with `body_truncated: true` / `body_state: "truncated"`); when truncated, hydrate with `inkbox.messages.get(message.email_address, message.id)` — use `id` (row id), not `message_id` (RFC 5322 header). Present-with-`null` on the other events, absent on pre-feature payloads.
- **Text** (envelope, fire-and-forget) — `text.received`, `text.sent`, `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed`. Subscribe via `inkbox.webhooks.subscriptions.create({ phoneNumberId, url, eventTypes })`. The text-message body carries `delivery_status` as an outbound message-level rollup; 1:1 traffic also hoists `error_code`, `error_detail`, `sent_at`, `delivered_at`, and `failed_at`. On group outbound those legacy detail fields are `null` and per-recipient state lives in `recipients[]`.
- **iMessage** (envelope, fire-and-forget) — `imessage.received`, `imessage.reaction_received`, plus the outbound delivery lifecycle `imessage.sent`, `imessage.delivered`, `imessage.delivery_failed` (declined/error; details on the message object). Subscribe via `inkbox.webhooks.subscriptions.create({ agentIdentityId, url, eventTypes })` — owned by the **agent identity**, since shared iMessage pool numbers are not org resources. `data.message` is populated on `imessage.received` and the three delivery-lifecycle events; `data.reaction` on `imessage.reaction_received`. Fan-out only happens while the identity is active and `imessageEnabled`; contact-rule-blocked traffic is never delivered.
- **Call lifecycle** (envelope, fire-and-forget + replayable) — `call.ended`, owned by the **agent identity** (like iMessage). Subscribe via `inkbox.webhooks.subscriptions.create({ agentIdentityId, url, eventTypes: ["call.ended"] })`. `CallEndedWebhookPayload.data` carries the `call` (`WebhookPhoneCall`, with derived `duration_seconds`), resolved `contacts` / `agent_identities`, an always-present `transcript_url` (authoritative verbatim, fetch with an admin API key), and an inline `transcript` block (`WebhookCallTranscript`, middle-cut/abridged) present when the platform captured a transcript for the call, otherwise `null` — discriminate a turn from the abridgment marker on `"marker" in entry`. Voice AI call fields (all optional so pre-Voice AI payloads parse): `data.call` carries `mode` / `reason`; `data` carries `outcome` (`"completed" | "no_answer" | "declined" | "failed"`, `null` iff `mode` is `client_websocket`) and `post_call_action_items` (open items only, seq-ascending, mirroring `PhoneCall.postCallActionItems`). Voice AI calls fire `call.ended` on **every** terminal state (including never-connected ones like `no_answer`), not just connected calls. An identity may hold a `call.ended` sub and an `imessage.*` sub independently, but one subscription carries a single channel.
- **Inbound call** (flat, synchronous) — `PhoneIncomingCallWebhookPayload` on a phone number's `incomingCallWebhookUrl`. Not subscribable; the URL stays on the phone-number resource because the response (`action: "answer" | "reject"` + optional `clientWebsocketUrl`) decides the call's fate. Non-200, invalid bodies, and timeouts are treated as "decline routing" by Inkbox. (Contrast `call.ended` above, which is the replayable post-call fan-out.)

**Subscription resource:** `inkbox.webhooks.subscriptions.{list,get,create,update,delete}`. Each subscription names exactly one owner (mailbox, phone number, **or** agent identity), one HTTPS destination URL, and a non-empty subset of the catalog's event types. Multiple subscriptions on the same owner fan out independently (cap: 20 active per owner). The SDK runs structural + prefix validation client-side (exactly-one-FK, non-empty distinct events, no `phone.incoming_call`, and one channel per subscription — `message.` / `text.` / `imessage.` / `call.` prefix matching the owner's channel, where an agent identity owns both `imessage.*` and `call.ended`) so most shape mistakes surface as `Error` before the request leaves the client. The server remains authoritative for the exact event-name enum, so a typo with a valid prefix (e.g. `message.received_typo`) passes the SDK's check and is rejected as 422 by the server.

`create(...)` returns a `WebhookSubscriptionCreateResponse`. The **first** subscription created for an identity that has no signing key yet carries that identity's `signingKey` **once** (otherwise `null`) — capture it then, it cannot be retrieved again. Every subscription (read or created) also carries `ownerIdentityId`, the resolved owning agent identity (mail/phone/iMessage).

```typescript
const created = await inkbox.webhooks.subscriptions.create({
  mailboxId: mailbox.id, url: "https://example.com/hook", eventTypes: ["message.received"],
});
console.log(created.ownerIdentityId);
if (created.signingKey) saveSecret(created.signingKey);   // populated once if the identity had no key yet
```

**Conversation context:** opt a subscription into per-class history on **received** events (`message.received`, `text.received`, `imessage.received`) with `contextConfig` — `email` / `texts` / `calls`, each `{ mode: "count", count: N }` (1..50) or `{ mode: "window", hours: H }` (1..168). On `update` it is tri-state: omit = unchanged, `null` = clear, object = replace. Received-event payloads then carry an optional `payload.data.context` keyed by class; optional fields are absent, not `null`, so guard with `?.`. A skipped class ships `items: []` plus a `skipped` reason; call transcript entries are turns or an abridgment marker, discriminated on `"marker" in entry`. Config types `WebhookContextConfig` / `WebhookContextClassConfig` and payload types `WebhookContext` / `WebhookContextBlock` / `WebhookTranscriptEntry` (and the item types) are exported from `@inkbox/sdk`.

```typescript
await inkbox.webhooks.subscriptions.create({
  mailboxId: mailbox.id, url: "https://example.com/hook",
  eventTypes: ["message.received"],
  contextConfig: { email: { mode: "count", count: 10 } },
});
await inkbox.webhooks.subscriptions.update(created.id, { contextConfig: null });  // clear
```

**Mail contact / identity resolution:** `data.contacts` and `data.agent_identities` are lists of `{ bucket, address, id, ... }` entries (always present, possibly empty). Inbound events resolve `from` + every `cc`; outbound events resolve every `to` + `cc` + `bcc`. Pair entries to the source field by `(bucket, address)`. Outbound payloads also carry `data.message.bcc_addresses` (`null` on inbound, since BCC is not visible to recipients).

**Phone/text contact / identity resolution:** `data.contacts` (text) and top-level `contacts` (inbound call) are lists of `{ id, name }` matches; `data.agent_identities` mirrors that for matched agent identities. Scoped to the identity that owns the receiving phone number; both default to `[]` when nothing matches. Group text events carry per-recipient delivery rows in `data.text_message.recipients`; **outbound group lifecycle** events name the event target in `data.recipient_phone_number` (one webhook per recipient leg). Inbound and outbound 1:1 events leave `data.recipient_phone_number` as `null` — the singular peer is already in `data.text_message.remote_phone_number` (inbound) or `data.text_message.recipients[0]` (outbound 1:1).

Exported wire types: `MailWebhookPayload`, `TextWebhookPayload`, `IMessageWebhookPayload`, `PhoneIncomingCallWebhookPayload`, `WebhookContact`, `WebhookAgentIdentity`, `WebhookMailContact`, `WebhookMailAgentIdentity`, `RawTextMessageRecipient`, the conversation-context shapes (`WebhookContext`, `WebhookContextBlock`, `WebhookTranscriptEntry`, and item types), plus event-type string unions (`MailWebhookEventType`, `TextWebhookEventType`, `IMessageWebhookEventType`) and wire enums (`MessageStatus`, `CallStatusWire`, `HangupReasonWire`, `SmsDeliveryStatusWire`, etc.). All fields are snake_case to match the raw JSON body.

## Error Handling

```typescript
import {
  InkboxAPIError,
  DuplicateContactRuleError,
  RedundantContactAccessGrantError,
  StorageLimitExceededError,
} from "@inkbox/sdk";

try {
  const identity = await inkbox.getIdentity("unknown");
} catch (e) {
  if (e instanceof InkboxAPIError) {
    console.log(e.statusCode);   // HTTP status (e.g. 404)
    console.log(e.detail);       // string for legacy errors, object for structured ones
  }
}
```

`InkboxAPIError.detail` is typed as `InkboxAPIErrorDetail` — either a string or a structured object. Catch the narrower subclasses when you need the parsed fields:

- `DuplicateContactRuleError` — 409 when creating a contact rule with an already-taken `(matchType, matchTarget)` on the same resource. Exposes `.existingRuleId: string`.
- `RedundantContactAccessGrantError` — 409 when an identity-viewer grant is redundant (e.g. a specific viewer on top of an active wildcard). Exposes `.error` and `.detailMessage`.
- `StorageLimitExceededError` — 402 when a send / reply-all / forward would push the mailbox past its plan storage cap. Exposes `.message` (also as `.detailMessage`), `.upgradeUrl`, and `.limitBytes`. Delete messages or threads to free space (immediate), or upgrade. A `402` whose `detail` is a plain string stays a plain `InkboxAPIError`.

## Key Conventions

- All method and property names are **camelCase**
- `iterEmails()` / `iterUnreadEmails()` return `AsyncGenerator<Message>` — use `for await...of`
- `listCalls()` returns `Promise<PhoneCall[]>` — offset pagination, not a generator
- To clear a nullable field (e.g. webhook URL), pass `field: null`
- No context manager needed — `new Inkbox({...})` is all that's required
- All methods are `async` and return Promises — always `await` them

# @inkbox/sdk

TypeScript SDK for the [Inkbox API](https://inkbox.ai/docs) — API-first communication infrastructure for AI agents (email, phone, identities, encrypted vault — login credentials, API keys, key pairs, SSH keys, OTP, etc.).

## Install

```bash
npm install @inkbox/sdk
```

Requires Node.js ≥ 22.

> **Note on Workers/Deno/browsers.** The control-plane CRUD surface
> (`inkbox.tunnels.list/get/create/...` etc.) is portable to Workers,
> Deno, and browsers — it only depends on the global `fetch`. The
> data-plane runtime exposed via `import { connect } from
> "@inkbox/sdk/tunnels/connect"` requires `node:http2`, `node:tls`,
> and `node:net`, so that subpath is Node-only. Use the Python SDK
> (`inkbox.tunnels.connect()`) if you need to run the data plane on a
> non-Node runtime.

## Authentication

You'll need an API key to use this SDK. Get one at [inkbox.ai/console](https://inkbox.ai/console).

`new Inkbox(...)` resolves `apiKey` / `baseUrl` / `vaultKey` from the explicit option, then the matching env var (`INKBOX_API_KEY` / `INKBOX_BASE_URL` / `INKBOX_VAULT_KEY`), then a `~/.inkbox/config` file (`key = value` lines). The file fallback is handy for background/agent processes that don't inherit the shell's env, so `new Inkbox()` with no arguments works once the file is in place.

**Behind a proxy?** The SDK uses Node's `fetch`, which ignores `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` by default — run with `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24+) or, on older versions, configure a proxy-aware fetch dispatcher (e.g. undici's `EnvHttpProxyAgent`). A request that can't connect throws `InkboxConnectionError` naming the URL and underlying cause, with this hint attached when proxy variables are set but unused.

## Quick start

```ts
import { Inkbox } from "@inkbox/sdk";

const inkbox = await new Inkbox({
  apiKey: process.env.INKBOX_API_KEY!,
  vaultKey: process.env.INKBOX_VAULT_KEY,
}).ready();

// Create an agent identity with a linked mailbox
const identity = await inkbox.createIdentity("support-bot", { displayName: "Support Bot" });
const phone = await identity.provisionPhoneNumber(); // provisions a local number

// Send email directly from the identity
await identity.sendEmail({
  to: ["customer@example.com"],
  subject: "Your order has shipped",
  bodyText: "Tracking number: 1Z999AA10123456784",
});

// Place an outbound call
await identity.placeCall({
  toNumber: "+18005559999",
  clientWebsocketUrl: "wss://my-app.com/voice",
});

// Read inbox
for await (const message of identity.iterEmails()) {
  console.log(message.subject);
}

// List calls
const calls = await identity.listCalls();

// Access credentials (vault unlocked at construction)
const creds = await identity.getCredentials();
for (const login of creds.listLogins()) {
  console.log(login.name);
}
```

## Authentication

| Option | Type | Default | Description |
|---|---|---|---|
| `apiKey` | `string` | required | Your `ApiKey_...` token |
| `baseUrl` | `string` | API default | Override for self-hosting or testing |
| `timeoutMs` | `number` | `30000` | Request timeout in milliseconds |

---

## Agent Signup

Agents can self-register without a pre-existing API key. All signup methods are **static** — no `Inkbox` instance required.

```ts
import { Inkbox } from "@inkbox/sdk";

// Sign up (public — no API key needed)
const result = await Inkbox.signup({
  humanEmail: "john@example.com",
  noteToHuman: "Hey John, this is your sales bot signing up!",
  displayName: "Sales Agent",      // optional
  agentHandle: "sales-agent",      // optional
  emailLocalPart: "sales.agent",   // optional
});
const apiKey = result.apiKey;          // save — shown only once
const email = result.emailAddress;     // e.g. "sales-agent-a1b2c3@inkboxmail.com"
const handle = result.agentHandle;     // e.g. "sales-agent-a1b2c3"

// Verify (after human shares the 6-digit code from the email)
await Inkbox.verifySignup(apiKey, { verificationCode: "483921" });

// Resend verification email (5-minute cooldown)
await Inkbox.resendSignupVerification(apiKey);

// Check status and restrictions
const status = await Inkbox.getSignupStatus(apiKey);
console.log(status.claimStatus);                    // "agent_unclaimed" or "agent_claimed"
console.log(status.restrictions.maxSendsPerDay);    // 10 (unclaimed) or 500 (claimed)
```

| Method | Auth | Returns |
|---|---|---|
| `Inkbox.signup(request, options?)` | None | `AgentSignupResponse` |
| `Inkbox.verifySignup(apiKey, request, options?)` | API key | `AgentSignupVerifyResponse` |
| `Inkbox.resendSignupVerification(apiKey, options?)` | API key | `AgentSignupResendResponse` |
| `Inkbox.getSignupStatus(apiKey, options?)` | API key | `AgentSignupStatusResponse` |

`request` for `signup()` requires `humanEmail` and `noteToHuman`. `displayName`, `agentHandle`, and `emailLocalPart` are optional. All methods accept an optional `options` object with `baseUrl` and `timeoutMs`.

> **Note:** Unclaimed agents have a limited send quota and can only email the `humanEmail` specified at signup. After verification or human approval in the console, full capabilities are unlocked.

> **Note:** The `organizationId` returned at signup may change after verification or human approval. Always use the `organizationId` from the most recent response (`verifySignup` or `resendSignupVerification`) rather than caching the value from the initial `signup()` call.

---

## Identities

`inkbox.createIdentity()` and `inkbox.getIdentity()` return an `AgentIdentity` object that holds the identity's channels and exposes convenience methods scoped to those channels.

```ts
// Create and fully provision an identity
// createIdentity atomically provisions the mailbox AND the tunnel —
// both come back on the response. Phone numbers stay opt-in.
const identity = await inkbox.createIdentity("sales-bot", {
  displayName: "Sales Bot",
  description: "Sales-outreach agent",
});
const phone    = await identity.provisionPhoneNumber(); // provisions a local number

console.log(identity.emailAddress);            // sales-bot@inkboxmail.com
console.log(identity.tunnel?.publicHost);      // sales-bot.inkboxwire.com
console.log(phone.number);

// Pin the identity's mailbox to a verified custom sending domain
// (bare name; see "Custom Sending Domains" below).
await inkbox.createIdentity("sales-bot-2", { sendingDomain: "mail.acme.com" });

// Provision a passthrough tunnel (tls_mode is fixed at create time)
await inkbox.createIdentity("sales-bot-pt", { tunnel: { tlsMode: "passthrough" } });

// Get an existing identity (returned with current channel state)
const identity2 = await inkbox.getIdentity("sales-bot");
await identity2.refresh();  // re-fetch channels from API

// List all identities for your org
const allIdentities = await inkbox.listIdentities();

// Update status or handle
await identity.update({ status: "paused" });
await identity.update({ newHandle: "sales-bot-v2" });

// Release the phone number (carrier release + local delete). Mailbox and
// tunnel are 1:1 with the identity and can only be removed by deleting it.
await identity.releasePhoneNumber();

// Delete (cascades to mailbox + tunnel + phone-number release; revokes scoped API keys).
await identity.delete();
```

### Identity visibility

Control which other agent identities can see this identity in API responses.
Humans and admins always see every identity regardless.

```ts
const identity = await inkbox.getIdentity("sales-bot");

// List the current visibility rules. Either a single wildcard row
// (viewerIdentityId === null — every active identity sees it) or
// explicit per-viewer rows. An empty list means no agent can see it.
const rules = await identity.listAccess();

// Grant one viewer identity visibility
const viewer = await inkbox.getIdentity("support-bot");
await identity.grantAccess(viewer.id);

// Make it visible to every active identity in the org (wildcard)
await identity.grantAccess(null);

// Revoke one viewer (keyed by the viewer identity's UUID)
await identity.revokeAccess(viewer.id);
```

---

## Mail

```ts
// Send an email (plain text and/or HTML)
const sent = await identity.sendEmail({
  to: ["user@example.com"],
  subject: "Hello from Inkbox",
  bodyText: "Hi there!",
  bodyHtml: "<p>Hi there!</p>",
  cc: ["manager@example.com"],
  bcc: ["archive@example.com"],
});

// Send a threaded reply
await identity.sendEmail({
  to: ["user@example.com"],
  subject: `Re: ${sent.subject}`,
  bodyText: "Following up!",
  inReplyToMessageId: sent.id,
});

// Send with attachments
await identity.sendEmail({
  to: ["user@example.com"],
  subject: "See attached",
  bodyText: "Please find the file attached.",
  attachments: [{
    filename: "report.pdf",
    contentType: "application/pdf",
    contentBase64: "<base64-encoded-content>",
  }],
});

// Inline images: set contentId on an image attachment and reference it from
// bodyHtml as cid:<contentId>. Requires bodyHtml + an image/* contentType, a
// unique id per send, and is not supported on forwards.
await identity.sendEmail({
  to: ["user@example.com"],
  subject: "Weekly report",
  bodyHtml: '<p>Revenue:</p><img src="cid:chart">',
  attachments: [{
    filename: "chart.png",
    contentType: "image/png",
    contentBase64: "<base64-encoded-content>",
    contentId: "chart",
  }],
});

// Track opens: embed a tracking pixel when an HTML body is present. Opens
// surface on the returned Message as firstOpenedAt / openCount.
const tracked = await identity.sendEmail({
  to: ["user@example.com"],
  subject: "Did you see this?",
  bodyHtml: "<p>Please review.</p>",
  trackOpens: true,
});
console.log(tracked.firstOpenedAt, tracked.openCount);
// Caveats: plain-text-only sends aren't tracked;
// openCount is approximate (proxy prefetch inflates it, the per-window
// debounce collapses repeats — so it can read above or below the true
// count); prefer firstOpenedAt. Pixels can also raise spam scores.

// Iterate inbox (paginated automatically)
for await (const msg of identity.iterEmails()) {
  console.log(msg.subject, msg.fromAddress, msg.isRead);
}

// Filter by direction: "inbound" or "outbound"
for await (const msg of identity.iterEmails({ direction: "inbound" })) {
  console.log(msg.subject);
}

// Iterate only unread emails
for await (const msg of identity.iterUnreadEmails()) {
  console.log(msg.subject);
}

// Mark messages as read (or unread)
const unread: string[] = [];
for await (const msg of identity.iterUnreadEmails()) unread.push(msg.id);
await identity.markEmailsRead(unread);
await identity.markEmailsUnread(["message-uuid"]);

// Get all emails in a thread (threadId comes from msg.threadId)
const thread = await identity.getThread(msg.threadId!);
for (const m of thread.messages) {
  console.log(m.subject, m.fromAddress);
}
```

Fetching a single inbound message by id (`inkbox.messages.get`, below)
with an API key marks it read server-side (`isRead` becomes `true`);
iterating via `iterEmails` / `iterUnreadEmails` does not, so
`markEmailsRead` stays the way to clear unread in list-only workflows.
This server-side `isRead` (the agent consumed the message via the API) is
distinct from `firstOpenedAt` (the recipient's mail client loaded the
tracking pixel).

### Mailbox storage

Every mailbox has a plan storage cap. Sends, reply-alls, and forwards that
would push it over the cap are rejected with a `402` —
`StorageLimitExceededError`:

```ts
import { StorageLimitExceededError } from "@inkbox/sdk";

try {
  await identity.sendEmail({ to: ["user@example.com"], subject: "Hi", bodyText: "…" });
} catch (err) {
  if (err instanceof StorageLimitExceededError) {
    console.log(err.message);                    // human-readable, includes the limit
    console.log(err.limitBytes, err.upgradeUrl); // e.g. 2147483648, https://…?tab=billing
    // Free space (reclaim is immediate) or upgrade the plan:
    await inkbox.messages.delete(mailbox.emailAddress, "message-uuid");
    await inkbox.threads.delete(mailbox.emailAddress, "thread-uuid");
  }
}
```

Current usage lives on the mailbox (`inkbox.mailboxes.list()` / `.get()`):

```ts
const mailbox = await inkbox.mailboxes.get("abc-xyz@inkboxmail.com");
console.log(mailbox.storageUsedBytes);  // e.g. 1288490188
console.log(mailbox.storageLimitBytes); // e.g. 2147483648 (2 GiB), or null if unresolved

const usedGiB = mailbox.storageUsedBytes / 1024 ** 3; // caps are binary — GiB, not GB
```

The caps are **binary**: 2 GiB is `2 * 1024 ** 3` = 2,147,483,648 bytes. Divide
by 1024 and label the result GiB/MiB.

> **Free plan:** a footer is appended to the **stored** body of outgoing mail,
> so what you read back with `inkbox.messages.get(...)` is not byte-for-byte
> what you sent — a `sentBody === fetchedBody` round-trip assertion will fail
> on Free plans (a send with no body comes back with the footer as its body).
> Paid plans are unaffected.

---

## Phone

```ts
// Place an outbound call — stream audio over WebSocket
const call = await identity.placeCall({
  toNumber: "+15551234567",
  clientWebsocketUrl: "wss://your-agent.example.com/ws",
});
console.log(call.status, call.rateLimit.callsRemaining);

// List calls (paginated)
const calls = await identity.listCalls({ limit: 10, offset: 0 });
for (const c of calls) {
  console.log(c.id, c.direction, c.remotePhoneNumber, c.status);
}

// Fetch transcript segments for a call
const segments = await identity.listTranscripts(calls[0].id);
for (const t of segments) {
  console.log(`[${t.party}] ${t.text}`);  // party: "local" or "remote"
}

// Read transcripts across all recent calls
const recentCalls = await identity.listCalls({ limit: 10 });
for (const call of recentCalls) {
  const segs = await identity.listTranscripts(call.id);
  if (!segs.length) continue;
  console.log(`\n--- Call ${call.id} (${call.direction}) ---`);
  for (const t of segs) {
    console.log(`  [${t.party.padEnd(6)}] ${t.text}`);
  }
}

// Filter to only the remote party's speech
const remoteOnly = segments.filter(t => t.party === "remote");
for (const t of remoteOnly) console.log(t.text);

// Search transcripts across a phone number (org-level)
const hits = await inkbox.phoneNumbers.searchTranscripts(phone.id, { q: "refund", party: "remote" });
for (const t of hits) {
  console.log(`[${t.party}] ${t.text}`);
}
```

---

## Text Messages (SMS/MMS)

Send and receive SMS/MMS through the identity's assigned phone number.

**Outbound SMS rules (read before sending):**

- Each sender phone number is rate-limited to **100 recipient sends per rolling 24-hour window**. A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- A new local number takes **~10-15 minutes** for the 10DLC campaign to propagate at the carrier — `phoneNumber.smsStatus` reads `"pending"` until then, and sends will return `409 sender_sms_pending`.
- The recipient must have texted **`START`** to any number within your organization to opt in. Unknown recipients will fail with `403 recipient_not_opted_in`; recipients who later send `STOP` flip to `403 recipient_opted_out`. You can inspect consent state directly via `inkbox.smsOptIns` — see [SMS Opt-Ins](#sms-opt-ins).
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands and campaigns lift the default per-number cap to the carrier-assigned tier.

**TypeScript users:** group rows can legitimately have no single remote party, so text/conversation/webhook `remotePhoneNumber` / `remote_phone_number` fields are typed as `string | null`. One-to-one traffic still populates the remote number.

```ts
// Send SMS/MMS. Returns a queued TextMessage; final delivery state
// arrives via any webhook subscription on the sender's phone number
// whose eventTypes include the text.* lifecycle events.
const sent = await identity.sendText({
  to: "+15551234567",
  text: "Hello from Inkbox",
});
console.log(sent.id, sent.deliveryStatus);   // "queued"

// Group MMS uses the same method with an array of recipients.
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

// List text messages
const texts = await identity.listTexts({ limit: 20 });
for (const t of texts) {
  console.log(t.remotePhoneNumber, t.text, t.isRead);
}

// Filter to unread only
const unread = await identity.listTexts({ isRead: false });

// Get a single text
const text = await identity.getText("text-uuid");
console.log(text.type);  // "sms" or "mms"
if (text.media) {         // MMS attachments (temporary signed URLs)
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

// Mark as read
await identity.markTextRead("text-uuid");
await identity.markTextConversationRead("+15551234567");

// Org-level: search and delete
const results = await inkbox.texts.search(phone.id, { q: "invoice", limit: 20 });
await inkbox.texts.update(phone.id, "text-uuid", { status: "deleted" });
```

---

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The
registry is updated automatically when recipients text `START` / `STOP` to any
of your numbers (`source: "sms"`).

**Reads** — open to admin API keys and user session JWTs.

```ts
import { SmsOptInStatus } from "@inkbox/sdk";

// List the org's consent rows (newest-updated first; server caps limit at 200)
const rows = await inkbox.smsOptIns.list({ limit: 50 });
const optedOut = await inkbox.smsOptIns.list({ status: SmsOptInStatus.OPTED_OUT });

// Look up one recipient — 404 → InkboxAPIError if no row exists
const row = await inkbox.smsOptIns.get("+15551234567");
console.log(row.status, row.source, row.optedInAt, row.optedOutAt);
```

**Writes** — admin-only, and only if your org runs its own active, customer-managed 10DLC
campaign. Orgs on the Inkbox-default campaign share consent state and get a
`409 customer_campaign_required` on write attempts. Writes record an audit
event with `source: "api"`.

```ts
// Record consent captured outside of STOP/START (signup form, paper waiver, etc.)
await inkbox.smsOptIns.optIn("+15551234567");

// Honor an opt-out collected outside of inbound STOP
await inkbox.smsOptIns.optOut("+15551234567");
```

---

## iMessage

Chat with humans over the shared Inkbox router or a dedicated number.
iMessage is **opt-in per identity** (`imessageEnabled`). On the shared
service and dedicated inbound numbers, the human texts first. Dedicated
outbound numbers may initiate conversations, subject to consent and rate
limits.

```ts
import {
  DedicatedIMessageNumberInventoryPendingError,
  DedicatedIMessageNumberQuotaExceededError,
  IdempotencyKeyReusedError,
  IMessageNumberType,
} from "@inkbox/sdk";

// Shared service: opt an identity in at create time or later.
const identity = await inkbox.createIdentity("my-agent", { imessageEnabled: true });

// Resolve the router number at runtime — never hardcode it.
const router = await inkbox.imessages.getTriageNumber();
console.log(router.number, router.connectCommand); // e.g. 'connect @my-agent'

// Once a human has connected and messaged, read and reply.
const convos = await identity.listIMessageConversations({ limit: 20 });
const msgs = await identity.listIMessages({ conversationId: convos[0].id });
await identity.sendIMessage({
  conversationId: convos[0].id,
  text: "On it — give me two minutes.",
});

// Who is currently connected? (Disconnected conversations stay readable
// with assignmentStatus === "released"; sends into them return 409.)
const connections = await identity.listIMessageAssignments();

// Tapbacks: classic six on send ("custom" is inbound-only, 422 on send);
// a new tapback replaces your previous one on the same message part.
// Reactions, read receipts, and typing indicators return 409 for groups.
await identity.sendIMessageReaction({ messageId: msgs[0].id, reaction: "like" });

// Read receipts, typing indicator, media.
await identity.markIMessageConversationRead(convos[0].id);
await identity.sendIMessageTyping(convos[0].id);
const upload = await identity.uploadIMessageMedia({
  content: fileBytes,
  filename: "chart.png",
  contentType: "image/png",
});
await identity.sendIMessage({ conversationId: convos[0].id, mediaUrls: [upload.mediaUrl] });

// Per-identity allow/block rules, interpreted via imessageFilterMode.
await inkbox.imessageContactRules.create("my-agent", {
  action: "block",
  matchTarget: "+15555550999",
});

// List every dedicated number owned by the organization. Unattached numbers
// have null agentIdentityId and agentHandle fields.
const numbers = await inkbox.imessages.listNumbers();
for (const number of numbers) {
  const canInitiate = number.type === IMessageNumberType.DEDICATED_OUTBOUND;
  console.log(number.number, number.agentHandle, canInitiate);
}

// Claim an unattached number for the organization. Generate the key once and
// reuse it if the request has an ambiguous outcome; a new key can claim again.
const claimKey = crypto.randomUUID();
try {
  const claimed = await inkbox.imessages.claimNumber({
    type: IMessageNumberType.DEDICATED_INBOUND,
    idempotencyKey: claimKey,
  });
  console.log(claimed.number);
} catch (err) {
  if (err instanceof DedicatedIMessageNumberQuotaExceededError) {
    console.error(err.message, err.upgradeUrl);
  } else if (err instanceof DedicatedIMessageNumberInventoryPendingError) {
    console.error(`Try again in ${err.retryAfterSeconds} seconds`);
  } else if (err instanceof IdempotencyKeyReusedError) {
    console.error(err.message);
  } else {
    throw err;
  }
}

// Claim and attach atomically during identity creation.
const outboundIdentity = await inkbox.createIdentity("outreach-agent", {
  imessageEnabled: true,
  imessageNumberType: IMessageNumberType.DEDICATED_OUTBOUND,
});
console.log(outboundIdentity.imessageNumber?.number);

// Dedicated outbound only: create or reuse an exact-participant group. Keep
// the returned conversationId for later replies. An ambiguous best-known match
// returns 409 instead of choosing a conversation.
const group = await outboundIdentity.sendIMessage({
  to: ["+15551234567", "+15557654321"],
  text: "Welcome to the group!",
});
await outboundIdentity.sendIMessage({
  conversationId: group.conversationId,
  text: "Following up in the same conversation.",
});
const groupConvos = await outboundIdentity.listIMessageConversations({ includeGroups: true });
const groupMessages = await outboundIdentity.listIMessages({ includeGroups: true });
console.log(group.isGroup, group.participants, group.recipients);

// Claim and atomically attach/swap during update. To attach an already-owned
// number, pass imessageNumberId instead. Pass imessageNumberId: null to move
// back to shared service. imessageNumberType and imessageNumberId cannot be
// combined in one update.
await identity.update({
  imessageNumberType: IMessageNumberType.DEDICATED_INBOUND,
  idempotencyKey: crypto.randomUUID(),
});
```

Inbound messages, tapbacks, and outbound delivery status arrive via
identity-owned webhook subscriptions — see
[Webhooks](#webhooks) for the five `imessage.*` event types.

---

## Credentials

Access credentials stored in the vault through the agent-facing `credentials` surface. The vault must be unlocked first.

```ts
// Unlock the vault (once per session)
await inkbox.vault.unlock("my-Vault-key-01!");

const identity = await inkbox.getIdentity("my-agent");
const creds = await identity.getCredentials();

// Discovery — list credentials this identity has access to
for (const login of creds.listLogins()) {
  console.log(login.name, (login.payload as LoginPayload).username);
}

for (const key of creds.listApiKeys()) {
  console.log(key.name, (key.payload as APIKeyPayload).accessKey);
}

// Access by UUID — returns the typed payload directly
const login  = creds.getLogin("secret-uuid");    // → LoginPayload
const apiKey = creds.getApiKey("secret-uuid");    // → APIKeyPayload
const sshKey = creds.getSshKey("secret-uuid");    // → SSHKeyPayload

// Generic access
const secret = creds.get("secret-uuid");          // → DecryptedVaultSecret
```

---

## Vault Management

Manage the encrypted vault at the org level. Access via `inkbox.vault`.

```ts
// Get vault metadata (key counts, secret counts)
const info = await inkbox.vault.info();
console.log(info.secretCount, info.keyCount);

// Initialize a new vault (creates primary key + recovery keys)
const result = await inkbox.vault.initialize("my-Vault-key-01!");
for (const key of result.recoveryKeys) {
  console.log(key.recoveryCode); // save these immediately
}

// Rotate the vault password
await inkbox.vault.updateKey({
  newVaultKey: "new-Vault-key-02!",
  currentVaultKey: "my-Vault-key-01!",
});

// Rotate using a recovery code (if primary key is lost)
await inkbox.vault.updateKey({
  newVaultKey: "new-Vault-key-02!",
  recoveryCode: "recovery-code-here",
});

// List vault keys
const keys = await inkbox.vault.listKeys();                          // all keys
const primaryKeys = await inkbox.vault.listKeys({ keyType: "PRIMARY" });
const recoveryKeys = await inkbox.vault.listKeys({ keyType: "RECOVERY" });

// List secrets (metadata only — no encrypted payloads)
const secrets = await inkbox.vault.listSecrets();
const logins  = await inkbox.vault.listSecrets({ secretType: "login" });

// Delete a secret
await inkbox.vault.deleteSecret("secret-uuid");

// Unlock the vault for decryption (returns an UnlockedVault)
const unlocked = await inkbox.vault.unlock("my-Vault-key-01!");
const secret = await unlocked.getSecret("secret-uuid");
console.log(secret.name, secret.payload);
```

### Access control

Control which identities can access which secrets.

```ts
// List access rules for a secret
const rules = await inkbox.vault.listAccessRules("secret-uuid");
for (const rule of rules) {
  console.log(rule.identityId);
}

// Grant an identity access to a secret
await inkbox.vault.grantAccess("secret-uuid", "identity-uuid");

// Revoke access
await inkbox.vault.revokeAccess("secret-uuid", "identity-uuid");
```

---

## Identity Secret Management

Manage vault secrets scoped to a specific identity. These methods create secrets and automatically grant the identity access.

```ts
const identity = await inkbox.getIdentity("my-agent");

// Create a secret and auto-grant this identity access
const secret = await identity.createSecret({
  name: "CRM Login",
  payload: { type: "login", username: "bot@crm.com", password: "s3cret" },
  description: "CRM service account",
});

// Fetch and decrypt a secret
const decrypted = await identity.getSecret(secret.id);
console.log(decrypted.payload);

// Delete a secret
await identity.deleteSecret(secret.id);

// Revoke this identity's access (without deleting the secret)
await identity.revokeCredentialAccess(secret.id);
```

### TOTP (one-time passwords)

Add, remove, and generate TOTP codes for login secrets.

```ts
// Add TOTP to a login secret (accepts otpauth:// URI or TOTPConfig)
await identity.setTotp(secret.id, "otpauth://totp/Example:user?secret=JBSWY3DPEHPK3PXP&issuer=Example");

// Generate the current TOTP code
const code = await identity.getTotpCode(secret.id);
console.log(code.code, code.expiresIn);

// Remove TOTP from a secret
await identity.removeTotp(secret.id);
```

---

## Org-level Messages and Threads

Access messages and threads directly without going through an identity. Useful for org-wide operations.

```ts
// List messages for a mailbox (paginated automatically)
for await (const msg of inkbox.messages.list("abc@inkboxmail.com")) {
  console.log(msg.subject);
}

// Get a single message with full body. Fetching an *inbound* message with
// an API key marks it read server-side (isRead -> true); list, thread, and
// attachment routes do not. Use markRead for list-only workflows.
const detail = await inkbox.messages.get("abc@inkboxmail.com", "message-uuid");
console.log(detail.bodyText);

// Send a message from a mailbox
await inkbox.messages.send("abc@inkboxmail.com", {
  to: ["user@example.com"],
  subject: "Hello",
  bodyText: "Hi there!",
});

// Update message flags
await inkbox.messages.updateFlags("abc@inkboxmail.com", "message-uuid", { isRead: true });
await inkbox.messages.markRead("abc@inkboxmail.com", "message-uuid");
await inkbox.messages.markUnread("abc@inkboxmail.com", "message-uuid");
await inkbox.messages.star("abc@inkboxmail.com", "message-uuid");
await inkbox.messages.unstar("abc@inkboxmail.com", "message-uuid");

// Delete a message
await inkbox.messages.delete("abc@inkboxmail.com", "message-uuid");

// Get a temporary signed URL for an attachment
const attachment = await inkbox.messages.getAttachment("abc@inkboxmail.com", "message-uuid", "report.pdf");
console.log(attachment.url);

// List threads (paginated automatically)
for await (const thread of inkbox.threads.list("abc@inkboxmail.com")) {
  console.log(thread.subject, thread.messageCount);
}

// Get a thread with all messages
const thread = await inkbox.threads.get("abc@inkboxmail.com", "thread-uuid");

// Delete a thread
await inkbox.threads.delete("abc@inkboxmail.com", "thread-uuid");
```

---

## Org-level Calls

Calls are identity-scoped. Access them via `inkbox.calls`; transcripts
are folded onto the same resource as `inkbox.calls.transcripts(callId)`.

```ts
// List calls (agent-scoped keys resolve their own identity; admin/JWT
// keys must pass agentIdentityId).
const calls = await inkbox.calls.list({ limit: 10 });
for (const call of calls) {
  console.log(call.id, call.direction, call.status, call.origin);
}

// List calls for a specific identity (admin/JWT)
const scoped = await inkbox.calls.list({ agentIdentityId: "identity-uuid", limit: 10 });

// Get a single call
const call = await inkbox.calls.get("call-uuid");

// Place an outbound call from a dedicated number
const placed = await inkbox.calls.place({
  fromNumber: "+18335794607",
  toNumber: "+15551234567",
  clientWebsocketUrl: "wss://example.com/ws",
});

// Place an outbound call over the shared iMessage-number pool
import { CallOrigin } from "@inkbox/sdk";
const shared = await inkbox.calls.place({
  toNumber: "+15551234567",
  origination: CallOrigin.SHARED_IMESSAGE_NUMBER,
  agentIdentityId: "identity-uuid",
});

// List transcript segments for a call
const segments = await inkbox.calls.transcripts("call-uuid");
for (const t of segments) {
  console.log(`[${t.party}] ${t.text}`);
}
```

### Incoming-call routing

```ts
import { IncomingCallAction } from "@inkbox/sdk";

// Read the current incoming-call config
const config = await inkbox.incomingCallAction.get();

// Route incoming calls to a webhook
await inkbox.incomingCallAction.set({
  incomingCallAction: IncomingCallAction.WEBHOOK,
  incomingCallWebhookUrl: "https://your-agent.example.com/incoming-call",
});
```

---

## Org-level Mailboxes

Mailboxes are provisioned atomically by `inkbox.createIdentity(...)` and
removed by `identity.delete()` (cascade). The `inkbox.mailboxes`
surface is read + update + search only.

```ts
// List all mailboxes in the organisation
const mailboxes = await inkbox.mailboxes.list();

// Get a specific mailbox
const mb = await inkbox.mailboxes.get("abc-xyz@inkboxmail.com");
console.log(mb.emailAddress);
console.log(mb.sendingDomain);  // bare domain the mailbox sends from
console.log(mb.agentIdentityId); // non-null for live customer mailboxes (1:1 invariant)
console.log(mb.storageUsedBytes);  // bytes currently stored
console.log(mb.storageLimitBytes); // plan cap in bytes (binary GiB), or null

// Filter mode now lives on the agent identity — set it via
// identity.update({ mailFilterMode: ... }). display_name likewise moved
// to the identity; the mailbox PATCH endpoint hard-rejects display_name
// with a 422. To attach a webhook receiver, see "Webhooks" below.
const supportAgent = await inkbox.getIdentity("support-agent");
await supportAgent.update({ mailFilterMode: "whitelist" }); // admin-scoped key only
// (deprecated) await inkbox.mailboxes.update(mb.emailAddress, { filterMode: "whitelist" });

// Full-text search across messages in a mailbox
const results = await inkbox.mailboxes.search(mb.emailAddress, { q: "invoice", limit: 20 });
for (const msg of results) {
  console.log(msg.subject, msg.fromAddress);
}

// To remove a mailbox, delete its owning identity (cascades to the
// linked mailbox AND tunnel; revokes scoped API keys):
await (await inkbox.getIdentity("support-agent")).delete();
```

---

## Custom Sending Domains

If your org has registered custom sending domains in the console, list them and (admin-only) set the org default. New mailboxes inherit the org default unless you pass `sendingDomain` to `createIdentity`. Domain registration, DNS records, verification, DKIM rotation, and deletion stay in the console.

```ts
import { SendingDomainStatus } from "@inkbox/sdk";

// List custom sending domains for the org (optionally filter by status)
const verified = await inkbox.domains.list({ status: SendingDomainStatus.VERIFIED });
for (const d of verified) {
  console.log(d.id, d.domain, d.status, d.isDefault);
}

// Set the org default — admin-scoped API key only.
// Returns the bare new default domain name (or null when reverted to platform).
const newDefault = await inkbox.domains.setDefault("mail.acme.com");

// Pass the platform domain (e.g. "inkboxmail.com" in prod) to revert.
await inkbox.domains.setDefault("inkboxmail.com");  // -> null
```

---

## Mail clients (IMAP/SMTP)

An Inkbox inbox can also be attached to a regular mail client (Thunderbird,
Apple Mail, mutt, …) with the API key you already have. There is no separate
credential to create and no SDK call involved — the gateway speaks IMAP and
SMTP directly.

| Setting | Value |
|---|---|
| IMAP host | `imap.inkboxmail.com` |
| IMAP port | `993` (IMAPS / implicit TLS) |
| SMTP host | `smtp.inkboxmail.com` |
| SMTP port | `465` (SMTPS / implicit TLS) or `587` (STARTTLS) |
| Username | the inbox address (e.g. `sales-bot@inkboxmail.com`) |
| Password | an **identity-scoped** API key (`ApiKey_...`) |

The password is an agent-scoped API key — the same key an identity-scoped
`Inkbox(...)` client authenticates with. Mint one with
`inkbox.apiKeys.create({ label, scopedIdentityId })`. Admin-scoped keys are
rejected: one key maps to exactly one mailbox. Revoking the key revokes
mail-client access.

Two constraints that bite in practice:

- **`From` must be the authenticated inbox address**, and exactly one address.
  Aliases and "send as" identities are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over
  SMTP.** The required footer can't be injected without breaking the signature,
  so the send is refused. Send unsigned, or upgrade the plan.

If your client saves its own copy of sent messages, leave that setting on:
Inkbox recognizes the copy as the message it already stored, so you get one
Sent entry, charged against your storage cap once.

Full setup walkthrough:
<https://inkbox.ai/docs/capabilities/email/mail-clients>

---

## Org-level Phone Numbers

Read, search, and release phone numbers org-wide via `inkbox.phoneNumbers`. Provisioning still goes through an identity — pass `agentHandle` so the new number is bound to it from the start.

```ts
// List all phone numbers in the organisation
const numbers = await inkbox.phoneNumbers.list();

// Get a specific phone number by ID
const number = await inkbox.phoneNumbers.get("phone-number-uuid");

// Provision a new number
const num   = await inkbox.phoneNumbers.provision({ agentHandle: "sales-bot" }); // local by default
const inNy  = await inkbox.phoneNumbers.provision({ agentHandle: "sales-bot", state: "NY" });

// Update incoming call behaviour
await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "webhook",
  incomingCallWebhookUrl: "https://example.com/calls",
});
await inkbox.phoneNumbers.update(num.id, {
  incomingCallAction: "auto_accept",
  clientWebsocketUrl: "wss://example.com/ws",
});

// Full-text search across transcripts
const hits = await inkbox.phoneNumbers.searchTranscripts(num.id, { q: "refund", party: "remote" });
for (const t of hits) {
  console.log(`[${t.party}] ${t.text}`);
}

// Release a number
await inkbox.phoneNumbers.release(num.id);
```

---

## Webhooks

Webhook delivery uses a dedicated subscription resource. Each
subscription names exactly one owner (a mailbox, a phone number, **or**
an agent identity for iMessage), one HTTPS destination URL, and a
non-empty subset of the catalog's event types. Multiple subscriptions
on the same owner fan out independently.

The one exception is `phone.incoming_call`, which is a synchronous
control-plane callback (the response body decides whether Inkbox
answers). That URL still lives on the phone-number resource as
`incomingCallWebhookUrl`.

### Subscribing to mail, text, or iMessage events

```ts
// Mail subscription: pick the message.* events you want.
await inkbox.webhooks.subscriptions.create({
  mailboxId: mb.id,
  url: "https://example.com/hook",
  eventTypes: ["message.received", "message.bounced"],
});

// Text subscription: pick the text.* events you want.
await inkbox.webhooks.subscriptions.create({
  phoneNumberId: number.id,
  url: "https://example.com/texts",
  eventTypes: [
    "text.received",
    "text.sent",
    "text.delivered",
    "text.delivery_failed",
    "text.delivery_unconfirmed",
  ],
});

// iMessage subscription: owned by the agent identity (the shared
// pool lines aren't org resources).
await inkbox.webhooks.subscriptions.create({
  agentIdentityId: identity.id,
  url: "https://example.com/imessage",
  eventTypes: [
    "imessage.received",
    "imessage.reaction_received",
    "imessage.sent",
    "imessage.delivered",
    "imessage.delivery_failed",
  ],
});

// List, update, remove.
const subs = await inkbox.webhooks.subscriptions.list({ mailboxId: mb.id });
await inkbox.webhooks.subscriptions.update(subs[0].id, { url: "https://new/hook" });
await inkbox.webhooks.subscriptions.delete(subs[0].id);
```

Available event types:

| Channel | `event_type` values |
|---|---|
| Mail | `message.received`, `message.sent`, `message.forwarded`, `message.delivered`, `message.bounced`, `message.failed` |
| Phone text | `text.received`, `text.sent`, `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed` |
| iMessage | `imessage.received`, `imessage.reaction_received`, `imessage.sent`, `imessage.delivered`, `imessage.delivery_failed` |

Server-side validation: exactly one of `mailboxId` / `phoneNumberId` /
`agentIdentityId` must be set; `eventTypes` must be non-empty and
distinct; every event type must belong to the owner's channel (mailbox
→ `message.*`, phone number → `text.*`, agent identity → `imessage.*`).
On `create` the SDK mirrors the structural checks (XOR owner,
non-empty, distinct, no `phone.incoming_call`) plus the `message.` /
`text.` / `imessage.` prefix check, so most shape mistakes surface as
`Error` before the request leaves the client. The server remains
authoritative for the exact event-name enum, so a typo with a valid
prefix (e.g. `message.received_typo`) passes the SDK's check and is
rejected as 422 by the server. On `update` the SDK mirrors the
non-empty / distinct / no-`phone.incoming_call` checks; channel
coherence is deferred to the server because the SDK doesn't know the
owner FK from a sub_id alone.

### Conversation context

Opt a subscription into per-class conversation history on **received**
events (`message.received`, `text.received`, `imessage.received`) by
passing `contextConfig`. Each class (`email`, `texts`, `calls`) takes a
`count` mode (last N items, 1..50) or a `window` mode (last H hours,
1..168); omit a class to leave it unconfigured.

```ts
await inkbox.webhooks.subscriptions.create({
  mailboxId: mb.id,
  url: "https://example.com/hook",
  eventTypes: ["message.received"],
  contextConfig: {
    email: { mode: "count", count: 10 },
    texts: { mode: "window", hours: 24 },
  },
});

// update() is tri-state: omit contextConfig to leave it unchanged, pass an
// object to replace it, or pass null to clear it.
await inkbox.webhooks.subscriptions.update(sub.id, { contextConfig: null });
```

Received-event payloads then carry an optional `payload.data.context` keyed
by class. Optional fields are **omitted when empty** (never `null`) —
guard with `?.`, not `=== null`. A
skipped class ships `items: []` plus a `skipped` reason; call transcript
entries are either turns or an abridgment marker, discriminated on
`"marker" in entry`:

```ts
import type { WebhookContextCallItem, WebhookContextMailItem } from "@inkbox/sdk";

// payload is a MailWebhookPayload / TextWebhookPayload / ... (see below)
const context = payload.data.context;
if (context?.email) {
  if (context.email.skipped) {
    console.log("no email context:", context.email.skipped);
  }
  // Each class's items are that class's item type.
  for (const item of context.email.items as WebhookContextMailItem[]) {
    console.log(item.direction, item.subject);
  }
}
for (const call of (context?.calls?.items ?? []) as WebhookContextCallItem[]) {
  for (const entry of call.transcript) {
    if ("marker" in entry) {
      console.log(`… ${entry.omitted_turns} turns abridged`);
    } else {
      console.log(`${entry.party}: ${entry.text}`);
    }
  }
}
```

The config types (`WebhookContextConfig`, `WebhookContextClassConfig`) and
the payload types (`WebhookContext`, `WebhookContextBlock`,
`WebhookTranscriptEntry`, …) are exported from `@inkbox/sdk`.

### Incoming-call webhooks (still per-number)

```ts
// Route incoming calls to a webhook. The response body controls call routing.
await inkbox.phoneNumbers.update(number.id, {
  incomingCallAction: "webhook",
  incomingCallWebhookUrl: "https://example.com/calls",
});
```

### Wire shapes

Every mail and text payload uses the standard `{ event_type,
timestamp, data }` envelope. `data.contacts` (mail and text) and
`data.agent_identities` are always present, possibly empty.
`agent_identities` mirrors `contacts` but matches active agent
identities in the same org. On mail, each list entry carries a
`bucket: "from" | "to" | "cc" | "bcc"` plus `address`; receivers
should pair to the source field by `(bucket, address)`.
`data.message.bcc_addresses` is populated only on outbound events.
Every resolved contact carries active memory text, newest first, in
`memories`; use `match.memories ?? []` for replayed payloads that
predate contact memories. This is separate from the optional
conversation `context`.

Phone-text payloads carry several fields for group sends:

- `text_message.recipients` — `null` on inbound, a one-element list
  on outbound 1:1, multiple entries on group outbound.
- `text_message.remote_phone_number` — `null` on group outbound (the
  per-recipient state is in `recipients[]`).
- `data.recipient_phone_number` — set on outbound group lifecycle
  events, names the recipient the event is about. `null` on inbound
  and on 1:1 outbound (where `remote_phone_number` already identifies
  the recipient).

The inbound-call payload is **flat** — no envelope — and carries
`contacts: WebhookContact[]` and `agent_identities:
WebhookAgentIdentity[]` at the top level.

### Receiving webhooks (typed)

The SDK exports wire-shape types for every payload. Pair `verifyWebhook` with `JSON.parse(body) as MailWebhookPayload | TextWebhookPayload | PhoneIncomingCallWebhookPayload` and discriminate on `event_type` (or, for inbound calls, on the absence of an envelope):

```ts
import {
  MailWebhookPayload,
  TextWebhookPayload,
  PhoneIncomingCallWebhookPayload,
  verifyWebhook,
} from "@inkbox/sdk";

app.post("/hooks/mail", express.raw({ type: "*/*" }), (req, res) => {
  if (!verifyWebhook({ payload: req.body, headers: req.headers, secret: "whsec_..." })) {
    return res.status(403).end();
  }
  const payload = JSON.parse(req.body.toString()) as MailWebhookPayload;
  for (const match of payload.data.contacts) {
    console.log(`${match.bucket} ${match.address} -> ${match.name} (${match.id})`);
  }
  res.status(204).end();
});

app.post("/hooks/text", express.raw({ type: "*/*" }), (req, res) => {
  if (!verifyWebhook({ payload: req.body, headers: req.headers, secret: "whsec_..." })) {
    return res.status(403).end();
  }
  const payload = JSON.parse(req.body.toString()) as TextWebhookPayload;
  switch (payload.event_type) {
    case "text.delivery_failed": {
      const m = payload.data.text_message;
      const recipient = payload.data.recipient_phone_number ?? m.remote_phone_number;
      console.error(`SMS to ${recipient} failed`, m.error_code, m.error_detail);
      break;
    }
    case "text.delivered":
      // delivery_status, sent_at, delivered_at are all populated.
      break;
    case "text.received":
      for (const c of payload.data.contacts) {
        console.log("inbound from known contact", c.id);
      }
      for (const a of payload.data.agent_identities) {
        console.log("inbound from agent identity", a.agent_handle);
      }
      break;
  }
  res.status(204).end();
});
```

Wire shapes are intentionally **snake_case** (the raw JSON body, not the SDK's parsed camelCase types) so `JSON.parse(body) as MailWebhookPayload` round-trips without a transformer. Enum-valued fields like `direction`, `status`, and `delivery_status` are string-literal unions (e.g. `"inbound" | "outbound"`) rather than the SDK's TS `enum`s — `JSON.parse` produces bare strings, and literal unions narrow cleanly.

On inbound `message.received`, `data.message` carries the plain-text `body`: the whole message under the size cap, else a prefix with `body_truncated: true` and `body_state: "truncated"` (otherwise `"complete"`). When truncated, fetch the full message by id — `messages.get(message.email_address, message.id)` (note: use `message.id`, the row id, **not** `message.message_id`, the RFC 5322 header). These fields are optional: present-with-`null` on non-received events and absent on payloads predating the feature.

---

## Whoami

```ts
// Check the authenticated caller's identity
const info = await inkbox.whoami();
console.log(info.authType);        // "api_key" or "jwt"
console.log(info.organizationId);

// Narrow by auth type (discriminated union)
if (info.authType === "api_key") {
  console.log(info.keyId, info.label);
} else {
  console.log(info.email, info.orgRole);
}
```

---

## Signing Keys

Signing keys are **per agent identity**. Create/rotate or check status via the
identity (or `inkbox.signingKeys.createOrRotate(agentHandle)` /
`getStatus(agentHandle)`). The plaintext is returned **once**.

```ts
const identity = await inkbox.getIdentity("support-agent");

// Create or rotate this identity's webhook signing key (plaintext returned once)
const key = await identity.createSigningKey();
console.log(key.signingKey); // save this immediately

// Check whether a key is configured
const status = await identity.getSigningKeyStatus();
console.log(status.configured, status.createdAt);

// The FIRST webhook subscription for a keyless identity returns its secret once:
const created = await inkbox.webhooks.subscriptions.create({
  mailboxId: identity.mailbox!.id,
  url: "https://example.com/hooks/mail",
  eventTypes: ["message.received"],
});
if (created.signingKey != null) {
  console.log(created.signingKey); // save this immediately — shown only once
}

// (deprecated) org-level: await inkbox.createSigningKey();
```

---

## Verifying Webhook Signatures

Use `verifyWebhook` to confirm that an incoming request was sent by Inkbox.

```typescript
import { verifyWebhook } from "@inkbox/sdk";

// Express — use express.raw() to get the raw body Buffer
app.post("/hooks/mail", express.raw({ type: "*/*" }), (req, res) => {
  const valid = verifyWebhook({
    payload: req.body,
    headers: req.headers,
    secret: "whsec_...",
  });
  if (!valid) return res.status(403).end();
  // handle event ...
});
```

---

## Examples

Runnable example scripts are available in the [examples/typescript](https://github.com/vectorlyapp/inkbox/tree/main/inkbox/examples/typescript) directory:

| Script | What it demonstrates |
|---|---|
| `register-agent-identity.ts` | Create an identity, assign mailbox + phone number |
| `agent-send-email.ts` | Send an email and a threaded reply |
| `read-agent-messages.ts` | List messages and threads |
| `create-agent-mailbox.ts` | Create, update, search, and delete a mailbox |
| `create-agent-phone-number.ts` | Provision, update, and release a number |
| `list-agent-phone-numbers.ts` | List all phone numbers in the org |
| `read-agent-calls.ts` | List calls and print transcripts |
| `receive-agent-email-webhook.ts` | Register and delete a mailbox webhook |
| `receive-agent-call-webhook.ts` | Register, update, and delete a phone webhook |

## License

MIT

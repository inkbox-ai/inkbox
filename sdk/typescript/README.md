# @inkbox/sdk

TypeScript SDK for the [Inkbox API](https://inkbox.ai/docs) — API-first communication infrastructure for AI agents (email, phone, identities, encrypted vault — login credentials, API keys, key pairs, SSH keys, OTP, etc.).

## Install

```bash
npm install @inkbox/sdk
```

Requires Node.js ≥ 18.

## Authentication

You'll need an API key to use this SDK. Get one at [inkbox.ai/console](https://inkbox.ai/console).

## Quick start

```ts
import { Inkbox } from "@inkbox/sdk";

const inkbox = await new Inkbox({
  apiKey: process.env.INKBOX_API_KEY!,
  vaultKey: process.env.INKBOX_VAULT_KEY,
}).ready();

// Create an agent identity with a linked mailbox
const identity = await inkbox.createIdentity("support-bot", { displayName: "Support Bot" });
const phone = await identity.provisionPhoneNumber({ type: "toll_free" });

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
const identity = await inkbox.createIdentity("sales-bot", { displayName: "Sales Bot" });
const phone    = await identity.provisionPhoneNumber({ type: "toll_free" });      // provisions + links

console.log(identity.emailAddress);
console.log(phone.number);

// Link an existing mailbox or phone number instead of creating new ones
await identity.assignMailbox("mailbox-uuid-here");
await identity.assignPhoneNumber("phone-number-uuid-here");

// Get an existing identity (returned with current channel state)
const identity2 = await inkbox.getIdentity("sales-bot");
await identity2.refresh();  // re-fetch channels from API

// List all identities for your org
const allIdentities = await inkbox.listIdentities();

// Update status or handle
await identity.update({ status: "paused" });
await identity.update({ newHandle: "sales-bot-v2" });

// Unlink channels (without deleting them)
await identity.unlinkMailbox();
await identity.unlinkPhoneNumber();

// Delete
await identity.delete();
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

// Mark messages as read
const unread: string[] = [];
for await (const msg of identity.iterUnreadEmails()) unread.push(msg.id);
await identity.markEmailsRead(unread);

// Get all emails in a thread (threadId comes from msg.threadId)
const thread = await identity.getThread(msg.threadId!);
for (const m of thread.messages) {
  console.log(m.subject, m.fromAddress);
}
```

---

## Phone

```ts
// Place an outbound call — stream audio over WebSocket
const call = await identity.placeCall({
  toNumber: "+15167251294",
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

```ts
// Send an SMS. Returns a queued TextMessage; final delivery state arrives
// via the incomingTextWebhookUrl configured on the sender.
const sent = await identity.sendText({
  to: "+15167251294",
  text: "Hello from Inkbox",
});
console.log(sent.id, sent.deliveryStatus);   // "queued"

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

// List conversation summaries (one row per remote number)
const convos = await identity.listTextConversations({ limit: 20 });
for (const c of convos) {
  console.log(c.remotePhoneNumber, c.latestText, c.unreadCount);
}

// Get messages in a specific conversation
const msgs = await identity.getTextConversation("+15167251294", { limit: 50 });

// Mark as read
await identity.markTextRead("text-uuid");
await identity.markTextConversationRead("+15167251294");

// Org-level: search and delete
const results = await inkbox.texts.search(phone.id, { q: "invoice", limit: 20 });
await inkbox.texts.update(phone.id, "text-uuid", { status: "deleted" });
```

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

// Get a single message with full body
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

## Org-level Calls and Transcripts

Access calls and transcripts directly. Access via `inkbox.calls` and `inkbox.transcripts`.

```ts
// List calls for a phone number
const calls = await inkbox.calls.list("phone-number-uuid", { limit: 10 });
for (const call of calls) {
  console.log(call.id, call.direction, call.status);
}

// Get a single call
const call = await inkbox.calls.get("phone-number-uuid", "call-uuid");

// Place an outbound call
const placed = await inkbox.calls.place({
  fromNumber: "phone-number-uuid",
  toNumber: "+15167251294",
  clientWebsocketUrl: "wss://example.com/ws",
});

// List transcript segments for a call
const segments = await inkbox.transcripts.list("phone-number-uuid", "call-uuid");
for (const t of segments) {
  console.log(`[${t.party}] ${t.text}`);
}
```

---

## Org-level Mailboxes

Manage mailboxes directly without going through an identity. Access via `inkbox.mailboxes`.

```ts
// List all mailboxes in the organisation
const mailboxes = await inkbox.mailboxes.list();

// Get a specific mailbox
const mailbox = await inkbox.mailboxes.get("abc-xyz@inkboxmail.com");

// Create a mailbox linked to an agent identity
const mb = await inkbox.mailboxes.create({
  agentHandle: "support-agent",
  displayName: "Support Inbox",
});
console.log(mb.emailAddress);

// Update display name or webhook URL
await inkbox.mailboxes.update(mb.emailAddress, { displayName: "New Name" });
await inkbox.mailboxes.update(mb.emailAddress, { webhookUrl: "https://example.com/hook" });
await inkbox.mailboxes.update(mb.emailAddress, { webhookUrl: null }); // remove webhook

// Full-text search across messages in a mailbox
const results = await inkbox.mailboxes.search(mb.emailAddress, { q: "invoice", limit: 20 });
for (const msg of results) {
  console.log(msg.subject, msg.fromAddress);
}

// Delete a mailbox
await inkbox.mailboxes.delete(mb.emailAddress);
```

---

## Org-level Phone Numbers

Manage phone numbers directly without going through an identity. Access via `inkbox.phoneNumbers`.

```ts
// List all phone numbers in the organisation
const numbers = await inkbox.phoneNumbers.list();

// Get a specific phone number by ID
const number = await inkbox.phoneNumbers.get("phone-number-uuid");

// Provision a new number
const num   = await inkbox.phoneNumbers.provision({ type: "toll_free" });
const local = await inkbox.phoneNumbers.provision({ type: "local", state: "NY" });

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

Webhooks are configured on the mailbox or phone number resource — no separate registration step.

### Mailbox webhooks

Set a URL on a mailbox to receive `message.received` and `message.sent` events.

```ts
// Set webhook
await inkbox.mailboxes.update("abc@inkboxmail.com", { webhookUrl: "https://example.com/hook" });

// Remove webhook
await inkbox.mailboxes.update("abc@inkboxmail.com", { webhookUrl: null });
```

### Phone webhooks

Set an incoming call webhook URL and action on a phone number.

```ts
// Route incoming calls to a webhook
await inkbox.phoneNumbers.update(number.id, {
  incomingCallAction: "webhook",
  incomingCallWebhookUrl: "https://example.com/calls",
});
```

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

```ts
// Create or rotate the org-level webhook signing key (plaintext returned once)
const key = await inkbox.createSigningKey();
console.log(key.signingKey); // save this immediately
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

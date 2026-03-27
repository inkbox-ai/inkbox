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
await inkbox.phoneNumbers.release({ number: num.number });
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

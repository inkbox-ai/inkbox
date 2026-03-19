---
name: inkbox-ts
description: Use when writing TypeScript or JavaScript code that imports from `@inkbox/sdk`, uses `npm install @inkbox/sdk`, or when adding email, phone, authenticator app, or agent identity features using the Inkbox TypeScript SDK.
user-invocable: false
---

# Inkbox TypeScript SDK

API-first communication infrastructure for AI agents — email, phone, authenticator apps, and identities.

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
├── .authenticatorApps      → AuthenticatorAppsResource
└── .createSigningKey()     → Promise<SigningKey>

AgentIdentity (identity-scoped helper)
├── .mailbox                → IdentityMailbox | null
├── .phoneNumber            → IdentityPhoneNumber | null
├── .authenticatorApp       → IdentityAuthenticatorApp | null
├── mail methods            (requires assigned mailbox)
├── phone methods           (requires assigned phone number)
└── authenticator methods   (requires assigned authenticator app)
```

An identity must have a channel assigned before you can use mail/phone/authenticator methods. If not assigned, an `InkboxAPIError` is thrown.

## Identities

```typescript
const identity = await inkbox.createIdentity("sales-agent");
const identity = await inkbox.getIdentity("sales-agent");
const identities = await inkbox.listIdentities();   // AgentIdentitySummary[]

await identity.update({ newHandle: "new-name" });   // rename
await identity.update({ status: "paused" });         // or "active"
await identity.refresh();                            // re-fetch from API, updates cached channels
await identity.delete();                             // soft-delete; unlinks channels
```

## Channel Management

```typescript
// Create and auto-link new channels
const mailbox  = await identity.createMailbox({ displayName: "Sales Agent" });
const phone    = await identity.provisionPhoneNumber({ type: "toll_free" });   // or type: "local", state: "NY"
const auth_app = await identity.createAuthenticatorApp();

console.log(mailbox.emailAddress);   // e.g. "abc-xyz@inkboxmail.com"
console.log(phone.number);           // e.g. "+18005551234"

// Link existing channels
await identity.assignMailbox("mailbox-uuid");
await identity.assignPhoneNumber("phone-number-uuid");
await identity.assignAuthenticatorApp("authenticator-app-uuid");

// Unlink without deleting
await identity.unlinkMailbox();
await identity.unlinkPhoneNumber();
await identity.unlinkAuthenticatorApp();
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

## Authenticator

```typescript
// Create an authenticator app and link it to an identity
const auth_app = await identity.createAuthenticatorApp();

// Add an OTP account from an otpauth:// URI
const account = await identity.createAuthenticatorAccount({
  otpauthUri: "otpauth://totp/Example:user@example.com?secret=EXAMPLESECRET&issuer=Example",
  displayName: "My OTP Account",        // optional (max 255 chars)
  description: "Login MFA for Example",  // optional
});

// List all accounts in this identity's authenticator app
const accounts = await identity.listAuthenticatorAccounts();

// Get a single account
const account = await identity.getAuthenticatorAccount("account-uuid");

// Update account metadata (pass null to clear a field)
await identity.updateAuthenticatorAccount("account-uuid", { displayName: "New Label" });

// Generate an OTP code
const otp = await identity.generateOtp("account-uuid");
console.log(otp.otpCode);            // e.g. "482901"
console.log(otp.validForSeconds);    // seconds until expiry (null for HOTP)
console.log(otp.otpType);            // "totp" or "hotp"

// Delete an account
await identity.deleteAuthenticatorAccount("account-uuid");
```

## Org-level Resources

### Mailboxes (`inkbox.mailboxes`)

```typescript
const mailboxes = await inkbox.mailboxes.list();
const mailbox   = await inkbox.mailboxes.get("abc@inkboxmail.com");
const mb        = await inkbox.mailboxes.create({ agentHandle: "support", displayName: "Support Inbox" });

await inkbox.mailboxes.update(mb.emailAddress, { displayName: "New Name" });
await inkbox.mailboxes.update(mb.emailAddress, { webhookUrl: "https://example.com/hook" });
await inkbox.mailboxes.update(mb.emailAddress, { webhookUrl: null });   // remove webhook

const results = await inkbox.mailboxes.search(mb.emailAddress, { q: "invoice", limit: 20 });
await inkbox.mailboxes.delete(mb.emailAddress);
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

### Authenticator Apps (`inkbox.authenticatorApps`)

```typescript
const apps = await inkbox.authenticatorApps.list();
const app  = await inkbox.authenticatorApps.get("app-uuid");
const app  = await inkbox.authenticatorApps.create({ agentHandle: "support" });   // linked to identity
const app  = await inkbox.authenticatorApps.create();                              // unbound
await inkbox.authenticatorApps.delete("app-uuid");                                 // soft-deletes app + all accounts
```

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

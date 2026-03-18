---
name: inkbox
description: Send and receive emails and phone calls via Inkbox agent identities. Use when the user wants to check inbox messages, list unread email, view a thread, search mailbox contents, draft/send an email, place an outbound phone call, list call history, or retrieve call transcripts through an Inkbox agent identity.
metadata:
  openclaw:
    emoji: "📬"
    homepage: "https://www.inkbox.ai"
    requires:
      env:
        - INKBOX_API_KEY
      bins:
        - node
    primaryEnv: INKBOX_API_KEY
---

# Inkbox Skill

Use this skill when the user wants to send an email, read their inbox, view an email thread, search through emails, place a phone call, list call history, or read call transcripts. All operations go through an Inkbox agent identity.

## Requirements

- `INKBOX_API_KEY` — your Inkbox API key (from console.inkbox.ai)
- `INKBOX_AGENT_HANDLE` — the handle of the agent identity to use (optional — if not set, create one first; see below)
- `node` must be installed (Node.js ≥ 18)
- `@inkbox/sdk` must be installed — run `npm install @inkbox/sdk` in the skill directory if not already present

## Getting started: create an agent identity

If `INKBOX_AGENT_HANDLE` is not set, you need to create an Inkbox agent identity first. Ask the user what handle they'd like (e.g. `my-agent`), then run:

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.createIdentity("my-agent");  // replace with chosen handle
await identity.createMailbox({ displayName: "My Agent" }); // provision email; adjust display name as needed
console.log(JSON.stringify({
  handle: identity.handle,
  emailAddress: identity.mailbox?.emailAddress,
}, null, 2));
```

Once created, save the handle as `INKBOX_AGENT_HANDLE` in the skill's env config so it's used automatically in future sessions.

## How to invoke

Use `npx tsx --eval` to run SDK code inline. All operations follow this initialization pattern:

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
```

## Operations

### Send an email

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const message = await identity.sendEmail({
  to: ["recipient@example.com"],           // required — array of addresses
  subject: "Hello",                         // required
  bodyText: "Hi there",                     // required — plain text body
  // cc: ["cc@example.com"],               // optional
  // bcc: ["bcc@example.com"],             // optional
  // inReplyToMessageId: "<messageId>",    // optional — threads the reply
});
console.log(JSON.stringify(message, null, 2));
```

### List inbox emails

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const messages = [];
const iter = identity.iterEmails();         // or iterUnreadEmails() for unread only
for await (const msg of iter) {
  messages.push(msg);
  if (messages.length >= 10) break;         // adjust limit as needed
}
console.log(JSON.stringify(messages, null, 2));
```

### Get a full email thread

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const thread = await identity.getThread("<threadId>");  // threadId from list output
console.log(JSON.stringify(thread, null, 2));
```

### Search emails

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const results = await inkbox.mailboxes.search(identity.mailbox!.emailAddress, {
  q: "invoice",   // search query
  limit: 10,      // max results
});
console.log(JSON.stringify(results, null, 2));
```

### Place a phone call

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const call = await identity.placeCall({
  toNumber: "+15551234567",                       // required — E.164 format
  // clientWebsocketUrl: "wss://...",             // optional — real-time audio bridge
});
console.log(JSON.stringify(call, null, 2));
```

### List call history

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const calls = await identity.listCalls({ limit: 10, offset: 0 });
console.log(JSON.stringify(calls, null, 2));
```

### Get a call transcript

```ts
import { Inkbox } from "@inkbox/sdk";
const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE!);
const transcript = await identity.listTranscripts("<callId>");  // callId from list output
console.log(JSON.stringify(transcript, null, 2));
```

## Notes

- Always confirm with the user before sending an email or placing a call.
- Use `iterUnreadEmails()` to check for new messages.
- Thread IDs are in the `threadId` field of any message object.
- Message IDs from `iterEmails` can be passed to `inReplyToMessageId` when replying.
- Phone numbers must be in E.164 format (e.g. `+15551234567`).
- The agent identity must have a phone number assigned to use phone operations.
- Call IDs from `listCalls` can be passed to `listTranscripts`.

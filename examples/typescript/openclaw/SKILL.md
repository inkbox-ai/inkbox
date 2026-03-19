---
name: inkbox
description: Send and receive emails and phone calls via Inkbox agent identities. Use when the user wants to check inbox messages, list unread email, view a thread, search mailbox contents, draft/send an email, place an outbound phone call, list call history, retrieve call transcripts, or create/set up an Inkbox identity.
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

Use this skill for Inkbox-backed email and phone operations, plus first-time Inkbox identity setup.

## Requirements

- `INKBOX_API_KEY` — Inkbox API key
- `node` on `PATH` (Node.js 18+)
- `INKBOX_AGENT_HANDLE` is optional; use it when already configured, otherwise ask the user which identity handle to use or create

## Runtime setup

Do not assume `@inkbox/sdk` is already installed in the skill folder.

When the SDK is missing, prefer a **temporary disposable Node directory** over modifying the workspace or skill folder. Use a flow like:

1. Create a temporary directory
2. Run `npm init -y`
3. Run `npm install @inkbox/sdk`
4. Write a small `.mjs` script there
5. Run it with `node`

Only install dependencies into the skill folder or workspace if the user explicitly asks.

Use `.mjs` scripts with standard ESM imports. Avoid relying on `tsx --eval` or top-level-await snippets that may be runtime-fragile.

## Initialization pattern

For operations against an existing identity:

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
```

If `INKBOX_AGENT_HANDLE` is not configured, ask the user for the handle to use.

## Create an Inkbox identity

Ask the user for:
- desired handle (for example `my-agent`)
- optional mailbox display name

Then run a script like:

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.createIdentity("my-agent");
await identity.createMailbox({ displayName: "My Agent" });
console.log(JSON.stringify({
  handle: identity.agentHandle,
  emailAddress: identity.mailbox?.emailAddress,
}, null, 2));
```

After success:
- show the handle and mailbox address to the user
- ask whether they want to save the handle in `skills.entries.<skill>.env.INKBOX_AGENT_HANDLE`
- do not store the API key in plaintext config; prefer `skills.entries.<skill>.apiKey` with a SecretRef to `INKBOX_API_KEY`

## Send an email

Before sending, confirm recipients, subject, and body with the user.

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const message = await identity.sendEmail({
  to: ["recipient@example.com"],
  subject: "Hello",
  bodyText: "Hi there",
  // cc: ["cc@example.com"],
  // bcc: ["bcc@example.com"],
  // inReplyToMessageId: "<messageId>",
});
console.log(JSON.stringify(message, null, 2));
```

## List inbox emails

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const messages = [];
for await (const msg of identity.iterEmails()) {
  messages.push(msg);
  if (messages.length >= 10) break;
}
console.log(JSON.stringify(messages, null, 2));
```

For unread-only checks, use `identity.iterUnreadEmails()`.

## Get a full email thread

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const thread = await identity.getThread("<threadId>");
console.log(JSON.stringify(thread, null, 2));
```

## Search emails

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
if (!identity.mailbox?.emailAddress) {
  throw new Error("Identity does not have a provisioned mailbox yet");
}
const results = await inkbox.mailboxes.search(identity.mailbox.emailAddress, {
  q: "invoice",
  limit: 10,
});
console.log(JSON.stringify(results, null, 2));
```

This operation requires the identity to already have a mailbox provisioned.

## Place a phone call

Always confirm before placing a call.

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const call = await identity.placeCall({
  toNumber: "+15551234567",
  // clientWebsocketUrl: "wss://...",
});
console.log(JSON.stringify(call, null, 2));
```

## List call history

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const calls = await identity.listCalls({ limit: 10, offset: 0 });
console.log(JSON.stringify(calls, null, 2));
```

## Get a call transcript

```js
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const identity = await inkbox.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const transcript = await identity.listTranscripts("<callId>");
console.log(JSON.stringify(transcript, null, 2));
```

## Error handling

- If Inkbox returns `401 Unauthorized`, tell the user the API key was rejected and ask them to verify or rotate `INKBOX_API_KEY`
- If `INKBOX_AGENT_HANDLE` is missing, ask the user which identity to use or create one first
- If an operation needs mailbox or phone provisioning that does not yet exist, explain what is missing and stop before guessing

## Notes

- Confirm before sending emails or placing calls
- Thread IDs come from message objects (`threadId`)
- Message IDs can be used for `inReplyToMessageId`
- Phone numbers must be in E.164 format (for example `+15551234567`)
- The identity must have a phone number assigned for phone operations
- Call IDs from `listCalls` can be passed to `listTranscripts`

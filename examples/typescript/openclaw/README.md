# inkbox — OpenClaw Skill

An [OpenClaw](https://openclaw.ai) skill for email and phone via [Inkbox](https://www.inkbox.ai) agent identities.

## What it does

Once installed, your OpenClaw agent can:

- **Send emails** — compose and send from an Inkbox agent mailbox
- **Read inbox** — list recent or unread messages
- **View threads** — fetch full email conversations
- **Search email** — full-text search across a mailbox
- **Place calls** — make outbound phone calls (with optional WebSocket audio bridge)
- **List call history** — review past calls
- **Get transcripts** — retrieve call transcripts

## Requirements

- Node.js ≥ 18
- An [Inkbox](https://www.inkbox.ai) account with an API key
- An agent identity provisioned in Inkbox (with a mailbox and/or phone number as needed)

## Setup

### 1. Get an Inkbox API key

Sign in at [console.inkbox.ai](https://console.inkbox.ai) and create an API key.

### 2. Create an agent identity (if you haven't already)

You can create an identity in the [Inkbox console](https://console.inkbox.ai), or programmatically:

```ts
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });
const identity = await inkbox.createIdentity("my-agent");
await identity.createMailbox({ displayName: "My Agent" });

console.log(identity.mailbox?.emailAddress); // e.g. abc-xyz@inkboxmail.com
```

### 3. Install the skill

```bash
cd inkbox/examples/typescript/openclaw
npm install
cp -r . ~/.openclaw/skills/inkbox
```

### 4. Configure env vars in OpenClaw

Add both vars to `~/.openclaw/openclaw.json` under `skills.entries.inkbox.env`:

```json
{
  "skills": {
    "entries": {
      "inkbox": {
        "enabled": true,
        "env": {
          "INKBOX_API_KEY": "ApiKey_...",
          "INKBOX_AGENT_HANDLE": "my-agent"
        }
      }
    }
  }
}
```

Then restart the gateway:

```bash
openclaw gateway restart
```

## Usage

Once installed, just talk to your OpenClaw agent naturally:

> "Check my inbox"
> "Send an email to alice@example.com with subject 'Hello' and say hi"
> "Search my email for invoices"
> "Show me the full thread for that last message"
> "Call +15551234567"
> "Show me my recent calls"
> "Get the transcript for that last call"

## Testing

You can test operations directly using `npx tsx --eval`:

```bash
export INKBOX_API_KEY=ApiKey_...
export INKBOX_AGENT_HANDLE=my-agent

# List last 10 emails
npx tsx --eval "
import { Inkbox } from '@inkbox/sdk';
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const id = await ib.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const msgs = [];
for await (const m of id.iterEmails()) { msgs.push(m); if (msgs.length >= 10) break; }
console.log(JSON.stringify(msgs, null, 2));
"

# List unread only
npx tsx --eval "
import { Inkbox } from '@inkbox/sdk';
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const id = await ib.getIdentity(process.env.INKBOX_AGENT_HANDLE);
const msgs = [];
for await (const m of id.iterUnreadEmails()) { msgs.push(m); if (msgs.length >= 10) break; }
console.log(JSON.stringify(msgs, null, 2));
"

# Send an email
npx tsx --eval "
import { Inkbox } from '@inkbox/sdk';
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const id = await ib.getIdentity(process.env.INKBOX_AGENT_HANDLE);
console.log(JSON.stringify(await id.sendEmail({ to: ['alice@example.com'], subject: 'Hello', bodyText: 'Hi Alice!' }), null, 2));
"

# Place a call
npx tsx --eval "
import { Inkbox } from '@inkbox/sdk';
const ib = new Inkbox({ apiKey: process.env.INKBOX_API_KEY });
const id = await ib.getIdentity(process.env.INKBOX_AGENT_HANDLE);
console.log(JSON.stringify(await id.placeCall({ toNumber: '+15551234567' }), null, 2));
"
```

## Extending

The `@inkbox/sdk` supports additional capabilities you can use inline:

- **HTML emails**: pass `bodyHtml` alongside or instead of `bodyText` in `sendEmail()`
- **Attachments**: pass `attachments: [{ filename, contentType, contentBase64 }]` to `sendEmail()`
- **Mark as read**: use `identity.markEmailsRead(messageIds)`
- **Call webhooks**: pass `webhookUrl` to `placeCall()` for call lifecycle events
- **WebSocket audio bridge**: pass `clientWebsocketUrl` to `placeCall()` for real-time audio

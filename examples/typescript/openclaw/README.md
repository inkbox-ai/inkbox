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

## Setup

### 1. Get an Inkbox API key

Sign in at [console.inkbox.ai](https://console.inkbox.ai) and create an API key.

### 2. Set the `INKBOX_API_KEY` environment variable in the environment where OpenClaw runs

```bash
export INKBOX_API_KEY=your_api_key_here
```

### 3. Install the Inkbox skill via `clawhub` (run inside your OpenClaw workspace)

```bash
npm i -g clawhub
clawhub install inkbox
```

### 4. Add this config snippet to `~/.openclaw/openclaw.json`

```json
{
  "skills": {
    "entries": {
      "inkbox": {
        "enabled": true,
        "apiKey": {
          "source": "env",
          "provider": "default",
          "id": "INKBOX_API_KEY"
        }
      }
    }
  }
}
```

### 5. Start a new OpenClaw session (and restart the gateway if needed)

> **Note:** `INKBOX_AGENT_HANDLE` is optional at install time. If not set, the agent will walk you through creating one on first use.

## Usage

Once installed, just talk to your OpenClaw agent naturally:

> "Set up my Inkbox identity"
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

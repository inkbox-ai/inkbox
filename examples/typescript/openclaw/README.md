# inkbox — OpenClaw Skill

An [OpenClaw](https://openclaw.ai) skill for email and phone via [Inkbox](https://www.inkbox.ai) agent identities.

## What it does

Once installed, your OpenClaw agent can:

- **Send emails** — compose and send from an Inkbox agent mailbox, with optional CC/BCC
- **Reply to emails** — thread replies using a message ID
- **Read inbox** — list recent messages or unread messages only
- **View threads** — fetch a full email conversation with all messages inlined
- **Search email** — full-text search across a mailbox
- **Place calls** — make outbound phone calls from an Inkbox phone number (with optional WebSocket audio bridge)
- **List call history** — review past inbound and outbound calls
- **Get transcripts** — retrieve per-segment call transcripts

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

### 3. Install the Inkbox skill via ClawHub

Recommended: run this inside your OpenClaw workspace.

If you have not installed clawhub yet:

```bash
sudo npm i -g clawhub
```

Then install the skill:

```bash
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

## Extending

The `@inkbox/sdk` supports additional capabilities you can use inline:

- **HTML emails**: pass `bodyHtml` alongside or instead of `bodyText` in `sendEmail()`
- **Attachments**: pass `attachments: [{ filename, contentType, contentBase64 }]` to `sendEmail()`
- **Mark as read**: use `identity.markEmailsRead(messageIds)`
- **Star/unstar messages**: use `inkbox._messages.star()` / `inkbox._messages.unstar()`
- **Delete messages or threads**: use `inkbox._messages.delete()` / `inkbox._threads.delete()`
- **Search call transcripts**: use `inkbox.phoneNumbers.searchTranscripts(phoneNumberId, { q })` for full-text transcript search
- **Inbound call handling**: configure `incomingCallAction` (`auto_accept`, `auto_reject`, or `webhook`) and `incomingCallWebhookUrl` via `inkbox.phoneNumbers.update()`
- **WebSocket audio bridge**: pass `clientWebsocketUrl` to `identity.placeCall()` for real-time audio

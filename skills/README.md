# Inkbox Skills

Official AI agent skills from [Inkbox](https://inkbox.ai) — a shared catalog of
hosted MCP workflows plus SDK and CLI guidance for email, messaging, voice,
contacts, notes, agent-to-agent tasks, identities, and tunnels.

## Installation

### Claude Code (plugin — recommended)

```
/plugin marketplace add inkbox-ai/inkbox
/plugin install inkbox@inkbox
/reload-plugins
```

Installs the shared skill catalog for automatic use. Self-signup is also
available as `/inkbox:inkbox-agent-self-signup`. The plugin connects the
Anthropic-profile Inkbox MCP server; sign in when prompted to authorize an
identity.

### Codex (plugin)

Codex plugins are distributed via a marketplace catalog. See the [Codex plugin docs](https://developers.openai.com/codex/plugins/build); this repo ships a `.codex-plugin/plugin.json` manifest at the root.

### Cursor (plugin)

Install **Inkbox** from Cursor's **Customize** view when the Marketplace listing
is available. For local testing, clone this repository into
`~/.cursor/plugins/local/inkbox`, reload Cursor, enable Inkbox, and select
**Connect** to complete browser authorization. The Cursor manifest loads this
same `skills/` directory and connects to the Cursor-profile MCP endpoint.

### Any Agent (individual skills)

```bash
npx skills add inkbox-ai/inkbox/skills
```

### Claude Code (Manual fallback)

```bash
# Python SDK skill
cp -r skills/inkbox-python ~/.claude/skills/

# TypeScript SDK skill
cp -r skills/inkbox-ts ~/.claude/skills/
```

## Prerequisites for SDK and CLI skills

1. **Install the SDK**:

   ```bash
   # Python
   pip install inkbox

   # TypeScript / Node
   npm install @inkbox/sdk
   ```

2. **Get an API key** from the [Inkbox Console](https://inkbox.ai/console)

Once the skills are installed, your coding agent will automatically know how to use the Inkbox SDK whenever it sees an import or is asked to add email/phone features.

## Available Skills

### MCP workflows

| Skill | Description |
|-------|-------------|
| **inkbox-mcp** | Connect and troubleshoot hosted MCP and browser OAuth |
| **inkbox-email-triage** | Read, search, summarize, and organize email |
| **inkbox-send-email** | Compose, send, reply, reply-all, and forward email |
| **inkbox-sms-responder** | Read and send consent-aware SMS/MMS |
| **inkbox-imessage-responder** | Onboard, read, send, and react on iMessage |
| **inkbox-outbound-calling** | Place, monitor, and end hosted calls when the host profile exposes call control |
| **inkbox-call-review** | Review call history, results, and transcripts |
| **inkbox-contact-management** | Search, edit, import, and export contacts |
| **inkbox-contact-rules** | Inspect rules and preflight phone destinations when available |
| **inkbox-notes-memory** | Manage persistent Inkbox notes |
| **inkbox-identity-profile** | Inspect channel status and manage identity settings |
| **inkbox-a2a** | Discover agents and exchange durable A2A tasks |

Host profiles can advertise different tool catalogs. Each workflow treats the
connected server's tool list as authoritative; the Anthropic profile, for
example, intentionally omits hosted-call control and several call-setting tools.

### SDK and CLI guidance

| Skill | Language | Description |
|-------|----------|-------------|
| **inkbox-python** | Python ≥ 3.11 | Agent signup, identities, email, phone, text, iMessage, A2A history, contacts, notes, contact rules, vault, and webhooks using the `inkbox` Python SDK |
| **inkbox-ts** | TypeScript / Node ≥ 22 | Agent signup, identities, email, phone, text, iMessage, A2A history, contacts, notes, contact rules, vault, and webhooks using the `@inkbox/sdk` TypeScript SDK |
| **inkbox-cli** | TypeScript / Node ≥ 22 | CLI reference for `inkbox` / `@inkbox/cli` commands covering signup, identities, email, phone, text, iMessage, A2A history, contacts, notes, contact rules, vault, mailboxes, numbers, webhooks, and signing keys |
| **inkbox-all** | Language-agnostic | Index of all Inkbox skills in this repository, including example skills and links for choosing the right one |
| **inkbox-agent-self-signup** | Language-agnostic | Shared reference for the agent self-signup flow — SDK examples (Python & TS) and direct API (curl) |
| **inkbox-tunnels** | Python, TypeScript, and Rust | Connect a local process to an identity's public tunnel and observe runtime liveness |

## Documentation

- [Inkbox Docs](https://inkbox.ai/docs)
- [API Reference](https://inkbox.ai/docs/api-reference)
- [Console](https://inkbox.ai/console)

## License

MIT

# Inkbox Skills

Official AI agent skills from [Inkbox](https://inkbox.ai) — load them into your coding agent to get instant knowledge of the Inkbox SDK for email, phone, and agent identities.

## Installation

### Claude Code (plugin — recommended)

```
/plugin marketplace add inkbox-ai/inkbox
/plugin install inkbox@inkbox
/reload-plugins
```

Installs all six skills at once, namespaced as `/inkbox:<skill>`.

### Codex (plugin)

Codex plugins are distributed via a marketplace catalog. See the [Codex plugin docs](https://developers.openai.com/codex/plugins/build); this repo ships a `.codex-plugin/plugin.json` manifest at the root.

### Any Agent (individual skills)

```bash
npx skills add inkbox-ai/inkbox/skills
```

### Claude Code (Manual fallback)

```bash
# Python SDK skill
cp -r skills/python ~/.claude/skills/

# TypeScript SDK skill
cp -r skills/ts ~/.claude/skills/
```

## Prerequisites

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

| Skill | Language | Description |
|-------|----------|-------------|
| **python** | Python ≥ 3.11 | Agent signup, identities, email, phone, text, contacts, notes, contact rules, vault, and webhooks using the `inkbox` Python SDK |
| **ts** | TypeScript / Node ≥ 18 | Agent signup, identities, email, phone, text, contacts, notes, contact rules, vault, and webhooks using the `@inkbox/sdk` TypeScript SDK |
| **openclaw** | TypeScript / Node ≥ 18 | OpenClaw skill — agent signup, email, phone, text, contacts, notes, contact rules, and vault for your OpenClaw agent |
| **cli** | TypeScript / Node ≥ 18 | CLI reference for `inkbox` / `@inkbox/cli` commands covering signup, identities, email, phone, text, contacts, notes, contact rules, vault, mailboxes, numbers, webhooks, and signing keys |
| **all** | Language-agnostic | Index of all Inkbox skills in this repository, including example skills and links for choosing the right one |
| **agent-self-signup** | Language-agnostic | Shared reference for the agent self-signup flow — SDK examples (Python & TS) and direct API (curl) |

## Documentation

- [Inkbox Docs](https://inkbox.ai/docs)
- [API Reference](https://inkbox.ai/docs/api-reference)
- [Console](https://inkbox.ai/console)

## License

MIT

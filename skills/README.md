# Inkbox Skills

Official AI agent skills from [Inkbox](https://inkbox.ai) — load them into your coding agent to get instant knowledge of the Inkbox SDK for email, phone, and agent identities.

## Installation

### Any Agent

```bash
npx skills add inkbox-ai/inkbox/skills
```

### Claude Code (Manual)

```bash
# Python SDK skill
cp -r skills/inkbox-python ~/.claude/skills/

# TypeScript SDK skill
cp -r skills/inkbox-ts ~/.claude/skills/
```

## Prerequisites

1. **Install the SDK**:

   ```bash
   # Python
   pip install inkbox

   # TypeScript / Node
   npm install @inkbox/sdk
   ```

2. **Get an API key** from the [Inkbox Console](https://console.inkbox.ai/)

Once the skills are installed, your coding agent will automatically know how to use the Inkbox SDK whenever it sees an import or is asked to add email/phone features.

## Available Skills

| Skill | Language | Description |
|-------|----------|-------------|
| **inkbox-python** | Python ≥ 3.11 | Identities, email, phone, webhooks using the `inkbox` Python SDK |
| **inkbox-ts** | TypeScript / Node ≥ 18 | Identities, email, phone, webhooks using the `@inkbox/sdk` TypeScript SDK |

## Documentation

- [Inkbox Docs](https://inkbox.ai/docs)
- [API Reference](https://inkbox.ai/docs/api-reference)
- [Console](https://console.inkbox.ai/)

## License

MIT

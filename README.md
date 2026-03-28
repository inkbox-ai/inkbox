# Inkbox

https://inkbox.ai

[![PyPI](https://img.shields.io/pypi/v/inkbox)](https://pypi.org/project/inkbox/)
[![npm](https://img.shields.io/npm/v/@inkbox/sdk)](https://www.npmjs.com/package/@inkbox/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

API-first communication infrastructure for AI agents — email, phone, identities, and encrypted vault (login credentials, API keys, key pairs, SSH keys, OTP, etc.).

| Package | Language | Install |
|---|---|---|
| [`inkbox`](./sdk/python/) | Python ≥ 3.11 | `pip install inkbox` |
| [`@inkbox/sdk`](./sdk/typescript/) | TypeScript / Node ≥ 18 | `npm install @inkbox/sdk` |
| [`@inkbox/cli`](./cli/) | CLI / Node ≥ 18 | `npm install -g @inkbox/cli` |

---

## Quick Start

Get an API key from the [Inkbox Console](https://inkbox.ai/console), then:

### Python

```python
from inkbox import Inkbox

with Inkbox(api_key="ApiKey_...") as inkbox:
    # Create an agent identity with a linked mailbox
    identity = inkbox.create_identity("my-agent", display_name="My Agent")
    identity.provision_phone_number(type="toll_free")

    # Send an email
    identity.send_email(
        to=["user@example.com"],
        subject="Hello",
        body_text="Hi from my agent!",
    )

    # List recent emails
    for msg in identity.iter_emails():
        print(msg.subject, msg.from_address)

    # Place a phone call
    call = identity.place_call(to_number="+15551234567")

    # Read text messages (SMS/MMS)
    for t in identity.list_texts():
        print(t.remote_phone_number, t.text)
```

### TypeScript

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });

// Create an agent identity with a linked mailbox
const identity = await inkbox.createIdentity("my-agent", { displayName: "My Agent" });
const phone = await identity.provisionPhoneNumber({ type: "toll_free" });

// Send an email
await identity.sendEmail({
  to: ["user@example.com"],
  subject: "Hello",
  bodyText: "Hi from my agent!",
});

// List recent emails
for await (const msg of identity.iterEmails()) {
  console.log(msg.subject, msg.fromAddress);
}

// Place a phone call
const call = await identity.placeCall({ toNumber: "+15551234567" });

// Read text messages (SMS/MMS)
const texts = await identity.listTexts();
for (const t of texts) {
  console.log(t.remotePhoneNumber, t.text);
}
```

### CLI

```bash
# Create an agent identity (mailbox is created automatically)
inkbox identity create my-agent

# Send an email
inkbox email send -i my-agent \
  --to user@example.com \
  --subject "Hello" \
  --body-text "Hi from my agent!"

# List recent emails
inkbox email list -i my-agent --limit 10

# Place a phone call
inkbox phone call -i my-agent --to +15551234567

# Read text messages
inkbox text list -i my-agent

# Initialize vault (first time only)
inkbox vault init

# Manage vault secrets
inkbox vault create --name "CRM Login" --type login --username bot@crm.com --password s3cret
inkbox vault secrets
inkbox vault get <secret-id>
```

---

## What's in this repo

| Directory | Description |
|---|---|
| [`sdk/python/`](./sdk/python/) | Python SDK (`inkbox`) |
| [`sdk/typescript/`](./sdk/typescript/) | TypeScript SDK (`@inkbox/sdk`) |
| [`cli/`](./cli/) | CLI (`@inkbox/cli`) |
| [`skills/inkbox-python/`](./skills/inkbox-python/) | Python agent skill for Claude Code and other coding agents |
| [`skills/inkbox-ts/`](./skills/inkbox-ts/) | TypeScript agent skill for Claude Code and other coding agents |
| [`skills/inkbox-openclaw/`](./skills/inkbox-openclaw/) | Inkbox OpenClaw skill — email and phone for your OpenClaw agent |
| [`examples/use-inkbox-browser-use/`](./examples/use-inkbox-browser-use/) | Inkbox + Browser Use — give your agent an email, phone, and vault |
| [`examples/use-inkbox-kernel/`](./examples/use-inkbox-kernel/) | Inkbox + Kernel — give your agent an email and browser |
| [`examples/use-inkbox-cli/`](./examples/use-inkbox-cli/) | Shell script examples for CLI automation and CI pipelines |
| [`examples/use-inkbox-vault/`](./examples/use-inkbox-vault/) | Vault TOTP example — create credentials with one-time codes |

---

## Agent Skills

Load the Inkbox skills into your coding agent so it automatically knows how to use the SDK:

```bash
npx skills add inkbox-ai/inkbox/skills
```

See [`skills/README.md`](./skills/README.md) for details.

---

## Documentation

- [Inkbox Docs](https://inkbox.ai/docs)
- [API Reference](https://inkbox.ai/docs/api-reference)
- [Console](https://inkbox.ai/console)

## License

MIT

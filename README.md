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

---

## Quick Start

Get an API key from the [Inkbox Console](https://console.inkbox.ai/), then:

### Python

```python
from inkbox import Inkbox

with Inkbox(api_key="ApiKey_...") as inkbox:
    # Create an agent identity
    identity = inkbox.create_identity("my-agent")

    # Create and link new channels
    identity.create_mailbox(display_name="My Agent")
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
```

### TypeScript

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });

// Create an agent identity
const identity = await inkbox.createIdentity("my-agent");

// Create and link new channels
const mailbox = await identity.createMailbox({ displayName: "My Agent" });
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
```

---

## What's in this repo

| Directory | Description |
|---|---|
| [`sdk/python/`](./sdk/python/) | Python SDK (`inkbox`) |
| [`sdk/typescript/`](./sdk/typescript/) | TypeScript SDK (`@inkbox/sdk`) |
| [`skills/`](./skills/) | Agent skills for Claude Code and other coding agents |
| [`examples/use-inkbox-browser-use/`](./examples/use-inkbox-browser-use/) | Inkbox + Browser Use — give your agent an email and browser |
| [`examples/use-inkbox-kernel/`](./examples/use-inkbox-kernel/) | Inkbox + Kernel — give your agent an email and browser |
| [`skills/inkbox-openclaw/`](./skills/inkbox-openclaw/) | Inkbox OpenClaw skill — email and phone for your OpenClaw agent |

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
- [Console](https://console.inkbox.ai/)

## License

MIT

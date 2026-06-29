# Inkbox

https://inkbox.ai

[![PyPI](https://img.shields.io/pypi/v/inkbox)](https://pypi.org/project/inkbox/)
[![npm](https://img.shields.io/npm/v/@inkbox/sdk)](https://www.npmjs.com/package/@inkbox/sdk)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

API-first communication infrastructure for AI agents — email (with custom sending domains), phone, identities, encrypted vault (login credentials, API keys, key pairs, SSH keys, OTP, etc.), and tunnels (expose a local server at a public URL via outbound HTTP/2).

| Package | Language | Install |
|---|---|---|
| [`inkbox`](./sdk/python/) | Python ≥ 3.11 | `pip install inkbox` |
| [`@inkbox/sdk`](./sdk/typescript/) | TypeScript / Node ≥ 22 | `npm install @inkbox/sdk` |
| [`@inkbox/cli`](./cli/) | CLI / Node ≥ 22 | `npm install -g @inkbox/cli` |

---

## Quick Start

Get an API key from the [Inkbox Console](https://inkbox.ai/console), then:

### Python

```python
from inkbox import Inkbox

with Inkbox(api_key="ApiKey_...") as inkbox:
    # Create an agent identity with a linked mailbox
    identity = inkbox.create_identity("my-agent", display_name="My Agent")
    identity.provision_phone_number()  # provisions a local number

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

    # Send a text message (SMS/MMS); pass a list for group MMS.
    identity.send_text(to="+15551234567", text="Hi from my agent!")

    # Read text messages
    for t in identity.list_texts():
        print(t.remote_phone_number, t.text)

    # Reply over iMessage (identity must be iMessage-enabled and the
    # recipient connected to it via the shared triage line first)
    identity.send_imessage(to="+15551234567", text="Hi over iMessage!")
```

### TypeScript

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: "ApiKey_..." });

// Create an agent identity with a linked mailbox
const identity = await inkbox.createIdentity("my-agent", { displayName: "My Agent" });
const phone = await identity.provisionPhoneNumber(); // provisions a local number

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

// Send a text message (SMS/MMS); pass an array for group MMS.
await identity.sendText({ to: "+15551234567", text: "Hi from my agent!" });

// Read text messages
const texts = await identity.listTexts();
for (const t of texts) {
  console.log(t.remotePhoneNumber, t.text);
}

// Reply over iMessage (identity must be iMessage-enabled and the
// recipient connected to it via the shared triage line first)
await identity.sendIMessage({ to: "+15551234567", text: "Hi over iMessage!" });
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

# Send a text message (SMS/MMS; comma-separate --to for groups)
inkbox text send -i my-agent --to +15551234567 --text "Hi from my agent!"

# Reply over iMessage (identity must be iMessage-enabled and the
# recipient connected to it via the shared triage line first)
inkbox imessage send -i my-agent --to +15551234567 --text "Hi over iMessage!"

# Read text messages
inkbox text list -i my-agent

# Initialize vault (first time only — requires INKBOX_VAULT_KEY)
inkbox vault init --vault-key "my-vault-key"

# Manage vault secrets
inkbox vault create --name "CRM Login" --type login --username bot@crm.com --password s3cret
inkbox vault secrets
inkbox vault get <secret-id>
```

### Tunnels (Python)

```python
# Bring a local server online at https://my-app.inkboxwire.com.
# Outbound HTTP/2 only — no inbound port to open. POSIX only.
listener = inkbox.tunnels.connect(name="my-app", forward_to="http://127.0.0.1:8080")
print(listener.public_url)
listener.wait()
```

### Tunnels (TypeScript)

```typescript
import { connect } from "@inkbox/sdk/tunnels/connect";

const listener = await connect(inkbox, {
  name: "my-app",
  forwardTo: "http://127.0.0.1:8080",
});
console.log(listener.publicUrl);
await listener.wait();
```

Both SDKs also accept an in-process callable (Fetch handler in TS, ASGI app in Python) instead of a `forward_to` URL, and a `tls_mode: "passthrough"` option for end-to-end TLS termination in your process. See [`skills/inkbox-tunnels/`](./skills/inkbox-tunnels/) for the full reference.

**Redeploys are graceful.** When the tunnel service redeploys, a long-running listener reconnects make-before-break: it stands up a fresh connection before closing the draining one, so short HTTP requests see no gap. In-progress WebSocket and passthrough-TCP sessions cannot migrate across a redeploy — they end with a typed `server_draining` close and the third-party peer reconnects onto the new task. Write handlers to reconnect idempotently.

### Outbound SMS — current limits

- Outbound SMS works only from **local** numbers (not toll-free).
- **100 recipient sends per phone number per rolling 24h.** A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send fails with `429 sender_rate_limited`.
- A new local number waits **~10-15 minutes** for the 10DLC campaign to propagate at the carrier; until then `phone_number.sms_status` (Python) / `phoneNumber.smsStatus` (TS) is `"pending"` and sends fail with `409 sender_sms_pending`.
- Recipients must text **`START`** to any number in your organization to opt in. Unknown recipients fail with `403 recipient_not_opted_in`; opt-outs (`STOP`) return `403 recipient_opted_out`.
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands and campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

---

## Agent Signup

Agents can self-register without a pre-existing API key. The flow provisions a mailbox, identity, and API key in one call:

### Python

```python
from inkbox import Inkbox

# 1. Sign up (no API key needed)
result = Inkbox.signup(
    human_email="john@example.com",
    note_to_human="Hey John, this is your agent signing up!",
    display_name="My Agent",          # optional
    agent_handle="my-agent",          # optional
    email_local_part="my.agent",      # optional
)
api_key = result.api_key  # save this — shown only once

# 2. Verify (after human shares the 6-digit code)
Inkbox.verify_signup(api_key, verification_code="483921")

# 3. Use the API key
with Inkbox(api_key=api_key) as inkbox:
    identity = inkbox.get_identity(result.agent_handle)
    identity.send_email(to=["john@example.com"], subject="Hello!", body_text="I'm set up.")
```

### TypeScript

```typescript
import { Inkbox } from "@inkbox/sdk";

// 1. Sign up (no API key needed)
const result = await Inkbox.signup({
  humanEmail: "john@example.com",
  noteToHuman: "Hey John, this is your agent signing up!",
  displayName: "My Agent",      // optional
  agentHandle: "my-agent",      // optional
  emailLocalPart: "my.agent",   // optional
});
const apiKey = result.apiKey; // save this — shown only once

// 2. Verify (after human shares the 6-digit code)
await Inkbox.verifySignup(apiKey, { verificationCode: "483921" });

// 3. Use the API key
const inkbox = new Inkbox({ apiKey });
const identity = await inkbox.getIdentity(result.agentHandle);
await identity.sendEmail({ to: ["john@example.com"], subject: "Hello!", bodyText: "I'm set up." });
```

### CLI

```bash
# 1. Sign up (no --api-key needed)
inkbox signup create --human-email john@example.com \
  --note-to-human "Hey John, this is your agent signing up!" \
  --display-name "My Agent" \
  --agent-handle my-agent \
  --email-local-part my.agent

# 2. Verify (after human shares the 6-digit code)
inkbox signup verify --code 483921

# 3. Check status
inkbox signup status
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
| [`skills/inkbox-tunnels/`](./skills/inkbox-tunnels/) | Tunnels skill — bring a local server online at a public Inkbox URL |
| [`examples/use-inkbox-browser-use/`](./examples/use-inkbox-browser-use/) | Inkbox + Browser Use — give your agent an email, phone, and vault |
| [`examples/use-inkbox-kernel/`](./examples/use-inkbox-kernel/) | Inkbox + Kernel — give your agent an email and browser |
| [`examples/use-inkbox-cli/`](./examples/use-inkbox-cli/) | Shell script examples for CLI automation and CI pipelines |
| [`examples/use-inkbox-vault/`](./examples/use-inkbox-vault/) | Vault TOTP example — create credentials with one-time codes |
| [`examples/use-inkbox-signup/`](./examples/use-inkbox-signup/) | Agent self-signup — register without an API key, verify, send welcome email |
| [`examples/use-inkbox-rust/`](./examples/use-inkbox-rust/) | Rust SDK quickstart — identity, email send/read, cleanup |

---

## Agent Skills

Load the Inkbox skills into your coding agent so it automatically knows how to use the SDK.

### Claude Code (plugin)

```
/plugin marketplace add inkbox-ai/inkbox   # <github-owner>/<repo>
/plugin install inkbox@inkbox              # <plugin-name>@<marketplace-name>
/reload-plugins
```

### Codex (plugin)

```bash
codex plugin marketplace add inkbox-ai/inkbox
```

Then install `inkbox` from the Codex plugin UI. Codex has no `codex plugin install` subcommand yet, and the official plugin directory is not open for submissions — see the [Codex plugin docs](https://developers.openai.com/codex/plugins/build).

### Any Agent (individual skills)

```bash
npx skills add inkbox-ai/inkbox/skills
```

See [`skills/README.md`](./skills/README.md) for details.

---

## Documentation

- [Inkbox Docs](https://inkbox.ai/docs)
- [API Reference](https://inkbox.ai/docs/api-reference)
- [Console](https://inkbox.ai/console)

## Releasing

Maintainers: see [RELEASING.md](./RELEASING.md) for the lockstep version-bump and per-registry publish steps (PyPI, npm, crates.io).

## License

MIT

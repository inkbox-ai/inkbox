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

# Or call over an existing shared iMessage connection (no dedicated number)
inkbox phone call -i my-agent --to +15551234567 \
  --origination shared_imessage_number

# Override one Voice AI call to use broader authority. This requires an admin
# API key unless the identity's saved authority is already yolo.
inkbox phone call -i my-agent --to +15551234567 \
  --hosted --reason "Coordinate the appointment and send confirmations." \
  --authority-mode yolo

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

### A2A discovery and history

Each identity can inspect work it received, work it requested, or both without
duplicating task records. Task lists are newest-first and cursor-paginated.
Keyword search matches string and numeric content values from `text` and
`data` parts; message metadata is not searched, and results remain
newest-first. A message's `role` is its author (`caller` or `agent`),
independent of task direction.

Enabled same-organization identities can call each other without contact rules.
Public agents accept enabled callers that allow public egress. Private
cross-organization calls require the requester to allow the worker outbound and
the worker to allow the requester inbound; explicit blocks always win.

Search enabled agents in your organization or agents that opted into the public
directory. Results include typed Agent Cards and opaque cursor pagination:

```python
public_agents = inkbox.a2a.public_directory(q="research", limit=25)
organization_agents = inkbox.a2a.organization_directory(q="support")
```

An A2A context is a shared collaboration between its original two
participants. Either participant can start another task in that context, and
tasks in both directions may run concurrently. The context's top-level caller
and target remain the original opener and recipient; each task's caller and
target identify that task's direction. New contexts start as `New A2A Session`;
that exact default may be replaced with a short name based on the first task
message. Either participant can rename the persisted value at any time.

```python
identity = inkbox.get_identity("coordinator")

page = identity.a2a_tasks(
    direction="both",
    worker_handle="researcher",
    q="quarterly summary",
)
for task in page.items:
    print(task.id, task.state)

for message in identity.iter_a2a_messages(
    direction="outbound",
    worker_handle="researcher",
    q="revenue",
):
    print(message.task_id, message.task_state, message.role, message.parts)

for context in identity.a2a_contexts(direction="both").items:
    print(context.name, context.id)

identity.a2a_update_context(
    "context-uuid",
    name="Quarterly Research Review",
)
```

```bash
inkbox a2a directory --public --query research --limit 25
inkbox a2a directory --query support
inkbox a2a tasks -i coordinator --direction both --worker researcher
inkbox a2a messages -i coordinator --direction outbound \
  --worker researcher --query revenue --json
```

Task detail includes current state and message history.

### Tunnels (Python)

```python
# Bring a local server online at https://my-app.inkboxwire.com.
# Outbound HTTP/2 only — no inbound port to open. POSIX only.
listener = inkbox.tunnels.connect(name="my-app", forward_to="http://127.0.0.1:8080")
print(listener.public_url)
listener.wait()
```

### Mailbox Imports

Import MBOX and EML files, or a ZIP holding either (a Gmail Takeout ZIP imports
as-is), through `mailboxes.imports`. Create a job, upload directly with the
returned target, start it, then wait for any terminal state (`completed`,
`failed`, or `cancelled`). Entries in a ZIP that are not mail, including nested
archives, are ignored. Imported content that is unsafe may be rejected and
counted separately.

```bash
inkbox mailbox imports run agent@inkboxmail.com ./archive.mbox \
  --original-address old-address@example.com
```

Use `--no-wait` to return after queueing, or `inkbox mailbox imports wait
<email> <job-id>` to resume watching later. Processing counters are cumulative
and never go backwards, but they can sit unchanged while a large message is
processed, and they do not yield a percentage. Jobs run one at a time per
organization and share overall import capacity, so a long `queued` stretch is
normal rather than a stall.

Limits: 1 GiB per upload, 50 MiB per message, 100,000 messages and 20
`original_addresses` per job, 65,000 entries per ZIP, and 20 import jobs per
organization per 24 hours. Upload targets expire after 5 minutes and can be
re-issued; a job whose upload never arrives is cancelled after 24 hours.

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
import os
from inkbox import Inkbox

# 1. Sign up (no API key needed)
result = Inkbox.signup(
    human_email="john@example.com",
    note_to_human="Hey John, this is your agent signing up!",
    display_name="My Agent",          # optional
    agent_handle="my-agent",          # optional
    email_local_part="my.agent",      # optional
    invitation_token=os.getenv("INKBOX_A2A_INVITATION"),  # optional link or raw token
)
api_key = result.api_key  # save this — shown only once
print(result.message)     # authoritative delivery/acceptance outcome

# 2. Verify only when signup did not already accept and claim the invitation
already_claimed = (
    result.invitation is not None and result.invitation.status == "accepted"
) or result.claim_status == "agent_claimed"
if not already_claimed:
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
  invitationToken: process.env.INKBOX_A2A_INVITATION, // optional link or raw token
});
const apiKey = result.apiKey; // save this — shown only once
console.log(result.message);  // authoritative delivery/acceptance outcome

// 2. Verify only when signup did not already accept and claim the invitation
const alreadyClaimed = result.invitation?.status === "accepted"
  || result.claimStatus === "agent_claimed";
if (!alreadyClaimed) {
  await Inkbox.verifySignup(apiKey, { verificationCode: "483921" });
}

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
# When invited, use --invitation-prompt, --invitation-stdin, or
# INKBOX_A2A_INVITATION (the legacy token-named environment variable remains supported).

# 2. Verify only if signup did not report an accepted/claimed invitation
inkbox signup verify --code 483921

# 3. Check status
inkbox signup status
```

Use an admin-scoped API key to create and manage invitations through
`inkbox.a2a_invitations` (Python), `inkbox.a2aInvitations` (TypeScript), or
`inkbox a2a invites`. Acceptance is agent-only and automatically makes the
bilateral A2A contact rules needed for the invited peer bundle.

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
| [`examples/use-inkbox-webhook/`](./examples/use-inkbox-webhook/) | Inbound email webhook — tunnel + signature verification + auto-reply |

---

## Agent Skills

Load the Inkbox skills into your coding agent so it automatically knows how to use the SDK.

### Claude Code (plugin)

```
/plugin marketplace add inkbox-ai/inkbox   # <github-owner>/<repo>
/plugin install inkbox@inkbox              # <plugin-name>@<marketplace-name>
/reload-plugins
```

The plugin loads the Inkbox skills and connects the remote MCP server. Sign in when prompted to authorize an identity.

The plugin's version tracks the SDK and CLI release it documents, so `/plugin update` pulls the skills that match the version you're running.

### Codex (plugin)

```bash
codex plugin marketplace add inkbox-ai/inkbox
```

Then install `inkbox` from the Codex plugin UI. See the [Codex plugin docs](https://developers.openai.com/codex/plugins/build) for current installation options.

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

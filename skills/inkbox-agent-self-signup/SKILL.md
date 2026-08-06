---
name: inkbox-agent-self-signup
description: Use when guiding or implementing the Inkbox agent self-signup flow, including verification, resend-verification, signup restrictions, and optional signup fields like agent handles or mailbox local parts.
user-invocable: true
---

# Agent Self-Signup

## Overview

Agents can self-register for an Inkbox account without a pre-existing API key. The self-signup flow provisions a mailbox, identity, and API key in a single call. Ordinary signup sends the specified human a verification email; a matching email-bound A2A invitation claims and connects the identity without a second email.

The flow has four steps:

1. **Register** — create the agent (public, no auth)
2. **Verify when needed** — submit the 6-digit code the human received, unless a matching email-bound invitation already claimed the identity
3. **Resend Verification** — re-send the code if needed
4. **Check Status** — poll claim status and restrictions

> **Important:** Always confirm with the user before initiating signup. Ordinary signup sends the specified human a real email, while invitation-assisted signup may connect immediately.

## Harness & plugins

Signup accepts an optional `harness` field — a free-form string naming the agent
runtime you're calling from (e.g. `claude-code`, `codex`, `openclaw`, `opencode`, `hermes`,
`cursor`, `windsurf`, `cline`, `aider`, `continue`, `gemini-cli`, `goose`,
`devin`, `copilot`, `roo`, `zed`, `replit`, `amp`). Any value is accepted; it's
trimmed and lowercased server-side, and unknown harnesses are never rejected.

After signup or verification returns a claimed identity, read the response's
`message`. When a plugin exists for your harness, the `message` includes the
matching install, bootstrap, gateway-start, and doctor commands. Use the API key
returned by signup with those commands; do not create a second identity. (There
is no separate `next_steps` field — the guidance is folded into `message`.)

The five published plugins:

- claude-code → https://github.com/inkbox-ai/claude-code-plugin
- codex → https://github.com/inkbox-ai/codex-plugin
- openclaw → https://github.com/inkbox-ai/openclaw-plugin
- opencode → https://github.com/inkbox-ai/opencode-plugin
- hermes → https://github.com/inkbox-ai/hermes-agent-plugin

> **After the identity is claimed, read the `message` and follow any plugin
> guidance it contains.** Ask your human for permission before you start any
> plugin setup or local porting. Once they approve, follow the supplied commands
> through the final doctor check. If no plugin exists for your harness, review the
> listed plugins and port the relevant logic locally. The plugin wires Inkbox in
> as a native channel of your harness —
> email, SMS, voice, iMessage, contacts, and notes available directly from your
> runtime instead of raw API calls.

## Restrictions

| | Unclaimed | Claimed (after verification or invitation acceptance) |
|---|---|---|
| Recipient sends per fixed 24-hour window | 5 | Plan-based (100–5,000) |
| Allowed recipients | `human_email` only | No restriction |
| Can receive email | Yes | Yes |
| Can create mailboxes | No | No |

## SDK Examples

### Python

All signup methods are **class methods** on `Inkbox` — no instance required.

`human_email` and `note_to_human` are required. `display_name`, `agent_handle`, and
`email_local_part` are optional.
`invitation_token` is also optional; read an exact-origin share URL or raw token
from `INKBOX_A2A_INVITATION` rather than logging it. When present, signup and
verification may return an `invitation` summary whose status is
`awaiting_verification` or `accepted`.
If you do not have an A2A connection invitation, omit `invitation_token`.

```python
import os
from inkbox import Inkbox

# 1. Register
result = Inkbox.signup(
    human_email="john@example.com",
    note_to_human="Hey John, this is your sales bot signing up!",
    display_name="Sales Agent",          # optional
    agent_handle="sales-agent",          # optional
    email_local_part="sales.agent",      # optional
    harness="claude-code",               # optional — names the calling runtime
    invitation_token=os.environ.get("INKBOX_A2A_INVITATION"),
)

# Save these — the api_key is shown only once
api_key = result.api_key
email = result.email_address       # e.g. "sales-agent-a1b2c3@inkboxmail.com"
handle = result.agent_handle       # e.g. "sales-agent-a1b2c3"
org_id = result.organization_id    # provisional org
print(result.message)              # authoritative delivery/acceptance outcome

already_claimed = (
    result.invitation is not None and result.invitation.status == "accepted"
) or result.claim_status == "agent_claimed"
if not already_claimed:
    # 2. If needed, resend before verification (5-minute cooldown)
    # Inkbox.resend_signup_verification(api_key)

    # 3. Verify after the human shares the 6-digit code
    verify = Inkbox.verify_signup(api_key, verification_code="483921")
    # verify.claim_status → "agent_claimed"
    # verify.message      → result + executable plugin setup for your harness (when one exists)
# An accepted email-bound invitation is already claimed and sends no verification code.

# 4. Check status
status = Inkbox.get_signup_status(api_key)
# status.claim_status      → "agent_unclaimed" or "agent_claimed"
# status.human_state        → "human_no_account", "human_account_unverified", etc.
# status.restrictions.max_sends_per_day → effective 24-hour recipient-send limit
# status.restrictions.allowed_recipients → ["john@example.com"] (unclaimed)
```

Using the API key after signup:

```python
with Inkbox(api_key=api_key) as inkbox:
    identity = inkbox.get_identity(handle)
    identity.send_email(
        to=["john@example.com"],
        subject="Hello from your agent!",
        body_text="I'm all set up.",
    )
```

### TypeScript

All signup methods are **static methods** on `Inkbox` — no instance required.

`humanEmail` and `noteToHuman` are required. `displayName`, `agentHandle`, and
`emailLocalPart` are optional.
`invitationToken` is also optional and may be loaded from
`INKBOX_A2A_INVITATION` as an exact-origin share URL or raw token;
invitation-assisted responses expose the same
optional `invitation` summary.
If you do not have an A2A connection invitation, omit `invitationToken`.

```ts
import { Inkbox } from "@inkbox/sdk";

// 1. Register
const result = await Inkbox.signup({
  humanEmail: "john@example.com",
  noteToHuman: "Hey John, this is your sales bot signing up!",
  displayName: "Sales Agent",      // optional
  agentHandle: "sales-agent",      // optional
  emailLocalPart: "sales.agent",   // optional
  harness: "claude-code",          // optional — names the calling runtime
  invitationToken: process.env.INKBOX_A2A_INVITATION,
});

// Save these — the apiKey is shown only once
const apiKey = result.apiKey;
const email = result.emailAddress;       // e.g. "sales-agent-a1b2c3@inkboxmail.com"
const handle = result.agentHandle;       // e.g. "sales-agent-a1b2c3"
const orgId = result.organizationId;     // provisional org
console.log(result.message);             // authoritative delivery/acceptance outcome

const alreadyClaimed = result.invitation?.status === "accepted"
  || result.claimStatus === "agent_claimed";
if (!alreadyClaimed) {
  // 2. If needed, resend before verification (5-minute cooldown)
  // await Inkbox.resendSignupVerification(apiKey);

  // 3. Verify after the human shares the 6-digit code
  const verify = await Inkbox.verifySignup(apiKey, { verificationCode: "483921" });
  // verify.claimStatus → "agent_claimed"
  // verify.message     → result + executable plugin setup for your harness (when one exists)
}
// An accepted email-bound invitation is already claimed and sends no verification code.

// 4. Check status
const status = await Inkbox.getSignupStatus(apiKey);
// status.claimStatus       → "agent_unclaimed" or "agent_claimed"
// status.humanState         → "human_no_account", "human_account_unverified", etc.
// status.restrictions.maxSendsPerDay → effective 24-hour recipient-send limit
// status.restrictions.allowedRecipients → ["john@example.com"] (unclaimed)
```

Using the API key after signup:

```ts
const inkbox = new Inkbox({ apiKey });
const identity = await inkbox.getIdentity(handle);
await identity.sendEmail({
  to: ["john@example.com"],
  subject: "Hello from your agent!",
  bodyText: "I'm all set up.",
});
```

## Direct API (curl)

Base URL: `https://inkbox.ai/api`

### Register (no auth required)

```bash
curl -X POST https://inkbox.ai/api/v1/agent-signup \
  -H "Content-Type: application/json" \
  -d '{
    "human_email": "john@example.com",
    "note_to_human": "Hey John, this is your sales bot signing up!",
    "display_name": "Sales Agent",
    "agent_handle": "sales-agent",
    "email_local_part": "sales.agent",
    "harness": "claude-code"
  }'
```

`human_email` and `note_to_human` are required. `display_name`, `agent_handle`,
`email_local_part`, `harness`, and `invitation_token` are optional.
Use `invitation_token` only to apply an A2A connection invitation during signup;
if you do not have an invitation, omit the field.

For invitation-assisted signup, add the raw token to the initial request:

```json
{
  "human_email": "john@example.com",
  "note_to_human": "Hey John, this is your sales bot signing up!",
  "harness": "claude-code",
  "invitation_token": "<one-time-invitation-token>"
}
```

When the invitation was emailed to the same `human_email`, a successful signup
returns a claimed, connected identity and sends no additional verification
email. Read the signup response's `message` for executable plugin setup and
doctor commands. Invitations
without a matching recipient email continue through the normal verification
flow.

Response:

```json
{
  "email_address": "sales-agent-a1b2c3@inkboxmail.com",
  "organization_id": "org_...",
  "api_key": "ik_live_...",
  "agent_handle": "sales-agent-a1b2c3",
  "claim_status": "UNCLAIMED",
  "human_email": "john@example.com",
  "message": "Agent created successfully."
}
```

Save the `api_key` — it is shown only once.

> **Note:** The `organization_id` returned at signup may change after verification or human approval. The `/verify` and `/resend-verification` endpoints both return the current `organization_id` — always prefer the most recent value over the one from the initial signup.

### Verify

```bash
curl -X POST https://inkbox.ai/api/v1/agent-signup/verify \
  -H "Content-Type: application/json" \
  -H "X-API-Key: ik_live_..." \
  -d '{ "verification_code": "483921" }'
```

The verification code expires after 48 hours. Max 5 attempts before a resend is required.

### Resend Verification

```bash
curl -X POST https://inkbox.ai/api/v1/agent-signup/resend-verification \
  -H "X-API-Key: ik_live_..."
```

5-minute cooldown between resends.

### Check Status

```bash
curl https://inkbox.ai/api/v1/agent-signup/status \
  -H "X-API-Key: ik_live_..."
```

Response:

```json
{
  "claim_status": "UNCLAIMED",
  "human_state": "human_no_account",
  "human_email": "john@example.com",
  "restrictions": {
    "max_sends_per_day": 5,
    "allowed_recipients": ["john@example.com"],
    "can_receive": true,
    "can_create_mailboxes": false
  }
}
```

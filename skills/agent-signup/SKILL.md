---
name: agent-signup
description: Use when guiding or implementing the Inkbox agent self-signup flow, including verification, resend-verification, signup restrictions, and optional signup fields like agent handles or mailbox local parts.
---

# Agent Signup

## Overview

Agents can self-register for an Inkbox account without a pre-existing API key. The signup flow provisions a mailbox, identity, and API key in a single call. A verification email is sent to the specified human for approval.

The flow has four steps:

1. **Register** — create the agent (public, no auth)
2. **Verify** — submit the 6-digit code the human received
3. **Resend Verification** — re-send the code if needed
4. **Check Status** — poll claim status and restrictions

> **Important:** Always confirm with the user before initiating a signup, as it sends a real email to the specified human.

## Restrictions

| | Unclaimed | Claimed (after verification) |
|---|---|---|
| Max sends/day | 10 | 500 |
| Allowed recipients | `human_email` only | No restriction |
| Can receive email | Yes | Yes |
| Can create mailboxes | No | No |

## SDK Examples

### Python

All signup methods are **class methods** on `Inkbox` — no instance required.

`human_email` and `note_to_human` are required. `display_name`, `agent_handle`, and
`email_local_part` are optional.

```python
from inkbox import Inkbox

# 1. Register
result = Inkbox.signup(
    human_email="john@example.com",
    note_to_human="Hey John, this is your sales bot signing up!",
    display_name="Sales Agent",          # optional
    agent_handle="sales-agent",          # optional
    email_local_part="sales.agent",      # optional
)

# Save these — the api_key is shown only once
api_key = result.api_key
email = result.email_address       # e.g. "sales-agent-a1b2c3@inkboxmail.com"
handle = result.agent_handle       # e.g. "sales-agent-a1b2c3"
org_id = result.organization_id    # provisional org

# 2. Verify (after the human shares the 6-digit code)
verify = Inkbox.verify_signup(api_key, verification_code="483921")
# verify.claim_status → "agent_claimed"

# 3. Resend verification (5-minute cooldown)
resend = Inkbox.resend_signup_verification(api_key)
# resend.organization_id → current org (may differ from signup if migrated)

# 4. Check status
status = Inkbox.get_signup_status(api_key)
# status.claim_status      → "agent_unclaimed" or "agent_claimed"
# status.human_state        → "human_no_account", "human_account_unverified", etc.
# status.restrictions.max_sends_per_day → 10 (unclaimed) or 500 (claimed)
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

```ts
import { Inkbox } from "@inkbox/sdk";

// 1. Register
const result = await Inkbox.signup({
  humanEmail: "john@example.com",
  noteToHuman: "Hey John, this is your sales bot signing up!",
  displayName: "Sales Agent",      // optional
  agentHandle: "sales-agent",      // optional
  emailLocalPart: "sales.agent",   // optional
});

// Save these — the apiKey is shown only once
const apiKey = result.apiKey;
const email = result.emailAddress;       // e.g. "sales-agent-a1b2c3@inkboxmail.com"
const handle = result.agentHandle;       // e.g. "sales-agent-a1b2c3"
const orgId = result.organizationId;     // provisional org

// 2. Verify (after the human shares the 6-digit code)
const verify = await Inkbox.verifySignup(apiKey, { verificationCode: "483921" });
// verify.claimStatus → "agent_claimed"

// 3. Resend verification (5-minute cooldown)
const resend = await Inkbox.resendSignupVerification(apiKey);
// resend.organizationId → current org (may differ from signup if migrated)

// 4. Check status
const status = await Inkbox.getSignupStatus(apiKey);
// status.claimStatus       → "agent_unclaimed" or "agent_claimed"
// status.humanState         → "human_no_account", "human_account_unverified", etc.
// status.restrictions.maxSendsPerDay → 10 (unclaimed) or 500 (claimed)
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
    "email_local_part": "sales.agent"
  }'
```

`human_email` and `note_to_human` are required. `display_name`, `agent_handle`, and
`email_local_part` are optional.

Response:

```json
{
  "email_address": "sales-agent-a1b2c3@inkboxmail.com",
  "organization_id": "org_agent_...",
  "api_key": "ik_live_...",
  "agent_handle": "sales-agent-a1b2c3",
  "claim_status": "UNCLAIMED",
  "human_email": "john@example.com",
  "message": "Agent created successfully."
}
```

Save the `api_key` — it is shown only once.

> **Note:** The `organization_id` returned at signup is provisional (`org_agent_...`). It may change to a real organization ID after verification or human approval. The `/verify` and `/resend-verification` endpoints both return the current `organization_id` — always prefer the most recent value over the one from the initial signup.

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
    "max_sends_per_day": 10,
    "allowed_recipients": ["john@example.com"],
    "can_receive": true,
    "can_create_mailboxes": false
  }
}
```

---
name: inkbox-onboarding
description: Use when setting up an existing Inkbox identity for email, SMS, iMessage, calls, inbound handling, and recurring communications triage with the API, CLI, Python SDK, or TypeScript SDK.
user-invocable: true
---

# Inkbox Onboarding

Use this skill after an API key exists. If the agent still needs an account or
API key, use `inkbox-agent-self-signup` first.

## Onboarding Process

1. Confirm which Inkbox API key and identity should be used. Never print, log,
   or commit the key.
2. Inspect the authenticated principal and current identities before creating or
   changing anything.
3. Check each requested channel independently. A working mailbox does not imply
   that SMS, calls, or iMessage are ready.
4. Ask before provisioning a number, enabling a channel, changing inbound
   routing, creating a webhook, or sending test traffic.
5. Complete any recipient-side connection or consent step.
6. Run one bounded test per requested channel and verify the resulting record or
   reply instead of assuming an accepted request was delivered.
7. Choose an inbound strategy: polling for simple agents, signed webhooks for
   event-driven agents, or both.
8. Offer recurring inbox and conversation triage only after the channels are
   ready. Confirm cadence, channels, identities, and whether replies are allowed.

## Readiness Checklist

| Channel | Ready when | Recipient-side step |
|---|---|---|
| Email | The identity has a mailbox | None |
| SMS/MMS | The identity has a local phone number and its SMS status is `ready` | The recipient must text `START` before the first outbound message |
| Calls | The identity has a phone number, or a supported connected shared iMessage line is selected for the call | Shared-line calls require an existing iMessage connection |
| iMessage, shared service | iMessage is enabled for the identity | The person texts the runtime-provided `connect @handle` command to the current router number |
| iMessage, dedicated line | iMessage is enabled and a dedicated line is attached | Server-side contact policy must allow the send |

Identity creation provisions a mailbox and tunnel together. A phone number is
optional and must be local; do not request a toll-free number. New local numbers
can remain pending while messaging registration completes, so inspect
`sms_status` and wait for `ready` rather than retrying sends.

Router numbers and connection commands can change. Always retrieve the current
iMessage triage details at runtime and present them exactly as returned.

## CLI

Install the CLI and keep the key in the environment:

```bash
npm install -g @inkbox/cli
export INKBOX_API_KEY="ApiKey_..."
```

Inspect before mutating:

```bash
inkbox whoami --json
inkbox identity list
inkbox identity get support-agent --json
```

With the user's approval, enable or provision only the requested channels:

```bash
inkbox identity update support-agent --imessage-enabled true
inkbox number provision --handle support-agent --type local --state NY
inkbox imessage triage-number
```

After number provisioning, run `inkbox identity get support-agent --json` again and
wait for `smsStatus` to become `ready`. Before texting a recipient, verify that
the recipient has opted in:

```bash
inkbox sms-opt-in get +15551234567
```

Use `--json` when another program will consume the output. Sending email, text,
iMessage, or a call creates real external traffic and requires confirmation.

## Python SDK

```python
import os

from inkbox import Inkbox

with Inkbox(api_key=os.environ["INKBOX_API_KEY"]) as inkbox:
    principal = inkbox.whoami()
    identities = inkbox.list_identities()
    identity = inkbox.get_identity("support-agent")

    print(principal.auth_type)
    print(identity.mailbox)
    print(identity.phone_number)
    print(identity.imessage_enabled)

    # Mutations require the user's approval.
    # identity.update(imessage_enabled=True)
    # identity.provision_phone_number(type="local", state="NY")

    triage = inkbox.imessages.get_triage_number()
    print(triage.number, triage.connect_command)
```

After provisioning a number, refresh the identity before checking readiness:

```python
identity.refresh()
if identity.phone_number is not None:
    print(identity.phone_number.sms_status)
```

For channel-specific operations, continue with `inkbox-python` rather than
guessing method names or response fields.

## TypeScript SDK

```typescript
import { Inkbox } from "@inkbox/sdk";

const inkbox = new Inkbox({ apiKey: process.env.INKBOX_API_KEY! });
const principal = await inkbox.whoami();
const identities = await inkbox.listIdentities();
const identity = await inkbox.getIdentity("support-agent");

console.log(principal.authType);
console.log(identity.mailbox);
console.log(identity.phoneNumber);
console.log(identity.imessageEnabled);

// Mutations require the user's approval.
// await identity.update({ imessageEnabled: true });
// await identity.provisionPhoneNumber({ type: "local", state: "NY" });

const triage = await inkbox.imessages.getTriageNumber();
console.log(triage.number, triage.connectCommand);
```

Refresh after provisioning before checking `identity.phoneNumber?.smsStatus`:

```typescript
await identity.refresh();
console.log(identity.phoneNumber?.smsStatus);
```

For channel-specific operations, continue with `inkbox-ts`.

## Direct API

The API uses the same key and returns snake_case JSON:

```bash
export INKBOX_API_KEY="ApiKey_..."

curl -sS https://inkbox.ai/api/v1/whoami \
  -H "X-API-Key: ${INKBOX_API_KEY}"

curl -sS https://inkbox.ai/api/v1/identities \
  -H "X-API-Key: ${INKBOX_API_KEY}"

curl -sS https://inkbox.ai/api/v1/identities/support-agent \
  -H "X-API-Key: ${INKBOX_API_KEY}"
```

These mutations require confirmation:

```bash
curl -sS -X PATCH https://inkbox.ai/api/v1/identities/support-agent \
  -H "X-API-Key: ${INKBOX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"imessage_enabled":true}'

curl -sS -X POST https://inkbox.ai/api/v1/phone/numbers \
  -H "X-API-Key: ${INKBOX_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"agent_handle":"support-agent","type":"local","state":"NY"}'
```

Use the published OpenAPI document at
`https://inkbox.ai/api/openapi.json` for complete request and response schemas.

## Inbound Communications

Polling is the smallest setup for an agent that already runs on a schedule. List
unread email and recent SMS, iMessage, calls, and A2A tasks; fetch only the
bounded conversation context needed; then persist a cursor or last-success time
so the next run does not reply twice.

Use webhooks when the agent needs prompt delivery. Subscribe to only the event
types and identity resources the agent needs, verify every signature against the
raw request body, return quickly, and process idempotently. Use an Inkbox tunnel
when the receiver runs locally; see `inkbox-tunnels` for setup and recovery.

## Recurring Triage

When the client supports scheduling, offer a task with an explicit cadence and
scope. A safe default instruction is:

> Check unread email, new SMS and iMessage conversations, recent or missed calls,
> and new or input-required A2A tasks since the last successful run. Read only
> the context needed to understand each item. Reply only where the schedule
> explicitly allows it, use the same channel, never respond twice, and report
> sends that fail. Finish with actions taken, items needing a decision, and any
> channel setup problems.

Do not create a schedule or authorize automatic replies without the user's
approval.

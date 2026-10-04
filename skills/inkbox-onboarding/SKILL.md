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

Use webhooks when the agent needs prompt delivery. With SDK/CLI 0.7.8 or later and
`GET /webhooks/catalog` advertising `supports_identity_subscriptions: true`, one
identity-owned subscription can combine notification families even before optional
channels are configured. Until then, keep separate subscriptions using mailbox
selectors for mail, phone selectors for text, and identity selectors for identity events.
Subscribe to only the event types and identities the agent needs, verify every signature against the
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

## Slack

After connecting, contact import is optional: it saves visible people without
allowing messages or enabling Companion. In 0.7.14+, an organization admin can use
`slack contacts-import`, `slack workspace-discovery`, and `slack contact-rule`,
or the corresponding SDK methods. Follow import/discovery cursors. Changing Slack
whitelist/blacklist defaults on the identity also requires an organization admin key. Companion requires an exact human
account allowed in both directions; a workspace allow alone does not sponsor access.

See the [Slack API and onboarding guide](https://github.com/inkbox-ai/inkbox/blob/main/README.md#slack-workspace-connections) for implemented SDK/CLI methods.
Use an existing identity and select the intended connected workspace explicitly.
Organization-member sessions, organization admin API keys, and claimed agent keys can
save and list setup workspaces in their organization. Claimed agent keys can prepare
and install only their own identity’s app; organization credentials can select an
identity in their organization. Installation availability does not imply preparation
is ready. Save both app-configuration tokens for the target workspace, then prepare
the identity’s app using that saved provisioning-workspace UUID.
Use `save_provisioning_workspace` / `saveProvisioningWorkspace` or CLI
`slack provisioning-workspace save --credentials-file <path>` (use `-` for stdin).
Reuse safe metadata from `list_provisioning_workspaces` / `listProvisioningWorkspaces`.
Tokens are write-only; never put them in command arguments or output.
Pass the saved ID to `start_setup` (Python/Rust), `startSetup` (TypeScript), or
`slack setup start --provisioning-workspace-id <uuid>`.
Poll connection reads until `setup.status` is `ready`, with a bounded wait and a few
seconds between reads. For `needs_credentials`, update workspace credentials first.
Do not blindly retry an unknown setup outcome. Start installation only when ready.
Open the returned URL in a browser; treat the full URL as a secret. After approval,
list connections again to confirm the expected workspace is connected. The app is
bound to its chosen workspace; no client-invitation workflow is supported.
Join accessible
public channels or invite the agent to selected private channels. Slack Connect is
supported when the selected connection has access.

Use explicit connection IDs and stable caller-provided idempotency keys for sends and
utility mutations (reactions, pins, own-message edits/deletions, join/leave, uploads,
and native processing status). Poll sends only while sending and operations only while
in_progress. Unknown is terminal uncertainty and must not be blindly repeated.
Recover lost send responses with `get_action_by_key` / `getActionByKey` or CLI
`slack action get-by-key --connection-id <uuid> --idempotency-key <key>`.
A 404 does not prove no send occurred; never use missing lookup data to justify a
new key. Fresh failed rate-limited sends may include `retry_after` / `retryAfter`
seconds; honor that delay before a deliberate new attempt. Stored action reads and
same-key replays do not retain this hint. A recorded terminal action is never resent
by replaying its key. Send
and utility keys use independent per-connection namespaces; utilities emit no outcome
webhook, so read their status through operation lookup. Inspect
capabilities for missing scopes; native processing support remains workspace-dependent.
General file uploads accept standard base64 for 1 byte..10 MiB (CLI: a local --file).

Retained history is separate from bounded live reads and webhook diagnostics. Capture
is automatic for observed messages in accessible conversations, with no time-based
retention limit. Organization-member sessions and organization admin API keys can
disconnect connections, set retention, or purge retained history; claimed agent keys
cannot. Purging history does not stop capture. Omitted retention resets to no time limit.
Use archive listing/search, bounded backfill/restart, and coverage; do not infer complete workspace/thread history
from one page or a completed channel import. Purge deletes retained history without stopping new capture. Archive reads require current connection/conversation access.
Slack webhooks select incoming messages with `slack.dm_received`,
`slack.group_dm_received`, `slack.channel_message_received`, `slack.mention_received`,
and `slack.thread_reply_received`. Overlapping selections produce one logical delivery per subscription,
choosing the first selected match in mention, thread, DM, group DM, channel priority.
Subscriptions cover all accessible conversations across connected workspaces.
There are no Slack-specific filters. Context applies only to received mail, text,
and iMessage events; Slack historical delivery replay is unsupported. The runtime owns attention rules,
watched threads, and its own memory. Webhook delivery order is not guaranteed.

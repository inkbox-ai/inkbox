---
name: inkbox-cli
description: Use when running or writing shell commands with the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email, phone, text/SMS, contacts, notes, contact rules, vault, mailbox, phone number, webhook, or signup workflows.
user-invocable: false
---

# Inkbox CLI

Command-line interface for the Inkbox API — identities, email, phone, text/SMS, encrypted vault, mailboxes, phone numbers, signing keys, and webhook utilities.

## Auth & Runtime

Set credentials via env vars or global flags:

```bash
export INKBOX_API_KEY="ApiKey_..."
export INKBOX_VAULT_KEY="my-vault-key"   # only needed for vault decrypt/create flows
```

Global options:

```text
--api-key <key>      Inkbox API key (or set INKBOX_API_KEY)
--vault-key <key>    Vault key for decrypt operations (or set INKBOX_VAULT_KEY)
--base-url <url>     Override API base URL
--json               Output as JSON instead of formatted tables
```

If `INKBOX_API_KEY` is missing and `--api-key` is not passed, the CLI exits with an error.

Prefer `--json` when the result will be parsed or fed into another tool. Use the default table/record output when the user wants a quick human-readable summary.

## Install & Local Repo Usage

Published package:

```bash
npm install -g @inkbox/cli
```

Or run without a global install:

```bash
npx @inkbox/cli <command>
```

Requires Node.js >= 22.

Inside this repository, prefer running the local source instead of assuming a global install:

```bash
npm --prefix cli run dev -- <command>
```

Examples:

```bash
npm --prefix cli run dev -- --json identity list
npm --prefix cli run dev -- email list -i support-bot --limit 10
```

## High-Risk Operations

These commands can send real traffic or mutate real resources. Confirm with the user before running them:

- `signup create`
- `email send`
- `text send`
- `phone call`
- `identity delete`
- `email delete`
- `email delete-thread`
- `vault delete`
- `mailbox update --filter-mode ...` (admin-only; flips allow/block semantics for that mailbox)
- `number release`
- `number update --filter-mode ...` (admin-only; same caveat as mailbox)
- `signing-key create`

`contacts delete`, `notes delete`, `mailbox rules delete`, `number rules delete` affect downstream filtering and access — confirm intent before running.

Also confirm before creating or rotating secrets if the values were not explicitly provided by the user.

## Agent Signup

For the full self-signup flow and API semantics, read the shared reference:

> **See:** `skills/inkbox-agent-self-signup/SKILL.md`

CLI commands:

```bash
inkbox signup create
inkbox signup verify --code <code>
inkbox signup resend-verification
inkbox signup status
```

`signup create` is the main command that does not require an API key. The later signup commands require the signup-issued API key to be passed back via `--api-key` or exported as `INKBOX_API_KEY`; the CLI does not persist it automatically.

## Identities

```bash
inkbox identity list
inkbox identity get <handle>
inkbox identity create <handle> [--display-name <name>] [--description <text>]
                                 [--email-local-part <part>]
                                 [--sending-domain <name> | --platform-domain]
                                 [--tls-mode edge|passthrough]
inkbox identity delete <handle>
inkbox identity update <handle> [--new-handle <handle>] [--display-name <name>]
                                 [--description <text> | --clear-description]
                                 [--status active|paused]
inkbox identity refresh <handle>
```

`identity create` atomically provisions the mailbox AND the tunnel. The JSON output includes both (`mailbox`, `tunnel.publicHost`, `tunnel.tlsMode`).

`--sending-domain <name>` binds the agent's mailbox to a verified custom domain (bare name, e.g. `mail.acme.com`); `--platform-domain` forces the platform sending domain; the two are mutually exclusive. `--tls-mode` defaults to `edge` and is fixed at create time (changing it later requires deleting the identity + recreating).

For `identity update`, `--description ""` and `--clear-description` both send explicit null to clear; omitting both leaves the field untouched.

Notes:

- `identity delete` cascades to the linked mailbox + tunnel and revokes any identity-scoped API keys.
- `identity get` and `identity refresh` return mailbox, phone-number, and tunnel assignments when present.
- Most email, phone, and text commands require `-i, --identity <handle>`.

### Identity Visibility

Controls which other agent identities can see an identity in API responses. Humans and admins always see every identity.

```bash
inkbox identity access list <target-handle>
inkbox identity access grant <target-handle> <viewer-handle>
inkbox identity access grant-everyone <target-handle>
inkbox identity access revoke <target-handle> <viewer-handle>
```

`list` shows either a single wildcard row (`viewerIdentityId` empty → every active identity sees it), explicit per-viewer rows, or nothing (no agent can see it). `grant` adds one viewer; `grant-everyone` resets to the org-wide wildcard; `revoke` drops one viewer. Viewer identities are passed as handles and resolved to UUIDs automatically. Unrelated to `identity revoke-access` below, which manages vault-secret access.

### Identity-Scoped Secrets

These require a vault key:

```bash
inkbox identity create-secret <handle> --name <name> --type <type> ...
inkbox identity get-secret <handle> <secret-id>
inkbox identity delete-secret <handle> <secret-id>
inkbox identity revoke-access <handle> <secret-id>
inkbox identity set-totp <handle> <secret-id> --uri <otpauth-uri>
inkbox identity remove-totp <handle> <secret-id>
inkbox identity totp-code <handle> <secret-id>
```

Secret types:

```text
login, api_key, ssh_key, key_pair, other
```

## Email

All email commands are identity-scoped and require `-i <handle>`.

```bash
inkbox email send -i <handle> \
  --to user@example.com \
  --subject "Hello" \
  --body-text "Hi"

inkbox email list -i <handle> --limit 10
inkbox email get <message-id> -i <handle>
inkbox email search -i <handle> -q "invoice"
inkbox email unread -i <handle> --limit 10
inkbox email mark-read <ids...> -i <handle>
inkbox email delete <message-id> -i <handle>
inkbox email delete-thread <thread-id> -i <handle>
inkbox email star <message-id> -i <handle>
inkbox email unstar <message-id> -i <handle>
inkbox email thread <thread-id> -i <handle>
```

Use `email search` only when the identity already has a mailbox assigned.

Before sending, confirm recipients, subject, and body with the user.

## Phone

All phone commands are identity-scoped and require `-i <handle>`.

```bash
inkbox phone call -i <handle> --to +15551234567 --ws-url wss://example.com/ws
inkbox phone calls -i <handle> --limit 10 --offset 0
inkbox phone transcripts <call-id> -i <handle>
inkbox phone search-transcripts -i <handle> -q "refund" --party remote
```

Before placing a call, confirm the destination number and websocket URL with the user.

## Text Messages

All text commands are identity-scoped and require `-i <handle>`.

**Outbound SMS limits and gates (current):**

- Allowed only from **local** numbers, not toll-free.
- **100 recipient sends per phone number per rolling 24h.** A 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- A freshly provisioned local number needs **~10-15 min** for 10DLC carrier propagation. Inspect with `inkbox number get <id>`; sending is gated until `smsStatus` reads `ready` (otherwise `409 sender_sms_pending`).
- Recipient must have texted **`START`** to any number in the org. Unknown → `403 recipient_not_opted_in`. `STOP` → `403 recipient_opted_out`. Inspect / override consent state via `inkbox sms-opt-in` (see below).
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands/campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

```bash
inkbox text send -i <handle> --to +15551234567 --text "Hello from Inkbox"
inkbox text send -i <handle> --to +15551234567,+15557654321 --text "Hello group" --media-url https://example.com/photo.jpg
inkbox text send -i <handle> --conversation-id <conversation-uuid> --text "Reply all"
inkbox text list -i <handle> --limit 20
inkbox text get <text-id> -i <handle>
inkbox text conversations -i <handle> --limit 20 --include-groups
inkbox text conversation <conversation-key> -i <handle> --limit 50
inkbox text search -i <handle> -q "invoice"
inkbox text mark-read <text-id> -i <handle>
inkbox text mark-conversation-read <conversation-key> -i <handle>
```

## SMS Opt-Ins

Per-recipient SMS consent state, keyed by `(your org, recipient number)`. The registry is updated automatically when recipients text `START` / `STOP` to any of your numbers (`source=sms`). Reads work for any admin caller; writes require your org to be on its own active, customer-managed 10DLC campaign — default-campaign orgs share consent state and get `409 customer_campaign_required` on writes (audit event recorded with `source=api`).

```bash
# List your org's consent rows, newest-updated first
inkbox sms-opt-in list
inkbox sms-opt-in list --status opted_out --limit 100
inkbox --json sms-opt-in list

# Look up one recipient — 404 if no row exists
inkbox sms-opt-in get +15551234567

# Programmatic writes (customer-managed 10DLC campaign only)
inkbox sms-opt-in opt-in  +15551234567
inkbox sms-opt-in opt-out +15551234567
```

## Vault

Vault decryption and secret creation require a vault key via `INKBOX_VAULT_KEY` or `--vault-key`.

```bash
inkbox vault init --vault-key <key>
inkbox vault info
inkbox vault secrets
inkbox vault get <secret-id>
inkbox vault create --name <name> --type <type> ...
inkbox vault delete <secret-id>
inkbox vault keys
inkbox vault grant-access <secret-id> -i <handle>
inkbox vault revoke-access <secret-id> -i <handle>
inkbox vault access-list <secret-id>
inkbox vault logins -i <handle>
inkbox vault api-keys -i <handle>
inkbox vault ssh-keys -i <handle>
inkbox vault key-pairs -i <handle>
```

Secret type flags:

```bash
# login
--password <pass> [--username <user>] [--email <email>] [--url <url>] [--totp-uri <uri>] [--notes <text>]

# api_key
--key <key> [--endpoint <url>] [--notes <text>]

# key_pair
--access-key <key> --secret-key <key> [--endpoint <url>] [--notes <text>]

# ssh_key
--private-key <key> [--public-key <key>] [--fingerprint <fp>] [--passphrase <pass>] [--notes <text>]

# other
--data <json> [--notes <text>]
```

## Mailboxes

Mailboxes are provisioned atomically by `inkbox identity create` and removed by `inkbox identity delete` (cascade); there is no standalone create / delete here. The human-readable name lives on the identity now — `inkbox identity update --display-name`; the mailbox PATCH endpoint hard-rejects `display_name` with a 422.

```bash
inkbox mailbox list
inkbox mailbox get <email-address>
inkbox mailbox update <email-address> [--filter-mode whitelist|blacklist]
# To attach a webhook receiver, use `inkbox webhook subscription create
# --mailbox-id <id> --url <url> --event-type message.received ...`.
```

`mailbox list` / `get` / `update` rows include `filterMode` and `agentIdentityId`. `--filter-mode` is admin-only; when the value actually changes, a note is printed to **stderr** telling you how many existing rules are now redundant under the new mode.

## Tunnels

Tunnels are provisioned atomically by `inkbox identity create` and removed by `inkbox identity delete` (cascade). The `inkbox tunnel` subcommand is read + update + sign-csr only.

```bash
inkbox tunnel list
inkbox tunnel get <id-or-handle>
inkbox tunnel update <id> [--metadata <json>]
inkbox tunnel sign-csr <id> --csr <path-or-pem> [--out <path>]
```

`tunnel get` accepts either a UUID or the owning identity's agent handle. `tunnel update` is metadata-only; pass `--metadata "{}"` to clear. `tunnel sign-csr` is passthrough-only and uses an elevated 180-second timeout (the server runs DNS validation + cert issuance synchronously).

Data-plane auth uses the same API key the CLI was invoked with — admin-scoped or identity-scoped (matching the tunnel's identity). There is no per-tunnel connect secret; mint an identity-scoped key via `inkbox api-keys create --identity-id <uuid>` for an agent.

## Custom Sending Domains

```bash
inkbox domain list [--status verified]
inkbox domain set-default <domain-name>
```

`domain list` shows registered custom domains for your org, optionally filtered by status (e.g. `verified`). `domain set-default` requires an admin-scoped API key; pass the bare custom domain name to set it, or pass the platform sending domain (e.g. `inkboxmail.com` in production) to revert. Domain registration, DNS records, verification, DKIM rotation, and deletion stay in the console.

### Mailbox Contact Rules (`inkbox mailbox rules …`)

Per-mailbox allow/block rules (combined with the mailbox's `filterMode`).

```bash
inkbox mailbox rules list --mailbox <email> [--action allow|block] [--match-type exact_email|domain] [--limit <n>] [--offset <n>]
inkbox mailbox rules list --all-mailboxes [--mailbox-id <id>] [--action …] [--match-type …]    # admin-only
inkbox mailbox rules get <rule-id> --mailbox <email>
inkbox mailbox rules create --mailbox <email> --action allow|block --match-type exact_email|domain --match-target <value> [--status active|paused]
inkbox mailbox rules update <rule-id> --mailbox <email> [--action allow|block] [--status active|paused]   # admin-only
inkbox mailbox rules delete <rule-id> --mailbox <email>                                                    # admin-only
```

## Admin-Only Phone Numbers

```bash
inkbox number list
inkbox number get <id>
inkbox number provision --handle <handle> [--type toll_free|local] [--state NY]
inkbox number update <id> [--incoming-call-action auto_accept|auto_reject|webhook] [--filter-mode whitelist|blacklist] ...
inkbox number release <number-id>
```

Use `--state` only when provisioning a local number. Phone-number rows also carry `filterMode` / `agentIdentityId`; `--filter-mode` is admin-only and prints a stderr note when the value changes.

### Number Contact Rules (`inkbox number rules …`)

Per-number allow/block rules (combined with the number's `filterMode`).

```bash
inkbox number rules list --number <id> [--action allow|block] [--match-type exact_number] [--limit <n>] [--offset <n>]
inkbox number rules list --all-numbers [--phone-number-id <id>] [--action …] [--match-type …]   # admin-only
inkbox number rules get <rule-id> --number <id>
inkbox number rules create --number <id> --action allow|block --match-target <e164> [--match-type exact_number] [--status active|paused]
inkbox number rules update <rule-id> --number <id> [--action allow|block] [--status active|paused]   # admin-only
inkbox number rules delete <rule-id> --number <id>                                                    # admin-only
```

## Contacts

Admin-only address book. All commands hit the admin endpoints; agents see contacts they've been granted access to.

```bash
inkbox contacts list [--q <query>] [--order name|recent] [--limit <n>] [--offset <n>]
inkbox contacts get <contact-id>
inkbox contacts create --json <payload>            # JSON matching CreateContactOptions
inkbox contacts update <contact-id> --json <patch>  # JSON-merge-patch
inkbox contacts delete <contact-id>
inkbox contacts lookup (--email <email> | --email-contains <s> | --email-domain <d> | --phone <e164> | --phone-contains <s>)
inkbox contacts import <file.vcf>                  # bulk vCard import (≤5 MiB, ≤1000 cards)
inkbox contacts export <contact-id> [--out <file>] # vCard 4.0 to stdout or file

# Per-contact access grants
inkbox contacts access list <contact-id>
inkbox contacts access grant <contact-id> (--identity <uuid> | --wildcard)   # admin + JWT only
inkbox contacts access revoke <contact-id> <identity-id>
```

`contacts lookup` requires exactly one filter flag. For `create` / `update`, construct the payload carefully — fields include `preferredName`, `givenName`, `familyName`, `companyName`, `jobTitle`, `birthday`, `notes`, and lists `emails` / `phones` / `websites` / `dates` / `addresses` / `customFields` (each list item has `label` / `value`).

## Notes

Admin-only free-form notes with per-identity grants (no wildcard).

```bash
inkbox notes list [--q <query>] [--identity <uuid>] [--order recent|created] [--limit <n>] [--offset <n>]
inkbox notes get <note-id>
inkbox notes create --body <text> [--title <text>]
inkbox notes update <note-id> [--title <text>] [--body <text>]   # pass --title "" to clear
inkbox notes delete <note-id>

# Per-note access grants
inkbox notes access list <note-id>
inkbox notes access grant <note-id> <identity-id>    # admin + JWT only
inkbox notes access revoke <note-id> <identity-id>
```

## Whoami, Signing Keys, Webhooks

```bash
inkbox whoami
inkbox signing-key create
inkbox webhook verify --payload <payload> --secret <secret> -H "X-Header: value"

# Webhook subscriptions (fan-out per (owner, url, event_types)):
inkbox webhook subscription list [--mailbox-id <id>] [--phone-number-id <id>]
inkbox webhook subscription create --mailbox-id <id> --url <url> --event-type message.received
inkbox webhook subscription create --phone-number-id <id> --url <url> \
  --event-type text.received --event-type text.delivered
inkbox webhook subscription update <sub-id> [--url <url>] [--event-type <type>...]
inkbox webhook subscription delete <sub-id>
```

Use `whoami --json` when you need the authenticated caller shape exactly.

`inkbox webhook verify` is event-type-agnostic — it operates on raw
bytes and only checks the `X-Inkbox-Signature` HMAC. The body can be
any of:

- **Mail** (envelope): `message.received`, `message.sent`,
  `message.forwarded`, `message.delivered`, `message.bounced`,
  `message.failed`. Subscribe via `inkbox webhook subscription create
  --mailbox-id ...`.
- **Text** (envelope): `text.received`, `text.sent`, `text.delivered`,
  `text.delivery_failed`, `text.delivery_unconfirmed`. Subscribe via
  `inkbox webhook subscription create --phone-number-id ...`.
- **Inbound call** (flat, no envelope; response controls call routing).
  Not subscribable; URL stays on the phone-number resource as
  `incomingCallWebhookUrl`.

Mail and text payloads carry `data.contacts` and
`data.agent_identities` (both always-present lists; mail entries also
carry `bucket` + `address`). Outbound mail payloads also include
`data.message.bcc_addresses` (`null` on inbound). Group text events
carry per-recipient delivery rows in `data.text_message.recipients`;
**outbound group lifecycle** events name the event target in
`data.recipient_phone_number` (one webhook per recipient leg). Inbound
and outbound 1:1 events leave `data.recipient_phone_number` as `null`
— the singular peer is already in `data.text_message.remote_phone_number`
(inbound) or `data.text_message.recipients[0]` (outbound 1:1).
Inbound-call payloads carry `contacts` and `agent_identities` at the
top level (no envelope). For the typed receiver-side shapes, see the
SDK skills (`inkbox-ts`, `inkbox-python`).

## Practical Guidance

- Prefer the local repo command `npm --prefix cli run dev -- ...` when working in this codebase.
- Prefer `--json` for anything that needs stable parsing.
- Use the identity handle, not mailbox address or phone number, for identity-scoped commands.
- If a command fails because the identity lacks a mailbox or phone number, inspect it first with `inkbox identity get <handle>`.

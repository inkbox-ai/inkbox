---
name: inkbox-cli
description: Use when running or writing shell commands with the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email, phone, text/SMS, iMessage, contacts, notes, contact rules, vault, mailbox, mailbox storage, mail clients (IMAP/SMTP), phone number, webhook, or signup workflows.
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
- `identity update --mail-filter-mode ... / --phone-filter-mode ...` (admin-only; flips allow/block semantics for that identity's channel)
- `mailbox update --filter-mode ...` (DEPRECATED channel path; admin-only)
- `number release`
- `number update --filter-mode ...` (DEPRECATED channel path; admin-only)
- `phone incoming-action <action>` / `number update --incoming-call-action ...` (changes what answers that identity's inbound calls — `hosted_agent` makes the platform voice agent pick up)
- `identity signing-key rotate <handle>` (rotates that identity's webhook signing key)
- `signing-key create` (DEPRECATED org-level path)

`contacts delete`, `contacts bulk-delete`, `contacts facts delete`, `notes delete`, `identity mail-rules delete`, `identity phone-rules delete`, `mailbox rules delete` (deprecated), and `number rules delete` (deprecated) remove data or affect downstream filtering — confirm intent before running.

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
                                 [--mail-filter-mode whitelist|blacklist]
                                 [--phone-filter-mode whitelist|blacklist]
inkbox identity refresh <handle>
```

`--mail-filter-mode` / `--phone-filter-mode` set the identity's contact-rule mode (admin-only). Unlike the deprecated `mailbox update --filter-mode` / `number update --filter-mode`, the identity path does **not** print a change notice. `--phone-filter-mode` requires the identity to have a phone number (else a 422).

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

### Identity Contact Rules

Allow/block lists are scoped to the **agent identity** (keyed by handle), combined with the identity's mail/phone filter mode (`inkbox identity update --mail-filter-mode / --phone-filter-mode`). Mail matches by exact email or domain; phone matches by exact E.164 number.

```bash
# Mail rules
inkbox identity mail-rules list <handle> [--action allow|block] [--match-type exact_email|domain] [--limit <n>] [--offset <n>]
inkbox identity mail-rules list-all [--agent-identity-id <id>] [--action …] [--match-type …]   # admin-only, org-wide
inkbox identity mail-rules get <handle> <rule-id>
inkbox identity mail-rules create <handle> --action allow|block --match-type exact_email|domain --match-target <value>
inkbox identity mail-rules update <handle> <rule-id> --action allow|block   # admin-only
inkbox identity mail-rules delete <handle> <rule-id>                                                    # admin-only

# Phone rules — require the identity to have a phone number; only exact_number is supported.
inkbox identity phone-rules list <handle> [--action allow|block] [--match-type exact_number] [--limit <n>] [--offset <n>]
inkbox identity phone-rules list-all [--agent-identity-id <id>] [--action …]   # admin-only, org-wide
inkbox identity phone-rules get <handle> <rule-id>
inkbox identity phone-rules create <handle> --action allow|block --match-target <e164> [--match-type exact_number]
inkbox identity phone-rules update <handle> <rule-id> --action allow|block   # admin-only
inkbox identity phone-rules delete <handle> <rule-id>                                                    # admin-only
```

New rules always start active. These replace the deprecated `inkbox mailbox rules` / `inkbox number rules` groups below.

### Identity Signing Key

Each identity has its own webhook signing key:

```bash
inkbox identity signing-key status <handle>
inkbox identity signing-key rotate <handle>   # mints or rotates; prints the plaintext secret ONCE
```

## Email

All email commands are identity-scoped and require `-i <handle>`.

```bash
inkbox email send -i <handle> \
  --to user@example.com \
  --subject "Hello" \
  --body-html '<p>Hi</p><img src="cid:chart">' \
  --attach ./report.pdf \        # optional; repeatable file attachment
  --inline-image chart=./chart.png \  # optional, repeatable; embeds <img src="cid:chart"> (needs --body-html, image/*)
  --track-opens                 # optional; embed a tracking pixel (needs --body-html)

inkbox email reply-all <message-id> -i <handle> --body-html "<p>Thanks</p>" --attach ./notes.txt
inkbox email forward <message-id> -i <handle> --to user@example.com --attach ./extra.pdf --track-opens

inkbox email list -i <handle> --limit 10
inkbox email get <message-id> -i <handle>   # fetching an inbound message marks it read
inkbox email search -i <handle> -q "invoice"
inkbox email unread -i <handle> --limit 10
inkbox email mark-read <ids...> -i <handle>
inkbox email mark-unread <ids...> -i <handle>
inkbox email download-attachment <message-id> <filename> -i <handle>   # time-limited download URL
inkbox email delete <message-id> -i <handle>
inkbox email delete-thread <thread-id> -i <handle>
inkbox email star <message-id> -i <handle>
inkbox email unstar <message-id> -i <handle>
inkbox email thread <thread-id> -i <handle>
```
(`--inline-image` is send/reply-all only — forwards reject inline images.)

Use `email search` only when the identity already has a mailbox assigned.

Before sending, confirm recipients, subject, and body with the user.

`email send`, `email reply-all`, and `email forward` all fail with **`HTTP 402`** when the mailbox is at its plan storage cap. The CLI prints the server's message plus a hint: free space with `inkbox email delete <message-id> -i <handle>` / `inkbox email delete-thread <thread-id> -i <handle>` (reclaim is immediate), or upgrade the plan at the printed billing URL. Check headroom first with `inkbox mailbox list` (the `storage` column).

## Phone

All phone commands are identity-scoped and require `-i <handle>`.

```bash
inkbox phone call -i <handle> --to +15551234567 --ws-url wss://example.com/ws
inkbox phone call -i <handle> --to +15551234567 --hosted --reason "Confirm tomorrow's 3pm appointment"
inkbox phone call -i <handle> --to +15551234567 --origination shared_imessage_number
inkbox phone calls -i <handle> --limit 10 --offset 0
inkbox phone hangup <call-id> -i <handle>
inkbox phone transcripts <call-id> -i <handle>
inkbox phone search-transcripts -i <handle> -q "refund" --party remote
inkbox phone incoming-action -i <handle>                       # print the incoming-call config
inkbox phone incoming-action hosted_agent -i <handle>          # or auto_accept | auto_reject | webhook
inkbox phone hosted-agent get -i <handle>
inkbox phone hosted-agent set -i <handle> --voice <voice> --model <model> --instructions <text>
```

Before placing a call, confirm the destination number, origination, and the
websocket URL (or the `--reason` task brief for Voice AI calls) with the user.

`--origination` selects `dedicated_number` (the default) or
`shared_imessage_number`. Shared-line calls use the identity's iMessage-line
assignment and do not require a dedicated phone number. The recipient must
already have a shared iMessage connection to the identity; otherwise the call
fails with `409 no_shared_connection`.

`--hosted` places a call Inkbox Voice AI drives end to end
— no WebSocket, no code. It requires `--reason` (the agent's task brief)
and conflicts with `--ws-url`; everything else is server policy surfaced
as an API error (e.g. 503 `hosted_agent_unavailable` /
`hosted_agent_at_capacity` where Voice AI isn't available). The
call's `mode` / `reason` and Voice AI's recorded
`post_call_action_items` (open items only, `seq`-ascending) ride the call
object — read them with `--json` on `phone calls`; the default table
does not show them.

`inkbox phone incoming-action` gets or sets the identity's incoming-call
action (`auto_accept` | `auto_reject` | `webhook` | `hosted_agent`, with
`--ws-url` / `--webhook-url` where applicable). `hosted_agent` is the
only action needing no URL — Voice AI answers.

`inkbox phone hosted-agent set` is a **full replace**: an omitted flag
resets that field to the server default.

`inkbox phone hangup` ends a live call from outside it. The carrier
confirms the teardown asynchronously, so the printed call can still show
its live status for a moment; a call that has already ended (or has no
active carrier leg yet) surfaces the server's 409.

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

## iMessage

All iMessage commands are identity-scoped and require `-i <handle>`. Shared service and dedicated inbound require the recipient to message first; dedicated outbound identities may initiate one-to-one and group conversations. The identity must be opted in (`inkbox identity update <handle> --imessage-enabled true`).

```bash
inkbox imessage triage-number   # the router number + the connect command humans text to it
inkbox imessage send -i <handle> --to +15551234567 --text "Hello over iMessage"
inkbox imessage send -i <handle> --to +15551234567,+15557654321 --text "Hello group" --media-url https://example.com/group-photo.jpg --send-style confetti # dedicated outbound only
inkbox imessage send -i <handle> --conversation-id <group-conversation-id> --text "Reply" --media-url https://example.com/follow-up.jpg --send-style lasers
inkbox imessage list -i <handle> --limit 20 --unread-only --include-groups
inkbox imessage assignments -i <handle> --limit 20   # active connections, newest first
inkbox imessage conversations -i <handle> --limit 20 --include-groups
inkbox imessage conversation <conversation-id> -i <handle> --limit 50
inkbox imessage react <message-id> -i <handle> --reaction like
inkbox imessage mark-conversation-read <conversation-id> -i <handle>
inkbox imessage typing <conversation-id> -i <handle>
inkbox imessage upload-media ./photo.jpg -i <handle> --content-type image/jpeg

# Contact rules are scoped to the identity (not a phone number):
inkbox imessage contact-rule list -i <handle>
inkbox imessage contact-rule create -i <handle> --action block --match-target +15559999999
inkbox imessage contact-rule update <rule-id> -i <handle> --action allow|block   # admin-only
inkbox imessage contact-rule delete <rule-id> -i <handle>                   # admin-only
inkbox imessage contact-rule list-all                                       # admin-only, org-wide
```

Group conversation output includes `groupCreationStatus` (`creating`,
`not_created`, or `ready`). A rejected initial creation remains on the same
conversation; send again by conversation id to retry. `react` supports inbound
one-to-one and group messages. Its named choices are `love`, `like`, `dislike`,
`laugh`, `emphasize`, `question`, and `eyes`; arbitrary custom emoji are
inbound-only. Read receipts and typing remain one-to-one only.
Group creation and conversation-id replies accept the same 13 expressive styles
as one-to-one sends, with or without `--media-url`.

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
inkbox mailbox list                              # includes a humanized `storage` column
inkbox mailbox get <email-address>               # includes storageUsedBytes / storageLimitBytes
inkbox mailbox update <email-address> [--filter-mode whitelist|blacklist]
inkbox mailbox client-settings <email-address>   # IMAP/SMTP settings for a mail client
# To attach a webhook receiver, use `inkbox webhook subscription create
# --mailbox-id <id> --url <url> --event-type message.received ...`.
```

`mailbox list` / `get` / `update` rows include `filterMode` and `agentIdentityId`. `mailbox update --filter-mode` is the **deprecated** channel path (admin-only; prints a stderr change note when the value actually changes). Prefer `inkbox identity update <handle> --mail-filter-mode whitelist|blacklist`, which sets the mode on the identity and prints no change note.

### Storage

`mailbox list` shows a `storage` column (`1.2 GiB / 2 GiB`) and `mailbox get` shows `storageUsedBytes` / `storageLimitBytes`. `--json` keeps the raw byte counts; only the table humanizes them. The caps are **binary** (2 GiB is `2 * 1024³` = 2,147,483,648 bytes), so readouts are labeled GiB/MiB — never GB. A `-` limit means the server resolved no cap. Sending from a mailbox at its cap fails with `HTTP 402`; free space with `email delete <message-id> -i <handle>` / `email delete-thread <thread-id> -i <handle>`, or upgrade.

## Mail Clients (IMAP/SMTP)

An inbox can be attached to a regular mail client (Thunderbird, Apple Mail, mutt, …) with the API key you already have — there is no separate credential to create. `inkbox mailbox client-settings <email-address>` prints these:

| Setting | Value |
|---|---|
| IMAP host | `imap.inkboxmail.com` |
| IMAP port | `993` (IMAPS / implicit TLS) |
| SMTP host | `smtp.inkboxmail.com` |
| SMTP port | `465` (SMTPS / implicit TLS) or `587` (STARTTLS) |
| Username | the inbox address (e.g. `sales-agent@inkboxmail.com`) |
| Password | an **identity-scoped** API key (`ApiKey_...`) |

Mint the password with `inkbox api-keys create --label <name> --identity-id <uuid>`. Admin-scoped keys are rejected — one key maps to exactly one mailbox. Revoking the key revokes mail-client access. `client-settings` never prints a password.

Constraints that bite:

- **`From` must be the authenticated inbox address**, and exactly one address — aliases / "send as" are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over SMTP** — the required footer can't be injected without breaking the signature, so the send is refused. Send unsigned, or upgrade.
- Leave "save a copy of sent messages" **on** — Inkbox recognizes the client's copy as the message it already stored, so you get one Sent entry, charged against the storage cap once.

`client-settings` derives the hosts from the configured API base URL; when that URL isn't a recognized Inkbox API host it errors instead of printing hosts it would have to guess. Full walkthrough: https://inkbox.ai/docs/capabilities/email/mail-clients

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

### Mailbox Contact Rules (`inkbox mailbox rules …`) — DEPRECATED

**Deprecated** (Sunset 2026-08-31) — use `inkbox identity mail-rules …` (keyed by agent handle) instead. Per-mailbox allow/block rules (combined with the mailbox's `filterMode`).

```bash
inkbox mailbox rules list --mailbox <email> [--action allow|block] [--match-type exact_email|domain] [--limit <n>] [--offset <n>]
inkbox mailbox rules list --all-mailboxes [--mailbox-id <id>] [--action …] [--match-type …]    # admin-only
inkbox mailbox rules get <rule-id> --mailbox <email>
inkbox mailbox rules create --mailbox <email> --action allow|block --match-type exact_email|domain --match-target <value>
inkbox mailbox rules update <rule-id> --mailbox <email> --action allow|block   # admin-only
inkbox mailbox rules delete <rule-id> --mailbox <email>                                                    # admin-only
```

## Admin-Only Phone Numbers

```bash
inkbox number list
inkbox number get <id>
inkbox number provision --handle <handle> [--type local] [--state NY]   # local only; toll_free is rejected (422)
inkbox number update <id> [--incoming-call-action auto_accept|auto_reject|webhook|hosted_agent] [--filter-mode whitelist|blacklist] ...
inkbox number release <number-id>
```

Use `--state` only when provisioning a local number. Phone-number rows also carry `filterMode` / `agentIdentityId`; `number update --filter-mode` is the **deprecated** channel path (admin-only; prints a stderr note when the value changes). Prefer `inkbox identity update <handle> --phone-filter-mode whitelist|blacklist`.

### Number Contact Rules (`inkbox number rules …`) — DEPRECATED

**Deprecated** (Sunset 2026-08-31) — use `inkbox identity phone-rules …` (keyed by agent handle) instead. Per-number allow/block rules (combined with the number's `filterMode`).

```bash
inkbox number rules list --number <id> [--action allow|block] [--match-type exact_number] [--limit <n>] [--offset <n>]
inkbox number rules list --all-numbers [--phone-number-id <id>] [--action …] [--match-type …]   # admin-only
inkbox number rules get <rule-id> --number <id>
inkbox number rules create --number <id> --action allow|block --match-target <e164> [--match-type exact_number]
inkbox number rules update <rule-id> --number <id> --action allow|block   # admin-only
inkbox number rules delete <rule-id> --number <id>                                                    # admin-only
```

## Contacts

Organization-wide address book with lifecycle review, memory, correspondence, and vCard import/export.

Merging requires an admin-scoped API key. The merge is rejected atomically if
the survivor would exceed 25 active memories; delete unwanted facts and retry.

```bash
inkbox contacts list [--q <query>] [--order name|recent] [--review-status <status>] [--limit <n>] [--offset <n>]  # offset max 10000
inkbox contacts get <contact-id>
inkbox contacts create --json <payload>
inkbox contacts update <contact-id> --json <patch>
inkbox contacts delete <contact-id>
inkbox contacts bulk-delete <contact-id...>
inkbox contacts lookup (--email <email> | --email-contains <s> | --email-domain <d> | --phone <e164> | --phone-contains <s>)
inkbox contacts import <file.vcf>
inkbox contacts export <contact-id> [--out <file>] # vCard 4.0 to stdout or file
inkbox contacts export-many <contact-id...> [--out <file>]
inkbox contacts facts list <contact-id>
inkbox contacts facts get <contact-id> <fact-id>
inkbox contacts facts citation <contact-id> <fact-id> <citation-id>
inkbox contacts facts citation-url <source-url>
inkbox contacts facts delete <contact-id> <fact-id>  # admin only
inkbox contacts correspondence <contact-id> [--identity <uuid>] [--channels <channel>]
inkbox contacts merge <survivor-id> --losing <contact-id...> [--field-sources <json>]  # admin-scoped API key required
inkbox contacts access list <contact-id>             # compatibility read only
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

Each agent identity has its own webhook signing key. Manage it with the
per-identity commands; the org-level `inkbox signing-key create` is deprecated
(with an agent-scoped key it still rotates that identity's key; with an admin key
the server returns 409).

```bash
inkbox whoami
inkbox identity signing-key status <handle>
inkbox identity signing-key rotate <handle>   # mints/rotates; prints the secret ONCE
inkbox signing-key create                     # DEPRECATED — use the per-identity commands above
inkbox webhook verify --payload <payload> --secret <secret> -H "X-Header: value"

# Webhook subscriptions (fan-out per (owner, url, event_types)):
inkbox webhook subscription list [--mailbox-id <id>] [--phone-number-id <id>] [--agent-identity-id <id>]
inkbox webhook subscription create --mailbox-id <id> --url <url> --event-type message.received
inkbox webhook subscription create --phone-number-id <id> --url <url> \
  --event-type text.received --event-type text.delivered
inkbox webhook subscription create --agent-identity-id <id> --url <url> \
  --event-type imessage.received --event-type imessage.reaction_received
inkbox webhook subscription create --agent-identity-id <id> --url <url> \
  --event-type call.ended
# Opt into per-class conversation context on received events (count:N | window:H):
inkbox webhook subscription create --mailbox-id <id> --url <url> \
  --event-type message.received --context-email count:10 --context-texts window:24
inkbox webhook subscription update <sub-id> [--url <url>] [--event-type <type>...] \
  [--context-email <spec>] [--context-texts <spec>] [--context-calls <spec>] [--clear-context]
inkbox webhook subscription delete <sub-id>
```

Every subscription row carries `ownerIdentityId` (the resolved owning agent identity). The **first** subscription created for an identity that has no signing key yet returns that identity's `signingKey` **once** in the create output (otherwise null) — capture it then, it cannot be retrieved again (use `--json` to read it reliably).

The `--context-email` / `--context-texts` / `--context-calls` flags each take `count:N` (1..50) or `window:H` (1..168) and opt a subscription into per-class conversation history delivered under `data.context` on received events. On `update`, a `--context-*` flag replaces the stored config and `--clear-context` removes it (the two are mutually exclusive).

Use `whoami --json` when you need the authenticated caller shape exactly.

`inkbox webhook verify` is event-type-agnostic — it operates on raw
bytes and only checks the `X-Inkbox-Signature` HMAC. The body can be
any of:

- **Mail** (envelope): `message.received`, `message.sent`,
  `message.forwarded`, `message.delivered`, `message.bounced`,
  `message.failed`. Subscribe via `inkbox webhook subscription create
  --mailbox-id ...`. On `message.received`, `data.message` carries the
  plain-text `body` (whole under a size cap, else a prefix with
  `body_truncated: true`); when truncated, fetch the full message by its
  `id` (via the API/SDK) — not `message_id` (the RFC 5322 header).
- **Text** (envelope): `text.received`, `text.sent`, `text.delivered`,
  `text.delivery_failed`, `text.delivery_unconfirmed`. Subscribe via
  `inkbox webhook subscription create --phone-number-id ...`.
- **iMessage** (envelope): `imessage.received`,
  `imessage.reaction_received`, `imessage.sent`, `imessage.delivered`,
  `imessage.delivery_failed`. Subscribe via `inkbox webhook
  subscription create --agent-identity-id ...` — owned by the agent
  identity, since shared iMessage pool numbers are not org resources.
- **Call lifecycle** (envelope, fire-and-forget + replayable):
  `call.ended`. Subscribe via `inkbox webhook subscription create
  --agent-identity-id ...` — owned by the agent identity, like iMessage.
  The payload carries the call (with `mode` / `reason`), resolved
  contacts/identities, an always-present `data.transcript_url`
  (authoritative verbatim), an inline abridged `data.transcript` when
  the platform captured a transcript for the call (otherwise `null`),
  plus `data.outcome` (`completed` | `no_answer` | `declined` |
  `failed`; `null` iff the call was client-driven) and
  `data.post_call_action_items` (open items only, `seq`-ascending).
  Voice AI calls fire `call.ended` on every terminal state, not just
  connected calls. One subscription carries a single channel, so an
  identity sub cannot mix `imessage.*` with `call.ended`.
- **Inbound call** (flat, no envelope; response controls call routing).
  Not subscribable; URL stays on the phone-number resource as
  `incomingCallWebhookUrl` (contrast the replayable `call.ended` above).

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

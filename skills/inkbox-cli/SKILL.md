---
name: inkbox-cli
description: Use when running or writing shell commands with the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email, phone, text/SMS, vault, mailbox, phone number, webhook, or signup workflows.
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

Requires Node.js >= 18.

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
- `phone call`
- `identity delete`
- `email delete`
- `email delete-thread`
- `vault delete`
- `mailbox delete`
- `number release`
- `signing-key create`

Also confirm before creating or rotating secrets if the values were not explicitly provided by the user.

## Agent Signup

For the full self-signup flow and API semantics, read the shared reference:

> **See:** `skills/agent-self-signup/SKILL.md`

CLI commands:

```bash
inkbox signup create
inkbox signup verify --code <code>
inkbox signup resend-verification
inkbox signup status
```

`signup create` is the main command that does not require an API key. The later signup commands authenticate using the signup-issued credentials persisted by the CLI flow.

## Identities

```bash
inkbox identity list
inkbox identity get <handle>
inkbox identity create <handle>
inkbox identity delete <handle>
inkbox identity update <handle> --new-handle <handle>
inkbox identity refresh <handle>
```

Notes:

- Creating an identity creates the agent identity; mailbox creation is handled automatically by the backend flow described in the CLI docs.
- `identity get` and `identity refresh` return mailbox and phone number assignments when present.
- Most email, phone, and text commands require `-i, --identity <handle>`.

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
inkbox phone call -i <handle> --to +15167251294 --ws-url wss://example.com/ws
inkbox phone calls -i <handle> --limit 10 --offset 0
inkbox phone transcripts <call-id> -i <handle>
inkbox phone search-transcripts -i <handle> -q "refund" --party remote
```

Before placing a call, confirm the destination number and websocket URL with the user.

## Text Messages

All text commands are identity-scoped and require `-i <handle>`.

```bash
inkbox text list -i <handle> --limit 20
inkbox text get <text-id> -i <handle>
inkbox text conversations -i <handle> --limit 20
inkbox text conversation <remote-number> -i <handle> --limit 50
inkbox text search -i <handle> -q "invoice"
inkbox text mark-read <text-id> -i <handle>
inkbox text mark-conversation-read <remote-number> -i <handle>
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

## Org-Level Mailboxes

```bash
inkbox mailbox list
inkbox mailbox get <email-address>
inkbox mailbox create -i <handle> [--display-name <name>] [--local-part <part>]
inkbox mailbox update <email-address> [--display-name <name>] [--webhook-url <url>]
inkbox mailbox delete <email-address>
```

## Org-Level Phone Numbers

```bash
inkbox number list
inkbox number get <id>
inkbox number provision --handle <handle> [--type toll_free|local] [--state NY]
inkbox number update <id> [--incoming-call-action auto_accept|auto_reject|webhook] ...
inkbox number release <number-id>
```

Use `--state` only when provisioning a local number.

## Whoami, Signing Keys, Webhooks

```bash
inkbox whoami
inkbox signing-key create
inkbox webhook verify --payload <payload> --secret <secret> -H "X-Header: value"
```

Use `whoami --json` when you need the authenticated caller shape exactly.

## Practical Guidance

- Prefer the local repo command `npm --prefix cli run dev -- ...` when working in this codebase.
- Prefer `--json` for anything that needs stable parsing.
- Use the identity handle, not mailbox address or phone number, for identity-scoped commands.
- If a command fails because the identity lacks a mailbox or phone number, inspect it first with `inkbox identity get <handle>`.

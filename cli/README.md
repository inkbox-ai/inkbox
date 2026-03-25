# @inkbox/cli

Command-line interface for the [Inkbox API](https://inkbox.ai/docs) — email, phone, identities, and encrypted vault for AI agents.

## Install

```bash
npm install -g @inkbox/cli
```

Or run directly with npx:

```bash
npx @inkbox/cli <command>
```

Requires Node.js >= 18.

## Authentication

Set your API key as an environment variable or pass it as a flag:

```bash
export INKBOX_API_KEY="ApiKey_..."
export INKBOX_VAULT_KEY="my-vault-key"    # only needed for vault decrypt/create
```

Get your API key at [console.inkbox.ai](https://console.inkbox.ai/).

## Quick start

```bash
# Create an agent identity
inkbox identity create support-bot

# Create a mailbox for the identity
inkbox mailbox create --handle support-bot

# Send an email
inkbox email send -i support-bot \
  --to customer@example.com \
  --subject "Your order has shipped" \
  --body-text "Tracking number: 1Z999AA10123456784"

# List recent emails
inkbox email list -i support-bot --limit 10

# List all identities (JSON output)
inkbox --json identity list
```

## Commands

### identity

Manage agent identities.

```bash
inkbox identity list                         # List all identities
inkbox identity get <handle>                 # Get identity details
inkbox identity create <handle>              # Create a new identity
inkbox identity delete <handle>              # Delete an identity
inkbox identity update <handle>              # Update an identity
  --new-handle <handle>                      #   New handle
  --status <status>                          #   active or paused
```

### email

Email operations, scoped to an identity. Requires `-i <handle>`.

```bash
inkbox email send -i <handle>                # Send an email
  --to <addresses>                           #   Comma-separated recipients (required)
  --subject <subject>                        #   Email subject (required)
  --body-text <text>                         #   Plain text body
  --body-html <html>                         #   HTML body
  --cc <addresses>                           #   Comma-separated CC
  --bcc <addresses>                          #   Comma-separated BCC
  --in-reply-to <message-id>                 #   Message ID to reply to

inkbox email list -i <handle>                # List emails
  --direction <dir>                          #   Filter: inbound or outbound
  --limit <n>                                #   Max messages (default: 50)

inkbox email get <message-id> -i <handle>    # Get full message with body

inkbox email search -i <handle>              # Search emails
  -q, --query <query>                        #   Search query (required)
  --limit <n>                                #   Max results (default: 50)
```

### phone

Phone operations, scoped to an identity. Requires `-i <handle>`.

```bash
inkbox phone call -i <handle>                # Place an outbound call
  --to <number>                              #   E.164 phone number (required)
  --ws-url <url>                             #   WebSocket URL (wss://) for audio bridging

inkbox phone calls -i <handle>               # List calls
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)

inkbox phone transcripts <call-id> -i <handle>  # Get call transcripts
```

### vault

Encrypted vault operations. `get` and `create` require a vault key.

```bash
inkbox vault info                            # Show vault info
inkbox vault secrets                         # List secrets (metadata only)
  --type <type>                              #   Filter: login, api_key, ssh_key, key_pair, other

inkbox vault get <secret-id>                 # Decrypt a secret (requires vault key)

inkbox vault create                          # Create a secret (requires vault key)
  --name <name>                              #   Secret name (required)
  --type <type>                              #   Secret type (required)
  --description <desc>                       #   Optional description
```

Secret type flags:

```bash
# login
  --username <user> --password <pass> [--url <url>]

# api_key
  --key <key>

# key_pair
  --access-key <key> --secret-key <key>

# ssh_key
  --private-key <key> [--public-key <key>]

# other
  --data <json>
```

### mailbox

Org-level mailbox management.

```bash
inkbox mailbox list                          # List all mailboxes
inkbox mailbox create                        # Create a mailbox
  --handle <handle>                          #   Agent handle (required)
  --display-name <name>                      #   Display name
inkbox mailbox delete <email-address>        # Delete a mailbox
```

### number

Org-level phone number management.

```bash
inkbox number list                           # List all phone numbers
inkbox number provision                      # Provision a new number
  --handle <handle>                          #   Agent handle (required)
  --type <type>                              #   toll_free or local (default: toll_free)
  --state <state>                            #   US state abbreviation (for local)
inkbox number release <number-id>             # Release a phone number
```

## Global options

```
--api-key <key>      Inkbox API key (or set INKBOX_API_KEY)
--vault-key <key>    Vault key for decrypt operations (or set INKBOX_VAULT_KEY)
--base-url <url>     Override API base URL
--json               Output as JSON (default: formatted tables)
```

## License

MIT

# @inkbox/cli

Command-line interface for the [Inkbox API](https://inkbox.ai/docs) — identities, email, phone, and encrypted vault for AI agents.

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

Get your API key at [inkbox.ai/console](https://inkbox.ai/console).

## Quick start

```bash
# Create an agent identity (mailbox is created automatically)
inkbox identity create support-bot

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

### signup

Agent self-signup flow. The `create` command does not require an API key.

```bash
inkbox signup create                             # Register a new agent (no API key needed)
  --human-email <email>                          #   Email of the human to approve (required)
  --note-to-human <note>                         #   Message to human in verification email (required)
  --display-name <name>                          #   Agent display name (optional)
  --agent-handle <handle>                        #   Requested agent handle (optional)
  --email-local-part <local>                     #   Requested mailbox local part (optional)

inkbox signup verify                             # Submit verification code
  --code <code>                                  #   6-digit code from email (required)

inkbox signup resend-verification                # Resend the verification email (5-min cooldown)
                                                 # Returns current organization_id (may change after verify/approval)

inkbox signup status                             # Check claim status and restrictions
```

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
inkbox identity refresh <handle>             # Re-fetch identity from API

inkbox identity create-secret <handle>       # Create a secret scoped to identity (vault key)
  --name <name>                              #   Secret name (required)
  --type <type>                              #   Secret type (required)
  --description <desc>                       #   Optional description
  (same secret type flags as vault create)

inkbox identity get-secret <handle> <secret-id>     # Decrypt a secret (vault key)
inkbox identity delete-secret <handle> <secret-id>  # Delete a secret (vault key)
inkbox identity revoke-access <handle> <secret-id>  # Revoke credential access

inkbox identity assign-mailbox <handle>              # Assign an existing mailbox
  --mailbox-id <id>                            #   Mailbox UUID (required)
inkbox identity unlink-mailbox <handle>              # Unlink mailbox from identity
inkbox identity assign-phone <handle>                # Assign an existing phone number
  --phone-number-id <id>                       #   Phone number UUID (required)
inkbox identity unlink-phone <handle>                # Unlink phone number from identity

inkbox identity set-totp <handle> <secret-id>       # Add TOTP to login (vault key)
  --uri <otpauth-uri>                        #   otpauth:// URI (required)
inkbox identity remove-totp <handle> <secret-id>    # Remove TOTP (vault key)
inkbox identity totp-code <handle> <secret-id>      # Generate TOTP code (vault key)
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

inkbox email unread -i <handle>              # List unread emails
  --direction <dir>                          #   Filter: inbound or outbound
  --limit <n>                                #   Max messages (default: 50)

inkbox email mark-read <ids...> -i <handle>  # Mark messages as read
inkbox email delete <message-id> -i <handle> # Delete a message
inkbox email delete-thread <thread-id> -i <handle>  # Delete a thread
inkbox email star <message-id> -i <handle>   # Star a message
inkbox email unstar <message-id> -i <handle> # Unstar a message
inkbox email thread <thread-id> -i <handle>  # Get thread with all messages
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

inkbox phone search-transcripts -i <handle>  # Search transcripts
  -q, --query <query>                        #   Search query (required)
  --party <party>                            #   Filter: local or remote
  --limit <n>                                #   Max results (default: 50)
```

### text

Text message (SMS/MMS) operations, scoped to an identity. Requires `-i <handle>`.

```bash
inkbox text list -i <handle>                # List text messages
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)
  --unread-only                             #   Show only unread messages

inkbox text get <text-id> -i <handle>       # Get a single text message

inkbox text conversations -i <handle>       # List conversation summaries
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)

inkbox text conversation <remote-number> -i <handle>  # Get messages in a conversation
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)

inkbox text search -i <handle>              # Search text messages
  -q, --query <query>                       #   Search query (required)
  --limit <n>                               #   Max results (default: 50)

inkbox text mark-read <text-id> -i <handle>                # Mark a text as read
inkbox text mark-conversation-read <remote-number> -i <handle>  # Mark conversation as read
```

### vault

Encrypted vault operations. `get`, `create`, and credential listing require a vault key.

```bash
inkbox vault init                            # Initialize vault (creates primary + recovery keys)
  --vault-key <key>                          #   Vault key (or set INKBOX_VAULT_KEY)

inkbox vault info                            # Show vault info
inkbox vault secrets                         # List secrets (metadata only)
  --type <type>                              #   Filter: login, api_key, ssh_key, key_pair, other

inkbox vault get <secret-id>                 # Decrypt a secret (requires vault key)
inkbox vault delete <secret-id>              # Delete a secret

inkbox vault create                          # Create a secret (requires vault key)
  --name <name>                              #   Secret name (required)
  --type <type>                              #   Secret type (required)
  --description <desc>                       #   Optional description

inkbox vault keys                            # List vault keys
  --type <type>                              #   Filter: primary or recovery

inkbox vault grant-access <secret-id>        # Grant identity access to a secret
  -i, --identity <handle>                    #   Agent identity handle (required)
inkbox vault revoke-access <secret-id>       # Revoke identity access to a secret
  -i, --identity <handle>                    #   Agent identity handle (required)
inkbox vault access-list <secret-id>         # List access rules for a secret

inkbox vault logins -i <handle>              # List login credentials (vault key)
inkbox vault api-keys -i <handle>            # List API key credentials (vault key)
inkbox vault ssh-keys -i <handle>            # List SSH key credentials (vault key)
inkbox vault key-pairs -i <handle>           # List key pair credentials (vault key)
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

### mailbox

Org-level mailbox management.

```bash
inkbox mailbox list                          # List all mailboxes
inkbox mailbox get <email-address>           # Get mailbox details
inkbox mailbox create                        # Create a new mailbox
  -i, --identity <handle>                   #   Agent handle (required)
  --display-name <name>                      #   Display name
  --local-part <part>                        #   Requested email local part (random if omitted)
inkbox mailbox update <email-address>        # Update a mailbox
  --display-name <name>                      #   New display name
  --webhook-url <url>                        #   Webhook URL ("" to clear)
inkbox mailbox delete <email-address>        # Delete a mailbox
```

### number

Org-level phone number management.

```bash
inkbox number list                           # List all phone numbers
inkbox number get <id>                       # Get phone number details
inkbox number provision                      # Provision a new number
  --handle <handle>                          #   Agent handle (required)
  --type <type>                              #   toll_free or local (default: toll_free)
  --state <state>                            #   US state abbreviation (for local)
  --incoming-text-webhook-url <url>          #   Webhook URL for incoming texts
inkbox number update <id>                    # Update phone number config
  --incoming-call-action <action>            #   auto_accept, auto_reject, or webhook
  --client-websocket-url <url>               #   WebSocket URL for audio bridging
  --incoming-call-webhook-url <url>          #   Webhook URL for incoming calls
  --incoming-text-webhook-url <url>          #   Webhook URL for incoming texts
inkbox number release <number-id>             # Release a phone number
```

### whoami

Show the authenticated caller's identity.

```bash
inkbox whoami                                # Display caller identity (API key or JWT)
inkbox whoami --json                         # Output as JSON
```

### signing-key

Webhook signing key management.

```bash
inkbox signing-key create                    # Create or rotate signing key
```

### webhook

Webhook utilities.

```bash
inkbox webhook verify                        # Verify a webhook signature (local)
  --payload <payload>                        #   Raw request body (required)
  --secret <secret>                          #   Signing key (required)
  -H, --header <header>                      #   Header in Key: Value format (repeatable)
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

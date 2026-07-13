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

Requires Node.js >= 22.

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
inkbox identity create <handle>              # Provisions identity + mailbox + tunnel atomically
  --display-name <name>                      #   Identity-level display name
  --description <text>                       #   Identity-level free-form description
  --email-local-part <part>                  #   Requested local part (custom-domain only)
  --sending-domain <name>                    #   Bind mailbox to a verified custom domain (bare name)
  --platform-domain                          #   Force the platform sending domain (mutually exclusive)
  --tls-mode <mode>                          #   edge (default) or passthrough — fixed at create time
  --imessage-enabled                         #   Opt the identity into iMessage (default off)
inkbox identity delete <handle>              # Cascades to mailbox + tunnel; revokes scoped API keys
inkbox identity update <handle>              # Update an identity
  --new-handle <handle>                      #   New handle
  --display-name <name>                      #   New display name ("" to clear)
  --description <text>                       #   New description ("" to clear)
  --clear-description                        #   Explicit null (mutually exclusive with --description)
  --status <status>                          #   active or paused
  --imessage-enabled <bool>                  #   Toggle iMessage reachability (true/false)
  --imessage-filter-mode <mode>              #   whitelist or blacklist (admin API key required)
inkbox identity refresh <handle>             # Re-fetch identity from API

inkbox identity create-secret <handle>       # Create a secret scoped to identity (vault key)
  --name <name>                              #   Secret name (required)
  --type <type>                              #   Secret type (required)
  --description <desc>                       #   Optional description
  (same secret type flags as vault create)

inkbox identity get-secret <handle> <secret-id>     # Decrypt a secret (vault key)
inkbox identity delete-secret <handle> <secret-id>  # Delete a secret (vault key)
inkbox identity revoke-access <handle> <secret-id>  # Revoke credential access

inkbox identity release-phone <handle>               # Release phone number back to the carrier

inkbox identity set-totp <handle> <secret-id>       # Add TOTP to login (vault key)
  --uri <otpauth-uri>                        #   otpauth:// URI (required)
inkbox identity remove-totp <handle> <secret-id>    # Remove TOTP (vault key)
inkbox identity totp-code <handle> <secret-id>      # Generate TOTP code (vault key)

inkbox identity access list <target-handle>                   # List who can see an identity
inkbox identity access grant <target-handle> <viewer-handle>  # Grant a viewer identity visibility
inkbox identity access grant-everyone <target-handle>         # Make visible to every active identity (wildcard)
inkbox identity access revoke <target-handle> <viewer-handle> # Revoke a viewer identity's visibility
```

`identity access` controls which other agent identities can see an identity in API responses (humans and admins always see it). Viewer identities are passed as handles and resolved to UUIDs automatically. This is unrelated to `identity revoke-access`, which manages vault-secret access.

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
  --attach <path>                            #   Attach a file (repeatable)
  --inline-image <cid=path>                  #   Embed an image inline as cid:<cid>
                                             #     (repeatable; requires --body-html,
                                             #     image/*; reference it in the HTML
                                             #     as <img src="cid:<cid>">)
  --track-opens                              #   Embed an open-tracking pixel
                                             #     (requires --body-html)

inkbox email reply-all <message-id> -i <handle>  # Reply to everyone on a message
  --subject <subject>                        #   Override subject
  --body-text <text>                         #   Plain text body
  --body-html <html>                         #   HTML body
  --reply-to <address>                       #   Reply-To address
  --attach <path>                            #   Attach a file (repeatable)
  --inline-image <cid=path>                  #   Embed an image inline as cid:<cid>
                                             #     (repeatable; requires --body-html)

inkbox email forward <message-id> -i <handle>    # Forward a message
  --to <addresses>                           #   Comma-separated recipients
  --cc <addresses>                           #   Comma-separated CC
  --bcc <addresses>                          #   Comma-separated BCC
                                             #     (at least one of to/cc/bcc)
  --mode <mode>                              #   'inline' (default) or 'wrapped'
  --subject <subject>                        #   Override subject (default: 'Fwd: ...')
  --body-text <text>                         #   Plain text caller note
  --body-html <html>                         #   HTML caller note
  --no-include-original-attachments          #   Drop originals (inline mode)
  --reply-to <address>                       #   Reply-To for the forward
  --attach <path>                            #   Attach an additional file (repeatable)
  --track-opens                              #   Embed an open-tracking pixel
                                             #     (inline forwards reuse the
                                             #     original's HTML; server 422s
                                             #     if the forward has no HTML)

inkbox email list -i <handle>                # List emails
  --direction <dir>                          #   Filter: inbound or outbound
  --limit <n>                                #   Max messages (default: 50)

inkbox email get <message-id> -i <handle>    # Get full message with body
                                             #   Fetching an inbound message
                                             #   marks it read server-side.

inkbox email search -i <handle>              # Search emails
  -q, --query <query>                        #   Search query (required)
  --limit <n>                                #   Max results (default: 50)

inkbox email unread -i <handle>              # List unread emails
  --direction <dir>                          #   Filter: inbound or outbound
  --limit <n>                                #   Max messages (default: 50)

inkbox email mark-read <ids...> -i <handle>  # Mark messages as read
inkbox email mark-unread <ids...> -i <handle>  # Mark messages as unread
inkbox email download-attachment <message-id> <filename> -i <handle>  # Time-limited download URL
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
  --hosted                                   #   Let Inkbox Voice AI drive the call
                                             #     (requires --reason; conflicts with --ws-url)
  --reason <text>                            #   Voice AI's task brief — what to accomplish

inkbox phone calls -i <handle>               # List calls
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)
                                             #   mode / reason / post_call_action_items
                                             #     ride each call; read them with --json

inkbox phone hangup <call-id> -i <handle>    # Hang up a live call from outside it

inkbox phone transcripts <call-id> -i <handle>  # Get call transcripts

inkbox phone search-transcripts -i <handle>  # Search transcripts
  -q, --query <query>                        #   Search query (required)
  --party <party>                            #   Filter: local or remote
  --limit <n>                                #   Max results (default: 50)

inkbox phone incoming-action [action] -i <handle>  # Get (no action) or set the identity's
                                             #   incoming-call action: auto_accept,
                                             #   auto_reject, webhook, or hosted_agent
                                             #   (hosted_agent needs no URL)
  --ws-url <url>                             #   WebSocket URL (wss://) for audio bridging
  --webhook-url <url>                        #   HTTPS receiver for the webhook action

inkbox phone hosted-agent get -i <handle>    # Show the Inkbox Voice AI config
inkbox phone hosted-agent set -i <handle>    # Set it — full replace: an omitted flag
                                             #   resets that field to the server default
  --voice <voice>                            #   Voice override
  --model <model>                            #   Model override
  --instructions <text>                      #   Per-identity steering prompt
```

### text

Text message (SMS/MMS) operations, scoped to an identity. Requires `-i <handle>`.

**Outbound SMS rules:**

- Allowed only from **local** numbers (not toll-free).
- **100 recipient sends per phone number per rolling 24h** — a 3-recipient group message counts as 3 recipient sends. A single accepted send may push usage past the cap; the next capped send returns `429 sender_rate_limited`.
- A freshly provisioned local number needs **~10-15 minutes** for 10DLC carrier propagation. Check `inkbox number get <id>`: send is gated until `smsStatus` reaches `ready`.
- Recipients must opt in by texting **`START`** to any number in your organization. Unknown recipients fail with `403 recipient_not_opted_in`; opt-outs (`STOP`) return `403 recipient_opted_out`.
- **Beta:** Group MMS and conversation sends are beta. Some carriers may reject group chats or MMS from 10DLC numbers even when the sender is ready and recipients have opted in.

Customer-managed 10DLC brands/campaigns lift the default per-number cap to the carrier-assigned tier. Toll-free SMS sending is still coming soon.

```bash
inkbox text send -i <handle>                # Send an outbound SMS/MMS
  --to <e164[,e164...]>                     #   One recipient or a comma-separated group
  --conversation-id <uuid>                  #   Reply into an existing conversation instead of --to
  --text <body>                             #   Message body
  --media-url <url>                         #   MMS media URL; repeat for multiple

inkbox text list -i <handle>                # List text messages
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)
  --unread-only                             #   Show only unread messages

inkbox text get <text-id> -i <handle>       # Get a single text message

inkbox text conversations -i <handle>       # List conversation summaries
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)
  --include-groups                          #   Include group conversations

inkbox text conversation <conversation-key> -i <handle>  # Remote number or conversation UUID
  --limit <n>                               #   Max results (default: 50)
  --offset <n>                              #   Pagination offset (default: 0)

inkbox text search -i <handle>              # Search text messages
  -q, --query <query>                       #   Search query (required)
  --limit <n>                               #   Max results (default: 50)

inkbox text mark-read <text-id> -i <handle>                     # Mark a text as read
inkbox text mark-conversation-read <conversation-key> -i <handle>  # Mark conversation as read
```

### imessage

iMessage over the shared Inkbox router. Recipients connect first by texting
`connect @<handle>` to the router number; there is no cold outreach.

```bash
inkbox imessage triage-number                # Router number + the command humans text to connect

inkbox imessage send -i <handle>             # Send a message to a connected recipient
  --to <number>                              #   E.164 recipient (mutually exclusive with --conversation-id)
  --conversation-id <id>                     #   Existing conversation UUID to reply into
  --text <text>                              #   Message body
  --media-url <url>                          #   Media URL (at most one)
  --send-style <style>                       #   Expressive send style (e.g. slam, confetti)

inkbox imessage list -i <handle>             # List messages, newest first
  --conversation-id <id>                     #   Narrow to one conversation
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)
  --unread-only                              #   Show only unread messages

inkbox imessage assignments -i <handle>      # List recipients currently connected to the identity
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)

inkbox imessage conversations -i <handle>    # Conversation summaries with previews + unread counts
inkbox imessage conversation <conversation-id> -i <handle>  # Read one conversation's messages

inkbox imessage react <message-id> -i <handle>  # Send a tapback (replaces your previous one)
  --reaction <kind>                          #   love, like, dislike, laugh, emphasize, question
  --part-index <n>                           #   Part of a multi-part message (default: 0)

inkbox imessage mark-conversation-read <conversation-id> -i <handle>  # Send a read receipt
inkbox imessage typing <conversation-id> -i <handle>                  # Show the typing bubble

inkbox imessage upload-media <file> -i <handle>  # Upload a file, get a sendable media URL
  --content-type <type>                      #   MIME type of the file

inkbox imessage contact-rule list -i <handle>    # Allow/block rules for the identity
inkbox imessage contact-rule create -i <handle>  # Add a rule
  --action <action>                          #   'allow' or 'block'
  --match-target <number>                    #   Phone number to match (E.164)
inkbox imessage contact-rule update <rule-id> -i <handle>  # Change action/status (admin key)
inkbox imessage contact-rule delete <rule-id> -i <handle>  # Delete a rule (admin key)
inkbox imessage contact-rule list-all        # Org-wide rule list (admin key)
  --agent-identity-id <id>                   #   Narrow to one identity
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

Org-level mailbox read + update. Mailboxes are provisioned atomically
by `inkbox identity create` and removed by `inkbox identity delete`
(cascade) — there is no standalone create / delete here. `display_name`
has moved to the identity; mailbox PATCH hard-rejects it with a 422.

```bash
inkbox mailbox list                          # List all mailboxes (incl. a 'storage' column)
inkbox mailbox get <email-address>           # Get mailbox details
inkbox mailbox update <email-address>        # Update a mailbox
  --filter-mode <mode>                       #   whitelist or blacklist (admin-only)
inkbox mailbox client-settings <email-address>  # IMAP/SMTP settings for a mail client
# To attach a webhook receiver, use `inkbox webhook subscription create
# --mailbox-id <id> --url <url> --event-type message.received ...`.
```

`mailbox list` shows a `storage` column (`1.2 GiB / 2 GiB`) and `mailbox get`
adds `storageUsedBytes` / `storageLimitBytes` — raw byte counts under `--json`,
humanized in the table. The caps are **binary** (2 GiB is `2 * 1024³` bytes),
so the readouts are labeled GiB/MiB. A `-` limit means the server didn't
resolve a cap.

Sending from a mailbox that is at its cap fails with `HTTP 402` and a hint:
free space with `inkbox email delete <message-id> -i <handle>` / `inkbox email
delete-thread <thread-id> -i <handle>` (reclaim is immediate), or upgrade the
plan. All three send paths (`email send`, `email reply-all`, `email forward`)
are enforced.

### tunnel

Tunnel read + update + sign-csr. Tunnels are provisioned atomically by
`inkbox identity create` and removed by `inkbox identity delete`
(cascade) — there is no standalone create / delete / restore /
rotate-secret surface.

```bash
inkbox tunnel list                                          # List org tunnels
inkbox tunnel get <id-or-handle>                            # By UUID or agent handle
inkbox tunnel update <id>                                   # Edit metadata
  --metadata <json>                                         #   JSON object; "{}" to clear
inkbox tunnel sign-csr <id>                                 # Passthrough cert signing
  --csr <path-or-pem>                                       #   CSR file path OR inline PEM
  --out <path>                                              #   Write cert+chain (default: stdout)
```

### domain

Custom sending-domain management. Registration, DNS, verification, DKIM rotation, and deletion stay in the console; the CLI exposes only the read-and-default surface.

```bash
inkbox domain list                           # List custom sending domains
  --status <status>                          #   Filter by status (e.g. 'verified')
inkbox domain set-default <domain-name>      # Set the org default (admin-scoped API key)
                                             #   Pass the platform domain (e.g. 'inkboxmail.com') to revert
```

### number

Org-level phone number management.

```bash
inkbox number list                           # List all phone numbers
inkbox number get <id>                       # Get phone number details
inkbox number provision                      # Provision a new number
  --handle <handle>                          #   Agent handle (required)
  --type <type>                              #   local (default); toll_free is no longer offered (422)
  --state <state>                            #   US state abbreviation (for local)
inkbox number update <id>                    # Update phone number config
  --incoming-call-action <action>            #   auto_accept, auto_reject, webhook,
                                             #     or hosted_agent (needs no URL)
  --client-websocket-url <url>               #   WebSocket URL for audio bridging
  --incoming-call-webhook-url <url>          #   Webhook URL for incoming calls
inkbox number release <number-id>             # Release a phone number
# To attach a text-webhook receiver, use `inkbox webhook subscription
# create --phone-number-id <id> --url <url> --event-type text.received ...`.
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

inkbox webhook subscription list             # List webhook subscriptions
  --mailbox-id <id>                          #   Filter by owning mailbox id
  --phone-number-id <id>                     #   Filter by owning phone number id
  --agent-identity-id <id>                   #   Filter by owning agent identity id (iMessage / call.ended)
  --url <url>                                #   Filter by destination URL (exact)
  --event-type <type>                        #   Filter by event_type wire value
inkbox webhook subscription get <sub-id>     # Get one subscription
inkbox webhook subscription create           # Create a subscription
  --mailbox-id <id>                          #   Owning mailbox id (exactly one of the
  --phone-number-id <id>                     #     three owner FKs is required)
  --agent-identity-id <id>                   #   Owning agent identity id (iMessage / call.ended events)
  --url <url>                                #   HTTPS destination (required)
  --event-type <type>                        #   Event type (repeatable; ≥1 required)
  --context-email <spec>                     #   Conversation context for the email
                                             #     class: count:N or window:H
  --context-texts <spec>                     #   Same for texts (count:N | window:H)
  --context-calls <spec>                     #   Same for calls (count:N | window:H)
inkbox webhook subscription update <sub-id>  # Update url, event_types, and/or context
  --url <url>                                #   New HTTPS destination
  --event-type <type>                        #   Replacement event-type list (repeatable)
  --context-email <spec>                     #   Replace email context (count:N | window:H)
  --context-texts <spec>                     #   Replace texts context (count:N | window:H)
  --context-calls <spec>                     #   Replace calls context (count:N | window:H)
  --clear-context                            #   Clear all conversation context
                                             #     (mutually exclusive with --context-*)
inkbox webhook subscription delete <sub-id>  # Remove a subscription
```

## Mail clients (IMAP/SMTP)

An Inkbox inbox can also be attached to a regular mail client (Thunderbird,
Apple Mail, mutt, …) with the API key you already have. There is no separate
credential to create. `inkbox mailbox client-settings <email-address>` prints
these:

| Setting | Value |
|---|---|
| IMAP host | `imap.inkboxmail.com` |
| IMAP port | `993` (IMAPS / implicit TLS) |
| SMTP host | `smtp.inkboxmail.com` |
| SMTP port | `465` (SMTPS / implicit TLS) or `587` (STARTTLS) |
| Username | the inbox address (e.g. `sales-bot@inkboxmail.com`) |
| Password | an **identity-scoped** API key (`ApiKey_...`) |

Mint the password with `inkbox api-keys create --label <name> --identity-id
<uuid>`. Admin-scoped keys are rejected: one key maps to exactly one mailbox.
Revoking the key revokes mail-client access.

Two constraints that bite in practice:

- **`From` must be the authenticated inbox address**, and exactly one address.
  Aliases and "send as" identities are rejected.
- **On the Free plan, signed/encrypted mail (S/MIME, PGP) cannot be sent over
  SMTP.** The required footer can't be injected without breaking the signature,
  so the send is refused. Send unsigned, or upgrade the plan.

If your client saves its own copy of sent messages, leave that setting on:
Inkbox recognizes the copy as the message it already stored, so you get one
Sent entry, charged against your storage cap once.

`mailbox client-settings` derives the hosts from the configured API base URL.
When that URL isn't a recognized Inkbox API host, it errors instead of printing
hosts it would have to guess — a mail client pointed at guessed hosts would talk
to the wrong server.

Full setup walkthrough:
<https://inkbox.ai/docs/capabilities/email/mail-clients>

## Global options

```
--api-key <key>      Inkbox API key (or set INKBOX_API_KEY)
--vault-key <key>    Vault key for decrypt operations (or set INKBOX_VAULT_KEY)
--base-url <url>     Override API base URL
--json               Output as JSON (default: formatted tables)
```

## License

MIT

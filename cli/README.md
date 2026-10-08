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

## Companion mode

Companion mode is off by default, separate from whitelist/blacklist settings.
Eligibility requires active exact email, number, or Slack-account allow rules covering both
directions, either one Both rule or two applicable one-way allows. It is per
normalized identifier and channel; phone and iMessage share one policy. Domain
allowances, default access, contact visibility, and access borrowed from another
Companion conversation do not qualify. Multiple senders may qualify; the first
qualifying group message activates the conversation, without repeated
initialization when another eligible sender messages. Mere participation is
insufficient. Configuration does not add permissions or SMS consent; blocks
remain authoritative.

```bash
inkbox --json identity companion get example-agent
# Administrator credentials are required for both writes.
inkbox identity mail-rules create example-agent \
  --action allow --match-type exact_email --match-target trusted@example.com --direction both
inkbox --json identity companion update example-agent --enabled true
# trusted@example.com sends "Please join this conversation" to the group.
inkbox --json identity companion conversations example-agent --channel mail --limit 50 --offset 0
inkbox --json identity companion history example-agent 22222222-2222-4222-8222-222222222222 --limit 100
inkbox --json identity companion history example-agent 22222222-2222-4222-8222-222222222222 --cursor opaque-cursor
inkbox --json identity companion initialization example-agent 22222222-2222-4222-8222-222222222222 --max-bytes 8388608
inkbox --json identity companion update example-agent --enabled false
```

Administrator and claimed-agent reads return enabled state, revision, readiness,
and optional notices. Updates require `--enabled true|false`; unknown options are
rejected. Enabling is allowed before any eligible sender or channel resource
exists. Per-channel readiness reports prerequisites independently of enabled
state, including `bidirectional_allow_required` when no exact bidirectional allow
exists. Revision changes only when enabled changes; turning off and on requires a
fresh qualifying message. Continued access depends on the actual trigger sender's
permissions and membership, without transferring to another eligible participant.

`state` aliases `conversations`. State pages retain `items`/`total`, while
history JSON retains `historyComplete`, `nextCursor`, `replyContext`, and notices.
Pages support limits 1-200; conversation offsets are 0-10,000.

`initialization` loads all pages, deduplicates messages, validates scope and
cursor progress, and revalidates permission before returning one combined
`text` plus ordered `entries` and canonical reply context. Default bounds are
8 MiB of fetched-page and transcript UTF-8 bytes and 1,000 pages; use
`--max-bytes`/`--max-pages` for your host's capacity. Exceeding a bound fails
before output; it never truncates. For lossless streaming use `history` pages.

Persist a conversation/activation checkpoint before passing the combined text
to a host once. Buffer live traffic until initialization completes, retain reply
context per turn, and reconcile uncertain host acceptance on recovery. Historical
commands are data, not fresh commands. Replies must use the existing stored mail
parent or canonical phone/iMessage conversation, never a private last-sender
address. Ordinary-phase events have no activation authority.

Notices keep the normal stderr behavior; `--json --with-response-metadata`
opts into one stdout envelope. HTTP errors remain nonzero exits with no partial
stdout. Reply readiness remains separate from read access, including existing
SMS consent and dedicated-line group iMessage requirements. MMS chats with the
same participants represent one logical conversation.

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

# List identities visible to this credential (JSON output)
inkbox --json identity list
```

With `--json`, successful output is written to stdout. API errors are written as
one JSON object to stderr with `error.type`, `error.message`, `error.statusCode`,
`error.detail`, `error.retryAfterSeconds`, and `error.agentSupport`.

## Response notices

Advisory notices are printed to stderr without changing ordinary stdout. With
`--json`, successful stdout keeps its existing shape and notices appear in one
`{"notices": [...]}` stderr record. Each notice has string `code`, `level`, and
`message` fields; unfamiliar codes and levels are preserved.

For finite structured commands, opt into a single result document:

```bash
inkbox --json --with-response-metadata identity phone-rules list support-bot
```

The result is `{"data": <original result>, "notices": [...]}`. Notices are omitted
when absent and empty success uses `"data": null`. Identical notices from internal
lookups or pagination appear once. Errors keep the existing stderr error envelope
and nonzero exit status, with optional top-level `notices` and unchanged
`error.agentSupport` guidance.

`--with-response-metadata` requires `--json`. Raw certificate stdout from
`tunnel sign-csr` rejects it before making requests; use `--out` for a structured
file result. File downloads retain their existing bytes and structured status
output. Notices never authorize an operation or cause a retry.

## Directional contact rules

Requires CLI `0.7.3` or later.

All identity mail/phone rules, deprecated mailbox/number rules, and iMessage
contact-rule commands accept `--direction inbound|outbound|both` on create,
update, and list operations. Inbound is communication from the counterparty to
the agent; outbound is communication from the agent to the counterparty.

```bash
inkbox identity update support-bot \
  --mail-inbound-filter-mode blacklist --mail-outbound-filter-mode whitelist
inkbox identity mail-rules create support-bot \
  --action allow --match-type exact_email --match-target x@example.com \
  --direction outbound
inkbox identity mail-rules update support-bot RULE_ID \
  --action block --apply-to outbound
```

Omitting create direction means Both; omitting update direction preserves it.
Updates accept action, direction, or both. `--apply-to inbound|outbound` requires
`--action`, excludes `--direction`, and atomically preserves the opposite side.
List filters for inbound/outbound include Both rules; `both` is exact. A2A's
existing exact-direction behavior is unchanged. Compatible rules can consolidate,
so a successful create may return an existing ID. Trust the returned rule.

Identity update also accepts `--phone-inbound-filter-mode` and
`--phone-outbound-filter-mode`. Existing shared mode flags set both directions;
do not combine shared and directional flags for the same channel. Identity
details expose both effective modes. Phone modes also apply to iMessage.

`contacts access set --file` accepts `inboundContactable` and
`outboundContactable` lists inside email/phone groups:

```json
{"email":{"inboundContactable":["x@example.com"],"outboundContactable":[]}}
```

Legacy `contactable` reads mean outbound; writes still affect both directions.
Omitted lists preserve state and empty lists block current addresses on the named
side. Mixing legacy and directional lists in one group, or supplying null, is
invalid. Communication-policy files also accept address `direction` and
`expectedInboundAction`/`expectedOutboundAction` concurrency checks. A one-way
edit requires only the matching directional guard; Both requires both when
`expectedAction` is omitted.

`contacts permissions set --file` also accepts `inboundEmails`, `outboundEmails`,
`inboundPhones`, and `outboundPhones` boolean maps. Each map may contain up to 50
addresses. Shared `emails`/`phones` maps cannot be combined with directional maps
for the same channel, and null is invalid. These maps also work in the initial
`permissions` of a `contacts create --json` payload. The alternative initial
`permissions.addresses` form accepts up to 200 directional decisions, while the
contact remains limited to 50 email and 50 phone identifiers.

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
  --harness <harness>                            #   Runtime name for matching plugin guidance (optional)
  --invitation-prompt                            #   Prompt privately for an invitation link or token
  --invitation-stdin                             #   Read an invitation link or token from stdin
                                                  #   Or set INKBOX_A2A_INVITATION
                                                  #   Token-named flags/env remain aliases

inkbox signup verify                             # Submit verification code
  --code <code>                                  #   6-digit code from email (required)

inkbox signup resend-verification                # Resend the verification email (5-min cooldown)
                                                 # Returns current organization_id (may change after verify/approval)

inkbox signup status                             # Check claim status and restrictions
```

### identity

Manage agent identities.

```bash
inkbox identity list                         # Agent-scoped credentials return only themselves
inkbox identity get <handle>                 # Get identity details
inkbox a2a directory                         # Discover organization peers
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

inkbox email drafts create -i <handle>        # Create an incomplete draft; prints generation
  --to <addresses>                            #   Optional comma-separated recipients
  --subject <subject>                         #   Optional subject
  --body-text <text>                          #   Optional plain text body
  --attach <path>                             #   Attach a file (repeatable)
  --idempotency-key <key>                     #   Reuse with identical args for one logical create
inkbox email drafts list -i <handle>          # List drafts with current generations
inkbox email drafts get <draft-id> -i <handle> # Get bodies and attachment metadata
inkbox email drafts update <draft-id> -i <handle> --generation <n>
  --subject <subject>                         #   Set a field
  --clear-subject                             #   Send explicit null to clear it
  --clear-recipients                          #   Clear To, CC, and BCC
inkbox email drafts duplicate <draft-id> -i <handle> --generation <n>
inkbox email drafts delete <draft-id> -i <handle> --generation <n>
inkbox email drafts send <draft-id> -i <handle> --generation <n>
inkbox email drafts attachment add <draft-id> -i <handle> --generation <n> --attach <path>
inkbox email drafts attachment remove <draft-id> <part-index> -i <handle> --generation <n>
inkbox email drafts attachment download <draft-id> <part-index> -i <handle> --generation <n> --output <path>

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

Use the generation printed by the latest `create`, `list`, `get`, or mutation
for the next mutation. Attachment part indexes belong to that same generation;
refresh with `get` after an edit. Drafts share the standard mailbox Drafts
folder, so connected mail clients and the CLI see each other's edits.

A successful `drafts send` prints the sent message and removes the draft. An
exact-generation retry may return the same sent message. On HTTP 409, refresh
for `draft_generation_conflict` and retry the same draft ID and generation for
`draft_send_in_progress`. Do not resend `draft_delivery_uncertain`; after
checking sent mail, duplicate or delete that draft instead.

### phone

Phone operations require `-i <handle>`, except the organization-scoped
`phone hosted-agent voices` catalog.

Phone number details from `inkbox identity get <handle>` and
`inkbox identity refresh <handle>` include `phoneCountry` (an ISO 3166-1 alpha-2
code such as `US` or `GB`) and `phoneState` (null when not applicable).
Older phone responses without a country code are reported as `US`.

```bash
inkbox phone call -i <handle>                # Place an outbound call
  --to <number>                              #   E.164 phone number (required)
  --ws-url <url>                             #   WebSocket URL (wss://) for audio bridging
  --hosted                                   #   Let Inkbox Voice AI drive the call
                                             #     (requires --reason; conflicts with --ws-url)
  --reason <text>                            #   Voice AI's task brief — what to accomplish
  --authority-mode <mode>                    #   Optional contact_scoped or yolo override;
                                             #     omit to inherit the saved Voice AI authority
  --on-voicemail <action>                    #   leave_message, hang_up, or ignore; omit for the
                                             #     default (leave_message with --hosted, else hang_up)
  --voicemail-message <text>                 #   What Voice AI says on the voicemail
                                             #     (requires --on-voicemail leave_message)
  --no-voicemail-detection                   #   Deprecated; same as --on-voicemail ignore
  --origination <origin>                     #   dedicated_number (default) or
                                             #     shared_imessage_number or
                                             #     dedicated_imessage_number

inkbox phone calls -i <handle>               # List calls
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)
                                             #   mode / reason / post_call_action_items
                                             #     ride each call; read them with --json

inkbox phone hangup <call-id> -i <handle>    # Hang up a live call from outside it

inkbox phone transcripts <call-id> -i <handle>  # Get call transcripts

inkbox phone tool-activity <call-id> -i <handle> # List paginated Voice AI tool activity
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)

inkbox phone search-transcripts -i <handle>  # Search transcripts
  -q, --query <query>                        #   Search query (required)
  --party <party>                            #   Filter: local or remote
  --limit <n>                                #   Max results (default: 50)

inkbox phone incoming-action [action] -i <handle>  # Get (no action) or set the identity's
                                             #   incoming-call action: auto_accept,
                                             #   auto_reject, webhook, hosted_agent,
                                             #   or forward
  --ws-url <url>                             #   WebSocket URL (wss://) for audio bridging
  --webhook-url <url>                        #   HTTPS receiver for the webhook action
  --forward-to-phone <number>                #   Complete E.164 forwarding target
  --forward-to-sip <uri>                     #   SIP target with a public DNS hostname

inkbox phone hosted-agent voices            # Organization's voice catalog; no -i needed
inkbox phone hosted-agent voices --json     # Complete { voices, defaultVoice } catalog
inkbox phone hosted-agent get -i <handle>    # Show the Inkbox Voice AI config
inkbox phone hosted-agent set -i <handle>    # Set it — full replace: an omitted flag
                                             #   resets that field to the server default
  --voice <voice>                            #   Voice override
  --model <model>                            #   Deprecated; accepted but ignored
  --instructions <text>                      #   Per-identity steering prompt

inkbox phone hosted-agent authority-mode yolo -i <handle>  # Saved inbound/outbound default; admin API key
```

Voice catalog entries include `id`, `name`, `description`, `available`, and
optional `previewUrl`. Unavailable entries remain visible; select an available
voice's ID with `hosted-agent set --voice`. The catalog's `defaultVoice` is
returned alongside the entries in JSON output. Config setters are a full
replacement: read the current config first and include its existing
`--instructions` when changing only the voice.

Shared origination uses the identity's active iMessage-line assignment and
does not require a dedicated phone number. The recipient must already have a
shared iMessage connection to the identity; otherwise the call fails with
`409 no_shared_connection`.

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

iMessage over shared service or a dedicated line. Shared-service recipients
connect first; dedicated identities may initiate one-to-one or group
conversations.

Dedicated lines can also receive one-to-one messages from non-phone sender
addresses, such as `sender@example.com`. Read responses and `imessage.received`
webhooks preserve the address as a string; do not normalize it into a phone number
or assume every received message can be answered. These conversations are
**receive-only**: sending messages, reactions, typing indicators, or read receipts
returns HTTP `422` with `recipient_not_e164`. Outbound `to` recipients must still
be E.164 phone numbers. Reading message history does not send a read receipt.

```bash
inkbox imessage triage-number                # Router number + the command humans text to connect

inkbox imessage send -i <handle>             # Send or reply
  --to <numbers>                             #   One E.164 recipient or a comma-separated group
  --conversation-id <id>                     #   Existing conversation UUID to reply into
  --text <text>                              #   Message body
  --media-url <url>                          #   Media URL (at most one)
  --send-style <style>                       #   Expressive style for 1:1 or group sends

inkbox imessage list -i <handle>             # List messages, newest first
  --conversation-id <id>                     #   Narrow to one conversation
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)
  --unread-only                              #   Show only unread messages
  --include-groups                           #   Include group messages

inkbox imessage assignments -i <handle>      # List recipients currently connected to the identity
  --limit <n>                                #   Max results (default: 50)
  --offset <n>                               #   Pagination offset (default: 0)

inkbox imessage conversations -i <handle>    # Conversation summaries with previews + unread counts
  --include-groups                           #   Include group conversations
inkbox imessage conversation <conversation-id> -i <handle>  # Read one conversation's messages

inkbox imessage react <message-id> -i <handle>  # React to an inbound 1:1 or group message
  --reaction <kind>                          #   love, like, dislike, laugh, emphasize, question, eyes
  --part-index <n>                           #   Part of a multi-part message (default: 0)

inkbox imessage unreact <reaction-id> -i <handle>  # Take back a tapback this identity sent

inkbox imessage mark-conversation-read <conversation-id> -i <handle>  # One-to-one only
inkbox imessage typing <conversation-id> -i <handle>                  # One-to-one only

inkbox imessage upload-media <file> -i <handle>  # Upload a file, get a sendable media URL
  --content-type <type>                      #   MIME type of the file

inkbox imessage contact-rule list -i <handle>    # Allow/block rules for the identity
inkbox imessage contact-rule create -i <handle>  # Add a rule
  --action <action>                          #   'allow' or 'block'
  --match-target <number>                    #   Phone number to match (E.164)
inkbox imessage contact-rule update <rule-id> -i <handle> --action allow|block
inkbox imessage contact-rule delete <rule-id> -i <handle>  # Delete a rule (admin key)
inkbox imessage contact-rule list-all        # Org-wide rule list (admin key)
  --agent-identity-id <id>                   #   Narrow to one identity
```

The same 13 expressive styles work on group creation and conversation-id
replies, including sends with `--media-url`:

```bash
inkbox imessage send -i <handle> --to +15551234567,+15557654321 --text "Hello group" --media-url https://example.com/group-photo.jpg --send-style confetti
inkbox imessage send -i <handle> --conversation-id <group-conversation-id> --text "Follow-up" --media-url https://example.com/follow-up.jpg --send-style lasers
```

Group conversation rows expose `groupCreationStatus` as `creating`,
`not_created`, or `ready`. A rejected initial creation stays on the same local
conversation; send again with its conversation id to retry. Successful retry
changes the status to `ready`.

### a2a

```bash
# Admin-scoped API key: create, inspect, list, and revoke invitations.
inkbox a2a invites create --peer-agent-handle support billing \
  --recipient-email customer@example.test
inkbox a2a invites list --status pending
inkbox a2a invites show <invitation-id>
inkbox a2a invites revoke <invitation-id>

# No API key is required to preview an invitation.
inkbox a2a invites preview

# Claimed agent key only. The default prompt hides input; automation can set
# INKBOX_A2A_INVITATION or pipe the link/token with --invitation-stdin.
inkbox a2a invites accept
printf '%s' "$INKBOX_A2A_INVITATION" | inkbox a2a invites accept --invitation-stdin

# Receiver setup and advertised capabilities
inkbox a2a enable -i researcher
inkbox a2a settings -i researcher
inkbox a2a publicly-discoverable true -i researcher
inkbox a2a public-egress true -i researcher
inkbox a2a card -i researcher
inkbox a2a skills set -i researcher --file skills.json

# Search enabled agents. Organization scope is the default.
inkbox a2a directory --query support
inkbox a2a directory --public --query research --limit 25

# Bilateral admission for coordinator -> researcher calls
inkbox a2a rules add -i coordinator --handle researcher \
  --action allow --direction outbound
inkbox a2a rules add -i researcher --handle coordinator \
  --action allow --direction inbound

# Unified task history. Omit --direction for the receiver inbox.
inkbox a2a tasks -i coordinator --direction both \
  --requester coordinator --worker researcher \
  --state working --query "quarterly report" --limit 25

# Search individual messages with task and participant provenance.
inkbox a2a messages -i coordinator --direction outbound \
  --worker researcher --role agent --query revenue --limit 25 --json

# Continue a cursor page with the same filters.
inkbox a2a messages -i coordinator --direction outbound \
  --worker researcher --role agent --query revenue \
  --cursor '<nextCursor>' --limit 25 --json

# The outbound alias lists only work requested by the identity.
inkbox a2a sent -i coordinator --worker researcher
inkbox a2a sent-task <task-id> -i coordinator

# List, inspect, and rename shared contexts. New contexts start as
# "New A2A Session"; that exact default may be named from the first message.
inkbox a2a contexts -i coordinator --direction both
inkbox a2a context <context-id> -i researcher
inkbox a2a sent-contexts -i coordinator
inkbox a2a sent-context <context-id> -i coordinator
inkbox a2a rename-context <context-id> -i coordinator \
  --name "Quarterly Research Review"

# A context without a task starts a sibling task. Existing tasks continue
# independently when --task is supplied.
inkbox a2a call https://example.test/a2a/researcher/card \
  -i coordinator --context <context-id> --text "Review the findings"

# A worker can request more input or finish a task.
inkbox a2a reply <task-id> -i researcher --ask --text "Which quarter?"
inkbox a2a reply <task-id> -i researcher --complete --text "Done."
```

JSON list output contains both `items` and `nextCursor`. Human-readable output
prints a next-cursor hint when another page exists. Keyword search covers
string and numeric content values from `text` and `data` parts, excludes
metadata, and returns newest-first results rather than relevance ranking.
`--role` selects the message author (`caller` or `agent`), independent of task
direction. Task detail exposes messages and current state. A protocol call must
pass both the requester identity's outbound policy and the worker identity's
inbound policy. Contact-rule directions are `inbound`, `outbound`, and `both`.
Context-level requester and worker identify the original opener and recipient;
each task identifies its own direction, and tasks in both directions can run
concurrently. Cross-endpoint context reuse is supported between Inkbox
identities; external A2A services may behave differently.

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

Import historical mail from an MBOX or EML file, or a ZIP holding either (a
Gmail Takeout ZIP imports as-is; ZIP entries that are not mail, including nested
archives, are ignored):

```bash
inkbox mailbox imports run <email> <file>
  --source-format <auto|mbox|eml|zip>       # Default: auto
  --original-address <email>                # Repeatable; identifies sent mail
  --mark-unread                             # Default imports as read
  --no-wait                                 # Return after queueing
  --timeout <seconds>                       # Local wait timeout; does not cancel
  --poll-interval <seconds>                 # Default: 5

inkbox mailbox imports get <email> <job-id>
inkbox mailbox imports list <email> [--cursor <cursor>] [--limit <n>]
inkbox mailbox imports wait <email> <job-id> [--timeout <seconds>] [--poll-interval <seconds>]
inkbox mailbox imports cancel <email> <job-id>
```

`run` uploads from disk without loading the full file into memory. Upload and
processing progress goes to stderr; `--json` keeps stdout to one job object.
`run` and `wait` exit nonzero when the terminal job is failed or cancelled.
Unsafe imported content may be rejected and counted separately. Processing
counters are cumulative and never go backwards, but they can sit unchanged while
a large message is processed and are not a percentage. Jobs run one at a time
per organization and share overall import capacity, so a long `queued` stretch
is normal rather than a stall.

Upload targets expire after 5 minutes, so `run` re-issues one and retries once
after a transport failure or rejected upload target, then cancels the job it
created rather than leaving the mailbox blocked. If a `run` is interrupted,
`inkbox mailbox imports list <email>`
and `inkbox mailbox imports cancel <email> <job-id>` release the mailbox; an
abandoned job otherwise holds it for 24 hours. Other limits: 1 GiB per upload,
50 MiB per message, 100,000 messages and 20 `--original-address` values per job,
65,000 entries per ZIP, and 20 import jobs per organization per 24 hours.

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
# --agent-identity-id <id> --url <url> --event-type message.received ...`.
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

### contacts

Organization-wide contacts, correspondence, and memory facts.

Correspondence selects all five channels by default. Use `--channels slack` for
retained messages authored by the contact's saved Slack accounts.

```bash
inkbox contacts list [--review-status <status>] [--offset <n>]  # Offset max: 10000
inkbox contacts get <contact-id>
inkbox contacts facts list <contact-id> [--include-expired]
inkbox contacts facts get <contact-id> <fact-id>
inkbox contacts facts citation <contact-id> <fact-id> <citation-id>
inkbox contacts facts citation-url <source-url>
inkbox contacts facts create <contact-id> --content <text> --kind <kind>  # Admin-scoped API key required
inkbox contacts facts update <contact-id> <fact-id> [--content <text>] [--kind <kind>]  # Admin-scoped API key required
inkbox contacts facts delete <contact-id> <fact-id>  # Admin-scoped API key required
inkbox contacts correspondence <contact-id> [-i <identity-id>]
  [--channels <channel>] [--after <datetime>] [--before <datetime>]
  [--limit-per-channel <n>] [--content <mode>] [--transcripts <mode>]
inkbox contacts merge <survivor-id> --losing <contact-id...>  # Admin-scoped API key required
  [--field-sources '{"preferredName":"<contact-id>"}']
inkbox contacts create --json <payload>
inkbox contacts update <contact-id> --json <patch>
inkbox contacts delete <contact-id>
inkbox contacts bulk-delete <contact-id...>
inkbox contacts import <file.vcf>
inkbox contacts export-many <contact-id...> [--out <file>]
inkbox contacts access list <contact-id>              # Compatibility read only
inkbox contacts access get <handle> <contact-id>
inkbox contacts access set <handle> <contact-id> --file <access.json>
inkbox contacts permissions get <handle> <contact-id>
inkbox contacts permissions set <handle> <contact-id> --file <permissions.json>
inkbox contacts communication-policy get <contact-id> [--identity-id <uuid>]
inkbox contacts communication-policy set <contact-id> --file <policy.json>
inkbox contacts communication-policy preview <contact-id> <identity-id>
inkbox contacts communication-policy list <handle>
inkbox contacts communication-policy list-management <handle>
inkbox identity contact-policies <handle>
```

Active memories have per-kind and contact-wide limits. A merge is rejected
atomically when either would be exceeded. Delete a fact from each kind named by
the error, or any active fact when it names `total`, then retry. Untyped memories
recorded before kinds existed count toward the total.

A fact's `kind` is `profile` (who the contact is), `preference` (a standing
instruction), or `context` (a live situation). Unlocked context facts recorded
by extraction carry an `expiresAt` and drop out of `facts list` once it passes;
locked facts remain active. Pass `--include-expired` to see expired facts.
Hand-written facts never expire. Any update makes a fact manually maintained,
clears its expiry, and revives it if needed. Changing content also removes its
confidence and source links; changing only the kind preserves them.

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
# create --agent-identity-id <id> --url <url> --event-type text.received ...`.
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
  --mailbox-id <id>                          #   Deprecated mailbox-identity mail filter
  --phone-number-id <id>                     #   Deprecated phone-identity text filter
  --agent-identity-id <id>                    #   Filter by owning agent identity id
  --scope identity                          #   Include all families and mixed subscriptions
  --url <url>                                #   Filter by destination URL (exact)
  --event-type <type>                        #   Filter by event_type wire value
inkbox webhook subscription get <sub-id>     # Get one subscription
inkbox webhook subscription create           # Create a subscription
  --mailbox-id <id>                          #   Deprecated mailbox selector (exactly one
  --phone-number-id <id>                     #     identity/resource selector is required)
  --agent-identity-id <id>                   #   Owning agent identity id (all notification events)
  --url <url>                                #   HTTPS destination (required)
  --event-type <type>                        #   Event type (repeatable; ≥1 required)
  --context-email <spec>                     #   Conversation context for the email
                                             #     class: count:N or window:H
  --context-texts <spec>                     #   Same for texts (count:N | window:H)
  --context-calls <spec>                     #   Same for calls (count:N | window:H)
  --auth-token-stdin                         #   Read the delivery bearer token from
                                             #     stdin (never passed as an argument).
                                             #     Reads return the token; list tables
                                             #     show only hasAuthToken
inkbox webhook subscription update <sub-id> --scope identity  # Update url, event_types, context, and/or auth token
  --url <url>                                #   New HTTPS destination
  --event-type <type>                        #   Replacement event-type list (repeatable)
  --context-email <spec>                     #   Replace email context (count:N | window:H)
  --context-texts <spec>                     #   Replace texts context (count:N | window:H)
  --context-calls <spec>                     #   Replace calls context (count:N | window:H)
  --clear-context                            #   Clear all conversation context
                                             #     (mutually exclusive with --context-*)
  --auth-token-stdin                         #   Replace the bearer token, read from stdin
  --clear-auth-token                         #   Clear the delivery bearer token
                                             #     (mutually exclusive with
                                             #     --auth-token-stdin)
inkbox webhook subscription delete <sub-id> --scope identity  # Remove a subscription
```

### Identity-owned notification subscriptions

Mixed subscriptions and explicit identity-wide lists require SDK/CLI **0.7.8 or
later** and `supports_identity_subscriptions: true` from `GET /webhooks/catalog`.
Until available, keep separate channel subscriptions using mailbox, phone, and
identity selectors without explicit scope. Explicit identity scope checks the
catalog once per list call and fails clearly when unsupported; omitted scope adds
no request. The mixed-event examples below assume the capability is available.

Combine notification families on one identity, including channels not yet configured:

```bash
inkbox webhook subscription create --agent-identity-id <id> --url https://example.com/events \
  --event-type message.received --event-type text.received --event-type imessage.received \
  --event-type call.ended --event-type a2a.task.created
inkbox webhook subscription update <sub-id> --scope identity --event-type message.received
inkbox webhook subscription delete <sub-id> --scope identity
```

Update replaces the full event selection. Legacy mailbox and phone selectors resolve
to their identity;
prefer `--agent-identity-id`. Incoming-call actions remain separate. Delivery output
includes replayability and any unavailable reason,
while retaining the original target ID.

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

## Proxies

The CLI honors `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` automatically on every supported Node version — no `NODE_USE_ENV_PROXY` needed. Set `NODE_USE_ENV_PROXY=0` to opt out.

## Custom email signatures

Custom signatures are saved per mailbox and require an eligible paid plan to set or enable.
Each HTML/text field supports up to 16,384 characters. HTML is sanitized; logos
must use absolute HTTPS URLs. Updating HTML without text generates a plain-text
fallback. Omitted fields stay unchanged; null clears saved content. If saved text
is null, sending derives it from HTML when possible. Disable without deleting to
pause automatic insertion. Disabling and clearing remain available on every plan.
Signatures are inserted when mail is sent, including replies, forwards, and sent
drafts; do not append them manually. The Inkbox watermark is controlled separately.
Signed/encrypted SMTP mail cannot have a custom signature inserted; disable
automatic insertion before sending those messages.
A `.sig` file is not a standardized attachment format: read its UTF-8 text or HTML
content into the corresponding field; images and proprietary formats are not imported.

```bash
inkbox mailbox update alex@example.com --signature-html-file signature.html --signature-enabled
inkbox mailbox update alex@example.com --signature-text-file signature.sig
inkbox mailbox update alex@example.com --no-signature-enabled
inkbox mailbox update alex@example.com --clear-signature-html --clear-signature-text
inkbox mailbox get alex@example.com --json
```

Inline content uses `--signature-html <html>` or `--signature-text <text>`.
For each format, choose inline content, a file, or its clear flag, not more than one.

## Message request retries

`email send`, `text send`, and `imessage send` automatically preserve a generated
key during bounded request retries. Use `--idempotency-key <key>` to retry the
same message across separate command invocations. Do not change its input.
Use `send-lookup --help` to recover an original message ID without sending again.
Queued success is not delivery confirmation; use the message's get command for
current status. A queued response is acceptance, not a promise of delivery retries.
Send failures include the request key in stderr (`error.idempotencyKey` with `--json`).
Read an iMessage with `imessage get <message-id> --identity <handle>`.

## Slack

```bash
inkbox slack connection list --identity example-agent
# Select the intended workspace with status connected from the returned connections.
inkbox slack message send --connection-id 11111111-1111-4111-8111-111111111111 \
  --conversation-id CEXAMPLE --text 'Hello from Inkbox' --idempotency-key greeting:2026-09-16
inkbox slack message list --connection-id 11111111-1111-4111-8111-111111111111 \
  --conversation-id CEXAMPLE --limit 15
inkbox slack file download FEXAMPLE --connection-id 11111111-1111-4111-8111-111111111111 \
  --output example.bin
```

Onboarding is separate from using an existing connection. Organization-member sessions,
organization admin API keys, and claimed agent keys can save and list setup workspaces.
Claimed agent keys can prepare and install only their own identity’s app. Save both
app-configuration tokens for the target workspace, then prepare the identity’s app:

```bash
# credentials.json contains access_token and refresh_token. Keep it private.
inkbox slack provisioning-workspace save --credentials-file credentials.json
inkbox slack provisioning-workspace list
inkbox slack setup start --identity example-agent \
  --provisioning-workspace-id 44444444-4444-4444-8444-444444444444
# If pending, check with slack connection list before installing.
inkbox slack installation start --identity example-agent
# Open authorizationUrl in a browser. After approval, list connections to confirm.
```

Use `--credentials-file -` to read JSON from stdin. Tokens are never returned.
Reuse the saved workspace ID for subsequent identity apps. Each app is bound to
its selected workspace. `needs_credentials` means its credentials need attention.

Installation availability does not imply preparation is ready.
`setup start`, `connection list`, and `installation start` accept exactly one of
`-i/--identity <handle>` or `--identity-id <uuid>`. Handles use the existing identity
lookup; the UUID form avoids that lookup.

| Command group | Operations |
| --- | --- |
| `slack setup` | `start` (preparation status is returned by `connection list`) |
| `slack search` | Search retained messages across an identity's workspace connections |
| `slack contact-rule` | `list`, `list-all`, `get`, `create`, `update`, `delete` |
| `slack contacts-import` | Import one page of directory or selected conversation members into contact cards; organization admin API key required |
| `slack connection` | `list`, `disconnect` |
| `slack provisioning-workspace` | `list`, `save --credentials-file <path>` |
| `slack conversation` | `list`, `get`, `open` (repeat `--user-id`) |
| `slack message` | `list`, `send` |
| `slack action` | `get <action-id>`, `get-by-key --idempotency-key <key>` |
| `slack file` | `get <file-id>`, `download <file-id>`, `preview <file-id>` |

All conversation/message/action/file operations require `--connection-id`.
Use `--conversation-id` for an existing conversation, `--thread-ts` for a thread,
`--cursor` for another page, and `--json` for structured output. Downloads refuse to
overwrite an existing path.

```bash
inkbox webhook subscription create --agent-identity-id 22222222-2222-4222-8222-222222222222 \
  --url https://example.com/hooks/slack --event-type slack.mention_received \
  --event-type slack.thread_reply_received
inkbox webhook subscription update SUBSCRIPTION_ID \
  --event-type slack.dm_received --event-type slack.mention_received
```

Repeat `--event-type` to select incoming Slack message categories. On update,
the supplied event types replace the subscription's full event list.

### Cached Slack display context

```bash
inkbox slack archive messages --connection-id CONNECTION_UUID \
  --conversation-id C0123456789 --roots-only --include conversation,sender,reactions,files
inkbox slack emoji list --connection-id CONNECTION_UUID --q party --limit 100
inkbox slack cached-media-download --connection-id CONNECTION_UUID \
  --kind user --resource-id U0123456789 --output avatar.png
inkbox slack file preview F0123456789 --connection-id CONNECTION_UUID --output preview.png
```

Byte downloads require a new output path and never overwrite an existing file.
Follow returned cursors explicitly. `--include` and `--roots-only` apply to archive
message listing, not ranked search. Omit `--roots-only` when selecting a thread.

Cached context is optional and may be incomplete or temporarily stale. Unknown
reaction and thread counts are not zero; a known count does not imply a complete
list of reacting users. Keep display caches separate by connection and invalidate
them when its optional `generation` changes. Emoji aliases name another definition.
The byte methods authenticate against Inkbox; do not forward your API key to
fallback image URLs. Cached image and preview reads return `404` when no copy exists
and no capture is queued. Queued or running capture/repair and temporary storage
failures return `503` with `Retry-After`. Honor that delay before retrying. Emoji image downloads accept alias names and
resolve them within the selected connection. Existing live methods and mutation
idempotency are unchanged.

Use root-only archive pages for the main timeline. They also retain replies whose
root is unavailable, so captured threads remain discoverable. Open a thread using
the reply’s `thread_ts` (`threadTs` in TypeScript/CLI); its missing root is not restored.

### Slack behavior

Organization-member sessions and organization admin API keys can prepare and install
apps for identities in their organization. Claimed agent keys can save workspace
configuration and prepare, install, read, and use their own identity’s connections.
Disconnecting connections, changing retention, and purging history require an
organization-member session or organization admin API key. Installation availability
does not mean preparation is complete; check `setup.status` before continuing.
Direct installation is also supported: `start_installation` (Python/Rust),
`startInstallation` (TypeScript), or `slack installation start` returns a short-lived
opaque authorization URL to open in a browser. Treat it as a secret; the browser
handoff establishes installation state. Workspace approval and channel permissions
still apply. Join accessible public channels or invite the agent to private channels;
Slack Connect conversations are supported when the connection has access.

`slack installation start --return-url <url>` optionally selects an approved Console
completion URL with the exact path `/console/slack/complete`, no query or fragment,
and at most 2048 characters.
Omit it to use the default completion page.

Conversation and live-history reads use the selected connection. The Console and
organization admin keys can read available retained file copies without a live Slack
lookup. Agent-scoped downloads still check current file access. A content download
without a retained copy can fall back to Slack and requires current access. These
methods do not read an entire-workspace archive. Conversation pages default to 100 (maximum 200); message
pages default to 15 (maximum 100). Pass the returned cursor explicitly for another
page. Slack timestamp identifiers are strings, never floating-point numbers. Direct
messages accept 1..8 user IDs. Message text is 1..12000 characters; sends require a
stable 1..128-character idempotency key using letters, digits, `.`, `_`, `:`, or `-`.
Reuse a key only for the exact same operation. A different body with the same key is a
conflict. Poll an action while it is `sending`; `sent` is not a delivered/read receipt.
Recover a lost response without resending with `inkbox slack action get-by-key --connection-id UUID --idempotency-key KEY`.
A 404 lookup result does not prove that no send occurred; do not switch to a new key
based on missing lookup data. A fresh `failed` / `rate_limited` send can include
`retry_after` (`retryAfter` in TypeScript/CLI), the minimum wait in seconds before
starting a deliberate new attempt. This hint is not retained on stored action reads
or same-key replays. Reusing the original key returns its terminal action and does
not send again. No automatic resend occurs.
`unknown` is terminal uncertainty, not a promise of future reconciliation: do not
blindly resend. Inspect authorized live history before deliberately starting a new
operation. File downloads return bytes; unavailable or oversized files surface API
errors. General file uploads accept standard base64 for 1 byte..10 MiB of decoded
content (CLI: `slack file upload --file PATH`). Reactions, pins, own-message edits and
deletions, channel join/leave, and native processing status use stable keys and return
operations: poll only `in_progress`; `unknown` remains terminal uncertainty. Send
keys and utility-operation keys have independent per-connection namespaces. Utility
operations emit no outcome webhook: inspect the returned status and operation lookup,
not send-outcome events. Native processing support depends on the workspace and may fail explicitly; no reaction is
used as a fallback. Inspect capabilities for missing scopes before requesting an upgrade.
Disconnect removes Inkbox authority, not the workspace's Slack app installation.

Slack setup creates the identity’s app directly in its selected workspace.
No identity toggle is required. Connection responses report app creation,
preparation readiness, and installation status separately.

Retained history is separate from live reads and webhook diagnostics. All observed
messages in conversations the connection can access are captured automatically,
independently of webhook subscriptions, with no time-based retention limit by default.
This is not an automatic whole-workspace or historical copy. Organization management
can set retention or delete retained history, but cannot disable or filter capture.
Omitted retention resets to no time limit.
Archive messages/search return retained records only. Backfill queues bounded imports
and reports coverage; a completed channel page does not prove every thread is complete. `restart=true`
restarts a completed/failed import. Purge deletes existing retained history without
stopping new capture. Reconnecting resumes capture automatically, but does not restore
deleted history. Archive reads still require current connection/conversation access.
Use the live exact-message permalink method when a Slack link is needed.
Live message context is a bounded window (`complete=false`), not full history.

Slack webhook envelopes use the existing signature verification and stable `id`
deduplication; delivery order is not guaranteed. All 23 event types are exported as
`SlackWebhookEventType`, with `SlackWebhookData` and `SlackWebhookPayload` types.
Select incoming messages through ordinary subscription event types:

| Event | Trigger |
| --- | --- |
| `slack.dm_received` | Direct message |
| `slack.group_dm_received` | Group direct message |
| `slack.channel_message_received` | Channel message |
| `slack.mention_received` | Message mentioning the agent |
| `slack.thread_reply_received` | Any thread reply, not a managed thread watch |

These categories overlap. Each incoming message produces at most one logical delivery per
subscription. Its `event_type` is the first matching selected event in this priority:
mention, thread reply, DM, group DM, channel message. `data.message_kinds` remains
contextual metadata. Subscriptions cover all accessible conversations across the
identity's connected workspaces; there are no connection/conversation selectors.
Edits and deletions use their own events without message-kind filtering. The
remaining event types cover message updates, reactions, files, and other activity.

Slack events can share an identity-owned subscription with other notification families.
Conversation context applies only to received mail, text, and iMessage events.
Mixed subscriptions require explicit identity scope for updates and deletion.
Slack delivery logs contain metadata only; historical replay is not supported.
The agent runtime owns narrower attention rules, thread watches, and its own memory.

### Retained history and utility actions

Start with `inkbox slack search --q "release notes"` to search retained message text across all workspace
connections owned by one identity. Agent credentials infer their identity; other
credentials must supply an explicit identity. A connection filter narrows that
identity's results; it is not required. Each result includes its connection ID.
Search uses plain English keywords, ranked by relevance and then recency, not
Slack query operators or semantic search. Attachment bodies are not indexed.
The query accepts 1..512 characters and page sizes are 1..100 (default 50).
Follow the returned cursor with the same filters even for short or empty pages;
stop only when the cursor is absent. Agent-scoped results require current Slack
access; the Console and organization admin keys read authorized retained history
without a live Slack lookup. Results may not cover all workspace history. Search
errors are raised, not returned as empty results.
The connection-specific archive search remains available.

```sh
inkbox slack capabilities --connection-id "$CONNECTION_ID"
inkbox slack search --q 'release notes'
# Non-agent credentials: add --identity example-agent or --identity-id UUID.
# Narrow to one workspace only when needed: add --connection-id "$CONNECTION_ID".
inkbox slack reaction add --connection-id "$CONNECTION_ID" \
  --conversation-id CEXAMPLE --message-ts 1780000000.000001 \
  --name eyes --idempotency-key review:release:1
inkbox slack file upload --connection-id "$CONNECTION_ID" \
  --conversation-id CEXAMPLE --file ./report.pdf --idempotency-key report:1
```

Use `slack user`, `conversation members/join/leave`, `message get/context/permalink/
update/delete`, `reaction`, `pin`, `processing-status set`, and `operation get
--operation-id ID` for utilities. `slack archive settings update --connection-id ID
--retention-days 90` sets a retention limit. Omitting `--retention-days` (or passing
`null`) resets to no time limit. Capture is automatic for all accessible observed
messages; select webhook events to control which events wake your agent. Archive subcommands
include `messages`, `search`, `backfill [--restart]`, `coverage`, and `purge`.

## License

MIT

## Verified domains

An organization admin can prove DNS control and attach a domain to an agent.
The domain follows the agent's visibility: public agents show it publicly;
private agents show it to their organization and authorized A2A peers. Proof expires at the
returned `valid_until`; assertions do not establish legal identity or endorse an
agent. Keep the TXT record in place. Domain certification is separate from custom
email sending domains.

See [verified domains](https://inkbox.ai/docs/capabilities/verified-domains) for
expiry, ownership, and recovery rules. These methods require version 0.7.12 or later.

```bash
inkbox organization-domain create example.com
# Add the returned TXT record, then use its claim ID.
inkbox organization-domain verify OrganizationDomainClaim_YOUR_ID
inkbox identity domain-affiliation set helper OrganizationDomainClaim_YOUR_ID
inkbox identity domain-affiliation get helper
inkbox a2a directory --public --query example.com
```

`organization-domain` provides `create`, `list`, `get`, `verify`, and `delete`.
`identity domain-affiliation set` attaches a claim to an agent.
Use `remove <handle>` to stop all affiliation assertions.
Use `--json` to inspect the complete response. Public search also accepts `--query`,
`--cursor`, and `--limit`; preserve the same filters on every page.

`--query` searches handles, descriptions, skills, and published verified domains,
including domain fragments. Text matches can include agents without a verified
domain. Add `--verified-domain example.com` to require an exact, current domain
affiliation in public results.

## Threaded iMessage replies

Requires SDK/CLI **0.7.13 or later**. These reply examples require a
phone-number conversation or a supported group; non-phone one-to-one
conversations remain receive-only, including threaded replies. `--no-plain-reply-fallback` requires
`--reply-to-message-id`; `--thread-id` on `imessage list` requires `--conversation-id`.

```bash
inkbox imessage send -i support-bot --conversation-id <conversation-id> --reply-to-message-id <message-id> --text "Agreed"
inkbox --json imessage thread <message-id> -i support-bot --limit 50
inkbox --json imessage thread <message-id> -i support-bot --cursor <next-cursor>
inkbox --json imessage conversation-thread <conversation-id> <thread-id> -i support-bot
inkbox imessage conversation <conversation-id> -i support-bot --thread-id <thread-id>
inkbox imessage list -i support-bot --conversation-id <conversation-id> --thread-id <thread-id>
```

`--reply-to-message-id` requires `--conversation-id` and cannot be combined
with `--to`. Thread commands return `threadId`, `conversationId`,
`threadRootMessageId`, `messages`, and `nextCursor`; use `--json` to preserve
the complete page. Messages include `replyToMessageId`, `threadId`, and
`threadRootMessageId` when available.

Thread IDs are opaque and distinct from message IDs. Thread pages include the
root and its replies in chronological order; follow `next_cursor` (Python/Rust)
or `nextCursor` (TypeScript/CLI) until null. A standalone message can have its own
thread ID and use its own message ID as the root, even before anyone replies.
A non-null `reply_to_message_id` / `replyToMessageId` identifies a visible reply
parent; a thread ID alone does not mean the message has replies. Thread metadata
may be null for pending or older messages, and the root or direct parent can be
unavailable. Conversation message lists remain flat and newest-first. A thread filter requires its conversation ID; it uses the existing
limit/offset pagination, unlike the chronological thread endpoints.

Native replies work in supported one-to-one and group iMessage conversations.
Use a message from the same conversation. With plain fallback enabled (the
default), the API sends an ordinary message in that conversation when native
threading is unsupported: the target is known to use SMS/RCS or was downgraded.
This does not force a particular transport. An ordinary fallback has no reply
parent and does not join the target's native thread. Invalid or inaccessible
targets, unsettled messages, and missing reply metadata still fail. Delivery
errors are not retried as new ordinary messages. If a previously supported target
can no longer receive a native reply, that send may fail even with fallback enabled.
Read the message status and error fields after queueing; delivery webhooks do not
cover every failure before dispatch. Omitting the target preserves ordinary sending.

Add `--no-plain-reply-fallback` to `imessage send` to require a native reply
instead.

## Slack contact rules

Use `inkbox identity update HANDLE --slack-filter-mode whitelist` for a shared
default, or `--slack-inbound-filter-mode` / `--slack-outbound-filter-mode` for
separate directions. Do not combine the shared and directional flags.

`slack contacts-import` requires an organization admin API key; agent-scoped
keys cannot run this command.

```bash
inkbox slack contact-rule create example-agent --action allow \
  --match-type exact_user --match-target TEXAMPLE:UEXAMPLE
inkbox slack contacts-import --connection-id 11111111-1111-4111-8111-111111111111
inkbox identity companion update example-agent --enabled true
```

Import fetches one page. Follow `nextCursor`, including after an empty
page, to continue. Import does not create allow rules. Workspace rules match a
person's verified home workspace; they do not sponsor Companion conversations.

Slack sponsorship covers the channel or group DM, including all its threads.
A new participant joining or the sponsor leaving requires fresh sponsorship;
another participant leaving alone does not. Explicit blocks still apply.
Optional `threadTs` in reply context selects a reply thread; it does not limit sponsorship.

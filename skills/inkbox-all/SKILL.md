---
name: inkbox-all
description: Index of all Inkbox skills in this repository, including the example skills under `examples/`, with GitHub links and short guidance on when to use each one.
user-invocable: false
---

# Inkbox Skills Index

Inkbox is an identity layer for AI agents. It gives agents a persistent identity with a real inbox, phone number, and secure vault, so they can send emails, receive replies, answer calls, store credentials, and manage conversations as a single, consistent entity. Learn more at https://inkbox.ai.

Useful links:

- Website: https://inkbox.ai
- LLMs: https://inkbox.ai/llms.txt
- OpenAPI: https://inkbox.ai/api/openapi.json

This skill is just a directory of the other Inkbox skills in this repository. Use it when you want to see the full menu before choosing a more specific skill. In practice, `inkbox-onboarding` covers channel setup and readiness, the SDK skills are the main references for application code, `inkbox-agent-self-signup` covers the self-registration flow, `inkbox-cli` covers shell usage, and the example skills under `examples/` are prompt templates for browser-capable agents.

## Core Skills

Communication rules are human-controlled: agent keys can inspect permitted contact data but cannot change their own rules. Exact-address choices override the email or phone mode; phone includes SMS, calls, and iMessage. Email/phone visibility is whole-group and separate from per-address communication. The SDK/CLI skills cover `contacts.access` controls, boolean permissions, advanced policies, and filtered previews.

Profile is the parent contact permission. Email, Phone, and Memories access requires Profile; hosted voice in YOLO mode retains organization-wide contact and memory reads, while ordinary SDK, CLI, MCP, and webhook access remains scoped.

The Agent workspace's Contacts page manages each saved email and phone number plus Profile and Memories access, including hidden contacts. Administrative SDK/CLI permission rosters distinguish partial access from absent identifiers. Identity-owned communication rules include nullable caller-authorized contact cards without memories; a missing card does not change the rule's effect.

- `inkbox-onboarding`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-onboarding/SKILL.md
  Language-agnostic setup flow for an existing identity, including channel readiness, recipient consent, inbound handling, recurring triage, and API/CLI/SDK examples.

- `inkbox-agent-self-signup`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-agent-self-signup/SKILL.md
  Shared reference for Inkbox agent self-signup, verification, resend-verification, and claim-status flows.

- `inkbox-cli`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-cli/SKILL.md
  Reference for running the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email and drafts, mailbox imports, phone, text, iMessage, A2A task/message history, vault, mailbox storage and mail-client settings, number, signing key, and webhook operations.

- `inkbox-python`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-python/SKILL.md
  Python SDK reference for `inkbox`, including identities, email drafts, MBOX/EML/ZIP mailbox imports, phone, text/SMS, iMessage, A2A task/message history, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels.

- `inkbox-ts`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-ts/SKILL.md
  TypeScript/JavaScript SDK reference for `@inkbox/sdk`, including identities, email drafts, MBOX/EML/ZIP mailbox imports, phone, text/SMS, iMessage, A2A task/message history, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels.

For A2A history, search covers string and numeric content values from `text`
and `data` parts, not metadata, with newest-first results. Message `role` is
the author (`caller` or `agent`), independent of task direction.
For A2A invitations use the language-specific `a2a_invitations` /
`a2aInvitations` resource or `inkbox a2a invites`. Invitation acceptance is a
claimed-agent operation; management is organization-admin scoped.
Share URLs are capability-bearing: accept them only through the SDK parser or
the CLI's neutral environment/stdin/prompt sources, and never log or put them
directly in argv.

- `inkbox-tunnels`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-tunnels/SKILL.md
  Tunnels reference for Python, TypeScript, and Rust — bring a local process online behind a public Inkbox URL, observe local runtime liveness, and recover from transient failures. Tunnels are an identity property (provisioned atomically by identity creation); Python and TypeScript also cover in-process HTTP/WebSocket handlers and make-before-break drain.

## Example Skills

- `use-inkbox-browser-use`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/examples/use-inkbox-browser-use/SKILL.md
  Prompt template for an agent that has Browser Use browser automation plus an Inkbox-backed email identity and vault access.

- `use-inkbox-kernel`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/examples/use-inkbox-kernel/SKILL.md
  Prompt template for an agent that has a Kernel cloud browser plus an Inkbox-backed email identity.

## Related Examples

These example directories are useful references, but they are not standalone skills because they do not contain a `SKILL.md` file.

- `use-inkbox-cli`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-cli
  Shell script examples for automating Inkbox from terminal workflows, CI, and agent shell execution using `@inkbox/cli` plus `jq`.

- `use-inkbox-vault`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-vault
  Small Python and TypeScript examples showing how to create a login credential with TOTP, generate codes, and clean up.

## Mail Clients (IMAP/SMTP) and Mailbox Storage

Two cross-cutting mail facts worth knowing before you pick a skill. Each SDK/CLI skill above covers them in its own idiom.

**An inbox can be attached to a regular mail client** (Thunderbird, Apple Mail, mutt, …) with the API key an agent already has — there is no separate credential to create, and **no HTTP endpoint or SDK method is involved**; the gateway speaks IMAP and SMTP directly. Username = the inbox address; password = an **identity-scoped** API key (admin-scoped keys are rejected — one key maps to exactly one mailbox; revoking the key revokes mail-client access). Hosts `imap.inkboxmail.com` / `smtp.inkboxmail.com`, ports 993 (IMAPS), 465 (SMTPS), 587 (STARTTLS). `inkbox mailbox client-settings <email-address>` prints the table. Constraints: the `From` must be the authenticated inbox address (exactly one; aliases and "send as" are rejected); on the Free plan signed/encrypted mail (S/MIME, PGP) cannot be sent over SMTP (the required footer would break the signature). Leave "save a copy of sent messages" on — Inkbox recognizes the client's copy as the message it already stored, so there is one Sent entry, charged once. Full walkthrough: https://inkbox.ai/docs/capabilities/email/mail-clients

**Mailboxes have a plan storage cap.** `mailboxes.list` / `.get` / `.update` carry `storage_used_bytes` / `storage_limit_bytes` (TS `storageUsedBytes` / `storageLimitBytes`; `null` when the server resolved no cap). Sends, reply-alls, and forwards over the cap fail with HTTP 402 — `StorageLimitExceededError` (Rust `InkboxError::StorageLimitExceeded`), carrying `message`, `upgrade_url`, and `limit_bytes`. Deleting messages or threads frees space immediately. Caps are **binary**: 2 GiB = `2 * 1024³` = 2,147,483,648 bytes — divide by 1024 and label GiB/MiB, never GB. On the Free plan a footer is appended to the **stored** body of outgoing mail, so a fetched message is not byte-for-byte what was sent.

## Mailbox Imports

All SDKs expose mailbox imports under `mailboxes.imports`; the CLI uses
`inkbox mailbox imports run|get|list|wait|cancel`. The lifecycle is create,
direct upload, start, then poll. Supported inputs are MBOX and EML files, or a
ZIP holding either (a Gmail Takeout ZIP imports as-is); ZIP entries that are not
mail, including nested archives, are ignored. Waiters fetch immediately, poll
every five seconds by default, and return every terminal state (`completed`,
`failed`, `cancelled`). A local timeout does not cancel the job. Counters are
cumulative and never go backwards, so a stalled counter is a signal, not normal
churn; they can still sit unchanged while a large message is processed and are
not a percentage. Jobs run one at a time per organization and share overall
import capacity, so a long `queued` stretch is normal; do not cancel and
recreate. Unsafe imported content may be rejected and counted separately.

Limits: 1 GiB per upload, 50 MiB per message, 100,000 messages and 20 original
addresses per job, 65,000 entries per ZIP, 20 import jobs per organization per
24 hours, and one in-flight import per mailbox. Upload targets expire after 5
minutes; re-issue one and upload again, or cancel the job. An abandoned job
holds the mailbox for 24 hours.

## Email Drafts

Python, TypeScript, Rust, and the CLI expose the same saved draft lifecycle:
create, list, get, update, duplicate, delete, attachments, and send. Drafts
share the mailbox's standard Drafts folder with connected mail clients. Every
mutation requires the latest returned generation; attachment part indexes are
coupled to that generation.

Successful send returns the sent message and removes the draft. Retrying with
the same draft ID and exact generation may return that message again. Structured
HTTP 409 codes distinguish stale generation (`draft_generation_conflict`), a
send still in progress (`draft_send_in_progress`), and an uncertain delivery
outcome (`draft_delivery_uncertain`). Refresh stale drafts and retry in-progress
sends with the same generation. Never resend an uncertain draft; after checking
sent mail, duplicate or delete it instead.

## How To Choose

- Use `inkbox-python` when writing Python application code against the SDK.
- Use `inkbox-ts` when writing TypeScript or JavaScript application code against the SDK.
- Use `inkbox-cli` when the task is operational and best handled with shell commands.
- Use `inkbox-tunnels` when bringing a local server online at a public Inkbox URL via `inkbox.tunnels.connect(...)`.
- Use `inkbox-onboarding` when an identity exists but its communication channels, recipient setup, inbound handling, or recurring triage still need configuration.
- Use `inkbox-agent-self-signup` when the agent does not have an API key yet and needs to self-register.
- Use the example skills when you want a reusable agent prompt rather than SDK integration code.
- Use the related examples when you want runnable scripts or end-to-end sample workflows instead of a reusable skill prompt.

## Custom Email Signatures

Use `mailboxes.update` (Python/TypeScript), `mailboxes().update_with_options`
(Rust), or `inkbox mailbox update` to save a per-mailbox HTML/text signature and
toggle automatic insertion. CLI file flags read UTF-8 content, including text
`.sig` files. See the language or CLI skill for fields and clear semantics.
Setting or enabling requires an eligible paid plan; clearing and disabling remain
available. The Inkbox watermark is separate from the custom signature.

## Slack

In 0.7.14+, Slack supports directional person and workspace contact rules via
`client.slack.contact_rules` (Python), `client.slack.contactRules` (TypeScript),
`client.slack().contact_rules` (Rust), and `slack contact-rule` (CLI).
Rule writes, default changes, and contact import require an organization admin key; claimed agent keys can read
their own rules. Import is paginated and never grants messaging or Companion access.
Companion requires an exact human account allowed in both directions, not a workspace allow.

See the [Slack API and onboarding guide](https://github.com/inkbox-ai/inkbox/blob/main/README.md#slack-workspace-connections) for implemented SDK/CLI methods.
Use an existing identity. Select a workspace explicitly for live reads and mutations.
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
For search, start with `inkbox slack search --q "release notes"` across the identity's workspace connections.
Do not loop over connections or require a connection ID for a general search.
Agent credentials infer the identity; other credentials require an explicit identity.
Use a connection filter only to narrow the search. Results include connection IDs.
Use plain English keywords, ranked by relevance then recency; not Slack query
operators or semantic search. Attachment bodies are not indexed. Follow the returned
cursor with the same filters even for short or empty pages, until no cursor remains.
Search errors are not evidence of no matches.
Use archive listing, bounded backfill/restart, and coverage; do not infer complete workspace/thread history
from one page or a completed channel import. Purge deletes retained history without stopping new capture. Archive reads require current connection/conversation access.
In 0.7.15+, use archive message listing with optional conversation, sender, reactions, and files expansions for a main timeline with cached display context.
Use cached emoji listing and authenticated image/preview downloads for cached media. Follow emoji cursors explicitly and inspect directory status;
missing permissions or pending synchronization can leave an empty incomplete page.
Unknown reaction/thread counts are not zero, and known reaction counts do not imply complete actor lists.
Omit the roots-only option when reading a selected thread. Expansions do not apply to ranked search.
Keep caches separate by connection and invalidate them when its generation changes. Never forward
Inkbox credentials to fallback image URLs. Current message and file access checks still apply.

Slack webhooks select incoming messages with `slack.dm_received`,
`slack.group_dm_received`, `slack.channel_message_received`, `slack.mention_received`,
and `slack.thread_reply_received`. Overlapping selections produce one logical delivery per subscription,
choosing the first selected match in mention, thread, DM, group DM, channel priority.
Subscriptions cover all accessible conversations across connected workspaces.
There are no Slack-specific filters. Context applies only to received mail, text,
and iMessage events; Slack historical delivery replay is unsupported. The runtime owns attention rules,
watched threads, and its own memory. Webhook delivery order is not guaranteed.

## Threaded iMessages

Requires SDK/CLI **0.7.13 or later**.

Native replies target a specific message within an existing conversation.
Python/TypeScript send helpers accept `reply_to_message_id` / `replyToMessageId`
with the conversation ID; the CLI accepts `--reply-to-message-id`. Read threads
by any message or by conversation plus opaque thread ID. Follow thread-page
cursors; ordinary conversation lists remain flat and use offset pagination.
Thread IDs are distinct from message IDs. Standalone messages can have their own
thread ID and use their message ID as the root before anyone replies; a thread ID
does not prove replies exist. See the language and CLI skills for methods, nullable
metadata, and examples.

Reply sends allow an ordinary message in the same conversation when native
threading is unsupported, including SMS/RCS targets. Set Python
`plain_reply_fallback=False`, TypeScript `plainReplyFallback: false`, or CLI
`--no-plain-reply-fallback` to require native threading. Rust offers
`send_reply_with_fallback` / `send_imessage_reply_with_fallback` with a final
boolean argument. The API owns fallback; clients do not resend failed replies
as ordinary messages. Invalid or inaccessible targets still fail. Keep agent
memory tied to the conversation; a native thread is optional context, and an
ordinary fallback has no reply parent and does not join the target's native
thread. Unsettled targets or missing reply metadata still fail. A previously
supported target may still fail after native delivery becomes unavailable; fallback
does not resend rejected replies. Read queued message status and error fields,
because delivery webhooks do not cover every failure before dispatch.

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

This skill is just a directory of the other Inkbox skills in this repository. Use it when you want to see the full menu before choosing a more specific skill. In practice, the SDK skills are the main references for application code, `inkbox-agent-self-signup` covers the self-registration flow, `inkbox-cli` covers shell usage, and the example skills under `examples/` are prompt templates for browser-capable agents.

## Core Skills

- `inkbox-agent-self-signup`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-agent-self-signup/SKILL.md
  Shared reference for Inkbox agent self-signup, verification, resend-verification, and claim-status flows.

- `inkbox-cli`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-cli/SKILL.md
  Reference for running the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email and drafts, mailbox imports, phone, text, iMessage, A2A task/message history, vault, mailbox storage and mail-client settings, number, signing key, and webhook operations.

- `inkbox-python`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-python/SKILL.md
  Python SDK reference for `inkbox`, including identities, email drafts, MBOX/EML/ZIP mailbox imports, phone, text/SMS, iMessage, A2A task/message history, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels.

- `inkbox-rust`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-rust/SKILL.md
  Rust SDK reference for the `inkbox` crate, including identities, email, MBOX/EML/ZIP mailbox imports, phone, text/SMS, iMessage, A2A task/message history, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels. The surface is blocking (no async), options are positional rather than keyword, and tri-state fields use the `Unset<T>` sentinel. A2A receiver configuration and the standard outbound protocol client are Python/TS only; the tunnels data plane needs the `tunnels-runtime` cargo feature and forwards to a URL rather than an in-process handler.

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

- `use-inkbox-rust`
  GitHub: https://github.com/inkbox-ai/inkbox/tree/main/examples/use-inkbox-rust
  Runnable Rust examples mirroring the CLI scripts — identity and email, vault TOTP, inbox monitoring, and agent self-signup — as numbered binaries in a single crate.

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
- Use `inkbox-rust` when writing Rust application code against the `inkbox` crate.
- Use `inkbox-cli` when the task is operational and best handled with shell commands.
- Use `inkbox-tunnels` when bringing a local server online at a public Inkbox URL via `inkbox.tunnels.connect(...)`.
- Use `inkbox-agent-self-signup` when the agent does not have an API key yet and needs to self-register.
- Use the example skills when you want a reusable agent prompt rather than SDK integration code.
- Use the related examples when you want runnable scripts or end-to-end sample workflows instead of a reusable skill prompt.

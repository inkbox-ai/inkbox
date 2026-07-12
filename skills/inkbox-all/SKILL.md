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
  Reference for running the Inkbox CLI (`inkbox` / `@inkbox/cli`) for identities, email, phone, text, iMessage, vault, mailbox (including storage and IMAP/SMTP client settings), number, signing key, and webhook operations.

- `inkbox-python`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-python/SKILL.md
  Python SDK reference for `inkbox`, including identities, email, phone, text/SMS, iMessage, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels.

- `inkbox-ts`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-ts/SKILL.md
  TypeScript/JavaScript SDK reference for `@inkbox/sdk`, including identities, email, phone, text/SMS, iMessage, contacts, notes, contact rules, custom sending domains, mailbox storage caps, mail clients (IMAP/SMTP), vault, signing keys, and tunnels.

- `inkbox-tunnels`
  GitHub: https://github.com/inkbox-ai/inkbox/blob/main/skills/inkbox-tunnels/SKILL.md
  Tunnels reference for both SDKs — bring a local server online behind a public Inkbox URL via `inkbox.tunnels.connect(...)`. Tunnels are an identity property (provisioned atomically by `createIdentity`); covers edge vs passthrough TLS, the same-API-key data-plane auth, URL forwarding, and in-process Fetch/ASGI/WebSocket handlers.

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

## How To Choose

- Use `inkbox-python` when writing Python application code against the SDK.
- Use `inkbox-ts` when writing TypeScript or JavaScript application code against the SDK.
- Use `inkbox-cli` when the task is operational and best handled with shell commands.
- Use `inkbox-tunnels` when bringing a local server online at a public Inkbox URL via `inkbox.tunnels.connect(...)`.
- Use `inkbox-agent-self-signup` when the agent does not have an API key yet and needs to self-register.
- Use the example skills when you want a reusable agent prompt rather than SDK integration code.
- Use the related examples when you want runnable scripts or end-to-end sample workflows instead of a reusable skill prompt.

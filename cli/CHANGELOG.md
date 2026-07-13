# Changelog

## 0.4.24 — Mailbox storage caps + mail clients

### Added

- **Storage visibility on `mailbox`.** `inkbox mailbox list` gains a `storage` column (`1.2 GiB / 2 GiB`) and `inkbox mailbox get` gains `storageUsedBytes` / `storageLimitBytes`. `--json` keeps the raw byte counts; the table humanizes them. Units are **binary** (2 GiB = `2 * 1024³`), so readouts are labeled GiB/MiB. A `-` limit means the server didn't resolve a cap.
- **402 over-cap sends are rendered as themselves.** A send/reply-all/forward that would push the mailbox past its plan's storage cap now prints the server's message plus a hint: free space with `inkbox email delete <message-id> -i <handle>` / `inkbox email delete-thread <thread-id> -i <handle>`, or upgrade the plan (with the billing URL). A `402` whose detail is a plain string still falls back to the generic API error.
- **`inkbox mailbox client-settings <email-address>`.** Prints the IMAP/SMTP settings for attaching the inbox to a regular mail client — hosts derived from the configured API base URL, username = the inbox address. The password is never printed: use an identity-scoped API key. When the configured base URL isn't a recognized Inkbox API host, the command errors instead of printing hosts it would have to guess.

### Changed

- CLI pins `@inkbox/sdk` at `^0.4.24`.

## 0.4.23 — Inkbox Voice AI rebrand

### Changed

- **Prose-only rebrand: the hosted call agent is now "Inkbox Voice AI".** `--help` text and the README now say "Inkbox Voice AI" / "Voice AI". Commands, flags, arguments, and output are unchanged — `inkbox phone hosted-agent`, `--hosted`, and the `hosted_agent` action keep their names.

## 0.4.22 — Hosted call agent

### Added

- **`--hosted --reason "<text>"` on `inkbox phone call`.** Places a call the hosted call agent drives end to end. Fails fast on shape only: `--hosted` requires `--reason` and conflicts with `--ws-url`; everything else is server policy surfaced as an API error. Output gains `mode` / `reason`.
- **`inkbox phone hosted-agent get|set`.** Shows / sets the identity's hosted call agent config (`--voice`, `--model`, `--instructions`). `set` is a full replace: an omitted flag resets that field to the server default.
- **`inkbox phone incoming-action [action]`.** Without an action, prints the identity's incoming-call config; with one (`auto_accept` | `auto_reject` | `webhook` | `hosted_agent`), sets it (`--ws-url` / `--webhook-url` where applicable — `hosted_agent` needs neither). `inkbox number update --incoming-call-action hosted_agent` is accepted too.
- **Post-call action items ride the call object.** The hosted agent's recorded action items (open items only, `seq`-ascending) ride each call returned by `inkbox phone calls` — no separate command. The default table output does not show `mode` or `post_call_action_items`; use `--json` to read them.

### Changed

- CLI pins `@inkbox/sdk` at `^0.4.22`.

## 0.4.20 — Date-range list filters + external call hangup

### Added

- **`--start-datetime` / `--end-datetime` / `--tz` on comms list commands.** `email list`, `email unread`, `phone calls`, `text list`, `text conversations`, `imessage list`, and `imessage conversations` accept a date range that filters on `created_at`. Bare dates resolve to calendar days in `--tz` (default UTC), with `--end-datetime` whole-day inclusive; datetimes with an explicit `Z`/offset are exact instants (`--tz` ignored). Omitting the flags leaves listing behavior unchanged.

- **`inkbox phone hangup <call-id>`.** Ends a live call from outside it; takes `-i, --identity <handle>` and prints `{id, direction, remotePhoneNumber, status, hangupReason}` (honors `--json`). The carrier confirms the teardown asynchronously, so the printed call can still show its live status; already-ended calls surface the server's 409.

### Changed

- CLI pins `@inkbox/sdk` at `^0.4.20`.

## 0.4.16 — Configurable webhook context + open tracking

### Added

- **Conversation-context flags on `webhook subscription`.** `create` / `update` accept `--context-email` / `--context-texts` / `--context-calls <count:N|window:H>`; `update` also accepts `--clear-context` (mutually exclusive with `--context-*`).
- **`--track-opens` on `email send` / `email forward`.** Embeds an open-tracking pixel; `email send` requires `--body-html`, while `email forward` inline mode reuses the original's HTML. `email get` / `email list` surface `openCount` / `firstOpenedAt` when present.

### Changed

- **`inkbox email get` marks inbound messages read.** Fetching a single inbound message with an API key now flips its read flag server-side; list and thread routes do not.

## 0.4.12 — Tunnel DX

### Added

- **`~/.inkbox/config` auth fallback.** `--api-key` / `INKBOX_API_KEY` / a `~/.inkbox/config` file are tried in order, so the CLI can authenticate where the shell's env isn't inherited.
- **`currentlyConnected` column** on `inkbox tunnel list`. Bundles `@inkbox/sdk` `0.4.12`.

## 0.4.11 — Reply all

### Added

- **`inkbox email reply-all <message-id>`.** Sends a reply to all visible participants on an existing email. Bundles `@inkbox/sdk` `0.4.11`.

## 0.4.10 — Agent harness

### Added

- **`--harness <harness>` flag on `inkbox signup`.** Passes an optional identifier for the agent harness/runtime; when a plugin exists for it, post-verification guidance is folded into the verify `message`. Bundles `@inkbox/sdk` `0.4.10`.

## 0.4.8 — graceful tunnel reconnect on redeploy

### Changed

- Bundles `@inkbox/sdk` `0.4.8`, which adds make-before-break tunnel reconnect on server redeploy. No CLI-visible behavior change — the CLI's tunnel commands (`list`, `get`, `update`, `sign-csr`) are one-shot control-plane calls; the reconnect logic lives in the SDK's long-running `tunnels.connect(...)` data plane, which the CLI does not use.

## 0.4.6 — webhook subscriptions refactor

### Breaking

- **`--webhook-url` removed from `inkbox mailbox update`.** Attach receivers via `inkbox webhook subscription create --mailbox-id <id> --url <url> --event-type <type> ...` instead.
- **`--incoming-text-webhook-url` removed** from `inkbox number provision` and `inkbox number update`. Replace with `inkbox webhook subscription create --phone-number-id <id> --url <url> --event-type text.received ...`.
- **`webhookUrl` dropped from `inkbox mailbox get/update` output**; **`incomingTextWebhookUrl` dropped from `inkbox number get/update/provision` output.**

### Added

- **`inkbox webhook subscription` subcommand group**: `list`, `get`, `create`, `update`, `delete`. Routes to the new server `/webhooks/subscriptions` endpoint via `inkbox.webhooks.subscriptions`. `--event-type` is repeatable on `create` (≥1 required) and `update` (presence replaces the stored list; absence is no-op).

## 0.4.5

### Added

- **Group text/MMS support.** `inkbox text send` accepts comma-separated
  `--to` recipients, `--conversation-id` for replies into existing
  conversations, and repeatable `--media-url`; `inkbox text
  conversations` accepts `--include-groups` and displays
  `latestHasMedia`; conversation read commands accept either the legacy
  remote number or a conversation UUID.

- **`inkbox identity access` command group** for managing agent visibility:
  - `inkbox identity access list <target-handle>` — list who can see an identity.
  - `inkbox identity access grant <target-handle> <viewer-handle>` — grant a viewer identity visibility on the target.
  - `inkbox identity access grant-everyone <target-handle>` — make the target visible to every active identity in the org (wildcard).
  - `inkbox identity access revoke <target-handle> <viewer-handle>` — revoke a viewer identity's visibility.

  Viewer identities are passed as handles and resolved to UUIDs automatically. This `identity access` group is unrelated to `identity revoke-access`, which manages vault-secret access.

## 0.4.3

### Breaking

- **`inkbox identity unlink-phone <handle>` was renamed to `inkbox identity release-phone <handle>`** and now releases the number at the carrier in addition to detaching it from the identity. Previously it only cleared the FK and left the carrier-side number live. There is no "unlink without release" path anymore.
- **`inkbox identity assign-phone` was removed.** The server no longer supports cross-identity reassignment; phone numbers are bound to the identity they were provisioned on. To attach a number, create the identity first with `inkbox identity create <handle>`, then run `inkbox number provision --handle <handle>`.

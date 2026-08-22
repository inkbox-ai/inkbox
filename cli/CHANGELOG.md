# Changelog

## 0.6.1 — Automatic iMessage contact sharing

- Identity create and update accept `--contact-sharing-enabled true|false`.
- CLI and SDK dependency versions moved in lockstep to 0.6.1.

## 0.6.0 — Dedicated iMessage lines

- iMessage help and bundled guidance now describe shared service and one
  dedicated iMessage line with one-to-one and group initiation.
- CLI and SDK dependency versions moved in lockstep to 0.6.0.

## 0.5.16 — Support Agent discovery on API errors

- API failures retain their existing first line and now print the server's
  Support Agent instructions when available.
- Secret redaction also covers the optional Support Agent instructions.
- CLI and SDK dependency versions moved in lockstep to 0.5.16.

## 0.5.14 — A2A invitations

- Accept invitation links or raw tokens through the neutral
  `INKBOX_A2A_INVITATION`, `--invitation-stdin`, and `--invitation-prompt`
  sources. Token-named sources remain aliases; capability argv remains
  unsupported, reflected links/tokens are redacted from failures, and share
  links must use the exact-origin `/console/a2a/invitations/accept` path.

- Added `a2a invites create|list|show|revoke|accept` and invitation-assisted
  `signup create`, including explicit hidden-prompt and stdin token input.
- Accept requires a claimed agent-scoped API key. Its token comes from a
  hidden prompt, `INKBOX_A2A_INVITATION_TOKEN`, or explicit `--token-stdin`;
  it is never accepted as a raw command argument or reflected in errors.
- CLI and SDK dependency versions moved in lockstep to 0.5.14.
- Invitation rate-limit errors include server-provided retry guidance.
- When an older API version does not confirm an invitation-assisted signup,
  the CLI warns that the invitation may not have been applied.

## 0.5.13 — A2A agent discovery

### Added

- `inkbox a2a directory`, `settings`, `publicly-discoverable`, and
  `public-egress` expose Agent Card discovery and routing controls.

### Changed

- CLI version moved in lockstep to 0.5.13 and now depends on `@inkbox/sdk`
  `^0.5.13`.
- Agent-scoped `identity list` and `identity get` return only the caller's own
  identity. Use `inkbox a2a directory` to discover peers.

### Removed

- **Source-breaking:** the `identity access` command group has been removed.
  Use A2A directories and contact rules instead.

### Compatibility

- Discovery commands require the matching API rollout.

## 0.5.12 — Bidirectional A2A contexts

### Added

- `inkbox a2a contexts|context|sent-contexts|sent-context` exposes persisted
  context names and original-open history.
- `inkbox a2a rename-context` lets either participant rename a shared context.

### Changed

- `inkbox a2a call --context` now explains that omitting `--task` starts a
  sibling task in the existing context.
- CLI version moved in lockstep to 0.5.12 and now depends on `@inkbox/sdk`
  `^0.5.12`.

### Compatibility

- Existing commands and wire keys are unchanged. New context fields and
  commands require the matching API rollout.

## 0.5.10 — Tunnel disconnect timestamps

### Added

- `inkbox tunnel get` includes the nullable, best-effort
  `lastDisconnectedAt` timestamp.

### Changed

- CLI version moved in lockstep to 0.5.10 and now depends on `@inkbox/sdk`
  `^0.5.10`.

### Compatibility

- Existing commands and flags are unchanged.

## 0.5.9 — Voice AI authority inheritance

### Changed

- `inkbox phone call --hosted` omits the authority override unless
  `--authority-mode` is supplied, allowing the call to inherit the identity's
  saved Voice AI authority.
- `--authority-mode contact_scoped` explicitly downscopes one call.
  `--authority-mode yolo` requires an admin credential only when it exceeds the
  saved authority.
- CLI version moved in lockstep to 0.5.9 and now depends on `@inkbox/sdk`
  `^0.5.9`.

### Compatibility

- Command names and flags are unchanged. Older API versions may still resolve an
  omitted authority as `contact_scoped`.

## 0.5.8 — Hosted-agent authority and voicemail detection

### Added

- `inkbox phone call --authority-mode <contact_scoped|yolo>` selects authority
  for an outbound hosted-agent call; `yolo` requires an admin API key.
- `inkbox phone hosted-agent authority-mode <contact_scoped|yolo>` updates an
  identity's mode for future incoming calls with an admin API key. Outbound
  calls use `phone call --authority-mode`.
- Call and hosted-agent config output includes the resolved authority mode.
- `inkbox phone call --no-voicemail-detection` keeps a call connected after
  voicemail is detected so the caller can leave a message.
- `inkbox phone tool-activity <call-id>` lists safe, paginated Voice AI tool
  activity for a call.

### Changed

- CLI version moved in lockstep to 0.5.8 and now depends on `@inkbox/sdk`
  `^0.5.8`.

## 0.5.6 — A2A 1.0

### Added

- `inkbox a2a enable|disable|card`, skills and rule management, filterable task/message history, task replies, and remote `call|check|cancel` commands.

### Changed

- CLI version moved with Python and TypeScript to 0.5.6 and now depends on `@inkbox/sdk` `^0.5.6`.
- Task and message list commands preserve opaque pagination cursors in JSON and human-readable output.

## 0.5.5 — Action-only contact-rule updates

### Changed

- Contact-rule update commands now require `--action`.
- CLI version moved in lockstep with `@inkbox/sdk` 0.5.5 and depends on `^0.5.5`.

### Removed

- Identity and contact-rule update commands no longer accept lifecycle `--status`.

## 0.5.4 — Dedicated outbound iMessage groups

### Added

- `inkbox imessage send --to` accepts one E.164 recipient or a comma-separated group.
- `inkbox imessage list` and `inkbox imessage conversations` accept `--include-groups`; default listings remain one-to-one only.
- Group conversation output exposes `groupCreationStatus`, and `imessage react` supports inbound group messages by message id.
- `imessage react --reaction` accepts the seven named reactions, including `eyes`, and rejects arbitrary/custom emoji values before sending.
- Existing `--send-style` works on group creation and conversation-id replies, including sends with `--media-url`.

### Changed

- CLI version moved in lockstep with `@inkbox/sdk` 0.5.4 and depends on `^0.5.4`.

## 0.4.26 — Dedicated iMessage number SDK support

### Changed

- CLI version moved in lockstep with `@inkbox/sdk` 0.4.26 and depends on `^0.4.26`. This release adds no new CLI commands; dedicated iMessage number management is available through the SDKs.

## 0.4.25 — Proxy support (HTTP_PROXY / HTTPS_PROXY / NO_PROXY)

### Added

- **Proxy environment variables are honored.** Node's `fetch` ignores `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` unless `NODE_USE_ENV_PROXY` is set — a flag that only exists on Node 22.21+ / 24+ — so in sandboxed or proxied environments every command died with a bare `fetch failed`. The CLI now routes requests through the configured proxy automatically (undici's `EnvHttpProxyAgent`) whenever a proxy variable is present, on every supported Node version; `NO_PROXY` is respected, and `NODE_USE_ENV_PROXY=0` opts out (matching Node's own semantics). New runtime dependency: `undici` (^7).
- **Clearer connection errors.** A request that fails before any HTTP response (DNS failure, refused connection, unreachable proxy) now prints the request URL and the underlying cause — e.g. `Error: Request to https://… failed: getaddrinfo ENOTFOUND …` — instead of `Error: fetch failed` (via `@inkbox/sdk`'s new `InkboxConnectionError`).

### Changed

- `inkbox tunnel get <handle>` (the identity-embedded path) may show `currentlyConnected: null` once servers slim identity-embedded tunnel payloads to durable config — `null` means "not reported", not "disconnected". `inkbox tunnel get <uuid>` always reflects live state.

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

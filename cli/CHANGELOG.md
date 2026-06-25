# Changelog

## 0.4.10 — Agent harness

### Added

- **`--harness <harness>` flag on `inkbox signup`.** Passes an optional identifier for the agent harness/runtime; the verify response returns `nextSteps`. Bundles `@inkbox/sdk` `0.4.10`.

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

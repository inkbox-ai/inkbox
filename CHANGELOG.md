# Changelog

All notable changes to the Inkbox SDK, CLI, and skills live here.
Versions move in lockstep across `@inkbox/sdk` (TypeScript), `inkbox`
(Python), and `@inkbox/cli`.

## 0.4.1

### Added

- `inkbox.sms_opt_ins` / `inkbox.smsOptIns` — SMS opt-in / opt-out
  registry (per-(org, receiver) consent). `list()` / `get()` read the
  calling org's rows; `opt_in()` / `optIn()` and `opt_out()` /
  `optOut()` write, but require the org to be on its own actively-
  used 10DLC campaign (server returns 409 `customer_campaign_required`
  for default-pool orgs). Writes record an audit event with
  `source=api`.
- New types: `SmsOptIn`, `SmsOptInStatus`, `SmsOptInSource`.
- CLI: `inkbox sms-opt-in {list, get, opt-in, opt-out}` — same surface
  as the SDKs, with `--status` / `--limit` / `--offset` filters on
  list and `--json` on every command. `--base-url` now also reads
  `INKBOX_BASE_URL` so the CLI can target dev/beta without threading
  the flag.

## 0.4.0

Breaking-changes release. The repo is still sub-1.0 so the version is
0.4.0 rather than 1.0.0, but the breakage is real — this changeset is
paired with the servers
`update-data-models` migration (alembic revision `043`) that locks the
**identity ↔ mailbox ↔ tunnel** triad into a strict 1:1:1 invariant.
The handle is now globally unique across all orgs and shares its
namespace with `tunnel_name`.

### Removed

- `tunnels.create()`, `tunnels.delete()`, `tunnels.restore()`,
  `tunnels.forceDelete()` / `force_delete()`, and
  `tunnels.rotateSecret()` / `rotate_secret()` — tunnels are
  provisioned atomically by identity-create and removed by
  identity-delete (cascade).
- `mailboxes.create()` and `mailboxes.delete()` — same reason.
- `AgentIdentity.createMailbox()` / `create_mailbox()`,
  `assignMailbox()` / `assign_mailbox()`, and `unlinkMailbox()` /
  `unlink_mailbox()`. The 1:1 invariant makes "rebind a different
  mailbox to this identity" meaningless.
- `IdentitiesResource.assignMailbox()` / `assign_mailbox()` and
  `unlinkMailbox()` / `unlink_mailbox()`. Same.
- `CLI: inkbox identity assign-mailbox` and `inkbox identity
  unlink-mailbox` subcommands.
- `CLI: inkbox mailbox create` and `inkbox mailbox delete` subcommands.
- `CLI: --display-name` flag from `inkbox mailbox update` (use
  `inkbox identity update --display-name` instead — the mailbox PATCH
  endpoint hard-rejects `display_name` with a 422 now).
- `TunnelStatus.PENDING_REMOVAL` enum value — migration 043 step 6a
  drops the underlying `delete_pending` value from the server enum.
- `Tunnel.restoreDeadlineAt` / `restore_deadline_at` field — gone from
  the server's `TunnelResponse`.
- `Tunnel.description` / `description` field, the `description` kwarg
  on `tunnels.update()`, the nested `tunnel.description` /
  `tunnel.description` field on `createIdentity()` /
  `create_identity()`, and the `--tunnel-description` flag on
  `inkbox identity create` and `inkbox tunnel update --description`.
  The column was dropped server-side; use the identity-level
  `description` field instead under the 1:1:1 invariant.
- `CreatedTunnel`, `RotatedSecret`, and their raw / parsed forms.
- `TunnelNameUnavailable` exception — replaced by the unified
  `HandleUnavailableError` (see Added).
- `TunnelSecretUnavailable` and the legacy "rotate via rotateSecret"
  recovery flow.
- The per-tunnel `connect_secret` field on `state.json`. Pre-0.4.0 SDKs
  that wrote one are forward-compatible (the field is ignored on read).
- The `createMailbox` boolean flag on `CreateIdentityOptions` —
  mailbox is always created.
- Mailbox `displayName` / `display_name` — the field has moved to the
  identity.

### Added

- `inkbox.createIdentity(handle, opts)` / `inkbox.create_identity(...)`
  now atomically provisions the linked mailbox and tunnel. Both come
  back on the response (`identity.mailbox`, `identity.tunnel`); a
  follow-up `getIdentity()` is no longer needed.
- Identity-level `displayName` / `display_name` field. Settable on
  create and via PATCH; defaults server-side to the agent handle.
- Identity-level `description` / `description` field. Free-form
  org-internal text (never surfaces in outbound mail). Settable on
  create and via PATCH with omit-vs-explicit-null semantics:
  omit the key → leave untouched; pass `null` → clear; pass a string →
  set/replace.
- `IdentitiesResource.update()` / `identity.update()` grow to
  `{ newHandle?, displayName?, description?, status? }`.
- Nested `tunnel: { tlsMode? }` on `CreateIdentityOptions`. TLS mode is
  fixed at create time — switching requires `identity.delete()` +
  recreating.
- `AgentIdentity.tunnel` / `identity.tunnel` getter, parallel to
  `mailbox` and `phoneNumber`.
- `validateAgentHandle` / `validate_agent_handle` (alias of the
  tunnel-name validator, since the namespace is unified).
- Local reserved-name + `@`-prefix-strip + lowercase normalization in
  the SDK validator, matching the canonical server-side rules.
- `HandleUnavailableError(blockingNamespace=…)` /
  `HandleUnavailableError(blocking_namespace=...)`. Maps the 409 from
  identity-create / rename; `blockingNamespace` ∈
  `{"identities", "tunnels", "mail"}` reports which side of the
  unified namespace rejected.
- New `inkbox tunnel` CLI subcommand: `list`, `get <id-or-handle>`,
  `update <id> [--metadata …]`, `sign-csr <id> --csr <path-or-pem>
  [--out <path>]`.
- New `inkbox identity create` flags: `--display-name`,
  `--description`, `--email-local-part`, `--tls-mode edge|passthrough`.
- New `inkbox identity update` flags: `--display-name`,
  `--description`, `--clear-description`, `--status active|paused`.
- `examples/use-inkbox-cli/05-tunnel-edge.sh` and
  `06-tunnel-passthrough.sh` (full provisioning + sign-CSR walkthroughs).
- Response fields that the SDK was previously silently dropping are now
  surfaced: `IdentityMailbox.webhookUrl` / `webhook_url`,
  `IdentityPhoneNumber.incomingCallWebhookUrl` /
  `incoming_call_webhook_url`, and `state` on both `PhoneNumber` and
  `IdentityPhoneNumber` (2-letter US state abbreviation for LOCAL
  numbers; `null` for toll-free). The `state` field is also included in
  `inkbox number get` JSON output.

### Changed

- **Tunnel data-plane authentication.** The agent runtime now sends
  `X-API-Key` (the same API key the client was constructed with)
  instead of `X-Tunnel-Secret`. Identity-scoped keys may connect their
  own tunnel; admin-scoped keys in the org may connect any tunnel.
  To rotate access, rotate the API key
  (`inkbox.apiKeys.create(...)` + revoke old).
- `tunnels.connect()` / `inkbox.tunnels.connect(...)` no longer
  accepts `tls_mode`, `secret`, or `on_pending_removal` kwargs —
  tunnels must already exist (provisioned via `createIdentity`), and
  TLS mode is set at create time.
- `tunnels.update()` is now metadata-only. The `description` column
  was dropped from `tunnels` (subsumed by the identity-level
  `description` field under the 1:1:1 invariant).
- `Tunnel.publicHost` / `public_host` and `Tunnel.zone` / `zone` are
  non-nullable (the parser throws if missing).
- `TunnelStatus` is now exactly `awaiting_cert` / `active` / `deleted`.
- `state.json` schema drops the `connect_secret` field; the data-plane
  reads the API key from the parent `Inkbox` client now.
- `MailboxesResource.update()` accepts only `webhookUrl` / `webhook_url`
  and `filterMode` / `filter_mode`. Sending `display_name` is now a
  hard 422 (route's `extra='forbid'` validator).
- Identity-delete cascades to the linked mailbox and tunnel and
  revokes any identity-scoped API keys.
- `agent_handle` is globally unique across all orgs and shares its
  namespace with `tunnel_name`.

### Migration notes

- Agents bootstrapping fresh: `inkbox.createIdentity(handle, { tunnel:
  { tlsMode: "passthrough" } })` to get both the identity-with-tunnel
  in one call, then `inkbox.apiKeys.create({ scopedIdentityId })` to
  mint the per-agent data-plane key.
- Callers that previously did `inkbox.tunnels.create(...)` + persisted
  the `connect_secret`: drop both steps. Provision the tunnel as part
  of `createIdentity`; revoke / rotate via API-key rotation.
- Tests that asserted on `x-tunnel-secret`: flip to `x-api-key`.
- Console / UI surfaces (out of scope here) that rendered `mailbox.display_name`
  must read `identity.display_name` instead.

## 0.3.2 and earlier

See git history (commits before `update-data-models` merged).

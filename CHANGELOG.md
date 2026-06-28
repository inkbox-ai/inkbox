# Changelog

All notable changes to the Inkbox SDK, CLI, and skills live here.
Versions move in lockstep across `@inkbox/sdk` (TypeScript), `inkbox`
(Python), and `@inkbox/cli`.

## 0.4.13 — Webhook event id

### Added

- **Stable per-event `id` on webhook payloads** in the TypeScript, Python, and Rust SDKs. The mail / text / iMessage webhook envelopes now carry a top-level `id` (`evt_...`) — a stable idempotency key that is the same across the original delivery and any retries or replays. Dedupe on it instead of the per-delivery `X-Inkbox-Request-ID` header. (Incoming-call payloads are flat and keep their own call `id`.)

## 0.4.12 — Tunnel DX

### Added

- **Config-file / env auth resolution** in the TypeScript, Python, and Rust SDKs, plus the CLI. `api_key` / `base_url` / `vault_key` resolve from the explicit argument, then the matching env var (`INKBOX_API_KEY` / `INKBOX_BASE_URL` / `INKBOX_VAULT_KEY`), then a `~/.inkbox/config` file — so `Inkbox()` / `new Inkbox()` / `Inkbox::from_env()` work without an explicit key in background/agent processes that don't inherit the shell's env.
- **Tunnel status callback in the Rust SDK** — `tunnels().connect_with_status(name, forward_to, on_status)` reports `"connecting"` / `"connected"` / `"reconnecting"` / `"closed"`, at parity with the Python/TypeScript `on_status`.
- **`currentlyConnected` column** on `inkbox tunnel list` in the CLI.

### Fixed

- **macOS TLS verification** in the Python SDK: the tunnel data plane falls back to certifi's CA bundle when the system trust store is empty (the python.org installer case), avoiding `SSL: CERTIFICATE_VERIFY_FAILED`.

## 0.4.11 — Reply all

### Added

- **Email reply-all helpers** in the TypeScript, Python, and Rust SDKs, plus `inkbox email reply-all <message-id>` in the CLI. Recipients are resolved by the API from the source message.
  - Rust SDK: `messages().reply_all(...)` and `AgentIdentity::reply_all_email(...)`, at parity with the Python and TypeScript SDKs.
- **`reply_all_recipients` on the message detail** in the TypeScript, Python, and Rust SDKs. The server's suggested To/Cc for a reply-all (sending mailbox and BCC excluded), for prefilling UIs.

## 0.4.10 — Agent harness

### Added

- **Optional `harness` on agent self-signup** across all four packages. Agents may pass a `harness` identifier (e.g. the agent runtime they run under) when signing up (free-form string; unknown values accepted). When a plugin exists for the harness, post-verification guidance is folded into the verify response's `message`.
  - TypeScript / Python: optional `harness` argument on the signup helper.
  - CLI: `inkbox signup` gains a `--harness <harness>` flag.
  - Rust SDK: `Inkbox::signup` gains an `Option<&str>` `harness` parameter — at parity with the Python and TypeScript SDKs.

### Fixed

- **Rust SDK: decode `whoami` timestamps as ISO-8601 strings.** `created_at` / `last_used_at` / `expires_at` on the API-key whoami response are now `Option<String>` (tolerating a legacy epoch number), replacing an `Option<f64>` typing that failed to deserialize the server's string timestamps.

## 0.4.9 — Rust SDK

### Added

- **Rust SDK** (`sdk/rust`, crate `inkbox`). A faithful port of the Python and TypeScript SDKs: mail, phone, iMessage, contacts, notes, identities, the encrypted vault (Argon2id + AES-256-GCM + TOTP), API keys, webhook payload types + HMAC signature verification, agent signup, whoami, and the tunnels control plane. The public surface is blocking (`reqwest::blocking`) to match the synchronous Python/TS APIs; wire shapes are identical across all three SDKs. The tunnels data-plane runtime (h2/TLS data plane + P-256 PKCS#10 CSR) lives behind the optional `tunnels-runtime` feature. The encrypted vault and the passthrough tunnel data plane are live-validated end-to-end against production.

### Changed

- **Phone-number provisioning now defaults to `local`.** Across all three SDKs, `provision()` / `provision_phone_number()` and identity-creation now default the number `type` to `"local"` (previously `"toll_free"`). This matches the server, which has retired toll-free provisioning and rejects `type: "toll_free"` with HTTP 422. Toll-free is no longer referenced in method signatures, docstrings, type comments, or READMEs. The previous `"toll_free"` default sent a value the server now rejects, so this fixes default `provision()` calls.

## 0.4.8 — graceful tunnel reconnect on redeploy

### Added

- **Make-before-break tunnel reconnect** in both SDKs. When the tunnel server signals a graceful drain (a NO_ERROR `GOAWAY`) during a redeploy, the client opens a new persistent connection and parks a fresh intake pool **before** closing the draining one, instead of tearing down and reconnecting cold. In-flight HTTP webhook replies are posted on the new connection so they round-trip across the handoff. The handoff is in-band — it does not surface as a `reconnecting` status or wait out the backoff schedule.
- **Typed `server_draining` WebSocket close** (close code `4500`) when the draining connection drops a live WebSocket bridge, so handlers can reconnect promptly instead of seeing a generic reset:
  - TypeScript: the inbound stream throws `WsServerDraining` (a `WsClosed` subclass, `reconnectAdvised = true`). New exports from `@inkbox/sdk/tunnels/connect`: `WsServerDraining`, `SERVER_DRAINING_WS_CLOSE_CODE`.
  - Python: the ASGI handler receives a `websocket.disconnect` carrying close code `4500`.
- CLI: bundles `@inkbox/sdk` `0.4.8`; no CLI-visible behavior change — the CLI's tunnel commands are one-shot control-plane calls.

### Notes / limits

- In-progress WebSocket and passthrough-TCP sessions **cannot** migrate across a redeploy — the third-party socket lives on the dying task. The client surfaces a clean typed close and reconnects fast; the third-party peer reconnects onto the new task. Idempotent reconnect is the right client pattern.

## 0.4.7 — iMessage

### Added

- **iMessage surface** across all three packages, riding the shared Inkbox iMessage router (recipients connect by texting `connect @<handle>` to the router number; no cold outreach):
  - TypeScript: `inkbox.imessages` + `inkbox.imessageContactRules` resources, and identity helpers `sendIMessage`, `listIMessages`, `listIMessageConversations`, `listIMessageAssignments`, `sendIMessageReaction`, `markIMessageConversationRead`, `sendIMessageTyping`, `uploadIMessageMedia`.
  - Python: `inkbox.imessages` + `inkbox.imessage_contact_rules` resources, and the matching `identity.*_imessage_*` helpers.
  - CLI: the `inkbox imessage` command group — `triage-number`, `send`, `list`, `assignments`, `conversations`, `conversation`, `react`, `mark-conversation-read`, `typing`, `upload-media`, and `contact-rule {list,create,update,delete,list-all}`.
- **Identity iMessage fields** — `imessage_enabled` / `imessageEnabled` on create and update, `imessage_filter_mode` / `imessageFilterMode` (admin-only) on update; both returned on reads.
- **Identity-owned webhook subscriptions** — `agent_identity_id` / `agentIdentityId` as the third subscription owner, carrying the five `imessage.*` events: `imessage.received`, `imessage.reaction_received`, `imessage.sent`, `imessage.delivered`, `imessage.delivery_failed`. Typed wire shapes for the iMessage envelope ship in both SDKs.
- **Tapbacks** — send the classic six (`custom` is inbound-only and rejected with 422); one live tapback per sender per message part, replace-on-resend. Message reads carry a `reactions` array including inbound custom-emoji tapbacks.
- **Connection state** — conversations carry `assignment_status` / `assignmentStatus` (`active` / `released`); `GET /assignments` lists currently connected recipients.

## 0.4.6 — webhook subscriptions refactor

### Breaking

- **Per-resource webhook URLs are gone for mail and phone-text events.** `Mailbox.webhook_url` / `webhookUrl` and `PhoneNumber.incoming_text_webhook_url` / `incomingTextWebhookUrl` were removed from every SDK type, builder, request body, and CLI flag. Sending the legacy fields server-side returns 422. Replace each with a row on the new `webhooks.subscriptions` resource.
- **Phone-text and inbound-call webhook payloads — `contact` (singular) → `contacts` (plural) + new `agent_identities` list.** Always-present lists; both default to `[]` when nothing matches.

### Added

- **Webhook subscriptions resource** — full CRUD over `/webhooks/subscriptions`:
  - TypeScript: `inkbox.webhooks.subscriptions.{list,get,create,update,delete}`.
  - Python: `inkbox.webhooks.subscriptions.{list,get,create,update,delete}`.
  - CLI: `inkbox webhook subscription {list,get,create,update,delete}` with a repeatable `--event-type`.
  Each subscription names exactly one owner (mailbox **or** phone number), one HTTPS destination URL, and a non-empty subset of the catalog's event types. Multiple subscriptions on the same owner fan out independently. `phone.incoming_call` is intentionally not subscribable; that URL stays on the phone number's `incomingCallWebhookUrl` because its response body controls call routing. The SDK runs structural + prefix validation client-side (exactly-one FK, non-empty distinct events, no `phone.incoming_call`, `message.` / `text.` prefix matching the owner's channel) so most shape mistakes surface as a thrown error rather than 422 round-trips. The server remains authoritative for the exact event-name enum, so a typo with a valid prefix (e.g. `message.received_typo`) passes the SDK's check and is rejected as 422 by the server.
- **`WebhookAgentIdentity`, `WebhookMailAgentIdentity`** exported types covering identity matches on mail / text / call payloads.
- Mail webhook payloads gained `data.agent_identities` alongside existing `data.contacts`.

## 0.4.5

### Added

- **Conversation-centric text messaging support** across both SDKs,
  CLI, and skills. Existing one-to-one methods remain valid, while
  group-aware callers can now send to multiple recipients, include MMS
  media URLs, reply into existing conversations with `conversation_id` /
  `conversationId` / `--conversation-id`, list group conversations with
  `include_groups` / `includeGroups` / `--include-groups`, and use
  conversation UUIDs anywhere a remote-number conversation key was
  accepted.
- Text message responses now surface additive group fields:
  `conversation_id` / `conversationId`, `sender_phone_number` /
  `senderPhoneNumber`, and per-recipient delivery rows in
  `recipients`. Legacy `remote_phone_number` remains populated for
  one-to-one traffic and is `null` for group outbound rows.
- Conversation summaries now include `latest_has_media` / `latestHasMedia`
  so clients can distinguish actual attachments from carrier-level MMS
  protocol labels.
- **TypeScript users:** group rows can legitimately have no single remote
  party, so `remotePhoneNumber` / `remote_phone_number` is now typed as
  `string | null` on text messages, conversation summaries, webhook
  messages, raw wire types, and conversation update results.

- **Identity visibility controls** — manage which agent identities can see
  a given identity in API responses.
  - SDK: new `IdentityAccess` type plus `listAccess` / `grantAccess` /
    `revokeAccess` (TypeScript) and `list_access` / `grant_access` /
    `revoke_access` (Python) on both `IdentitiesResource` and
    `AgentIdentity`. `grantAccess(viewerIdentityId)` adds a per-viewer
    grant; `grantAccess(null)` resets the target to the org-wide wildcard
    (every active identity sees it). `revokeAccess(viewerIdentityId)`
    drops one viewer, keyed by the viewer identity's UUID.
  - CLI: new `inkbox identity access` group — `list`, `grant`,
    `grant-everyone`, and `revoke`. `grant` and `revoke` take a viewer
    **handle** and resolve it to a UUID automatically.
  - Granting a viewer against an already-wildcard target returns a 409
    (`RedundantContactAccessGrantError`); revoking a non-existent grant
    returns a 404 (`InkboxAPIError`).

## 0.4.2

### Added

- Typed receiver-side webhook payload models: `WebhookContact`,
  `WebhookMailContact`, `MailContactBucket`, `MailWebhookPayload`,
  `TextWebhookPayload`, and `PhoneIncomingCallWebhookPayload`, plus
  their event-type string unions and the supporting string-literal
  wire enums (`MessageStatus`, `MessageDirectionWire`,
  `TextDirectionWire`, `TextTypeWire`, `SmsDeliveryStatusWire`,
  `TextMessageOriginWire`, `CallStatusWire`, `HangupReasonWire`,
  `CallDirectionWire`) and snake_case nested wire shapes
  (`RawTextMediaItem`, `RawRateLimitInfo` on the TS side;
  `TextMediaItemWire`, `RateLimitInfoWire` on the Python side). Lets
  app code parse and narrow webhook bodies without hand-rolling
  shapes.
- New outbound-text webhook events on a phone number's
  `incoming_text_webhook_url`: `text.sent` (carrier accepted),
  `text.delivered`, `text.delivery_failed`, `text.delivery_unconfirmed`.
  Wrapped in the standard `{event_type, timestamp, data}` envelope
  alongside the existing `text.received`. Dispatch is fire-and-forget.
  `data.text_message` carries the full outbound lifecycle metadata
  (`delivery_status`, `error_code`, `error_detail`, `sent_at`,
  `delivered_at`, `failed_at`).
- Mail webhook payloads carry `data.contacts`, a list of per-recipient
  address-book matches scoped to the identity that owns the receiving
  mailbox. Inbound events resolve the sender plus every CC; outbound
  events resolve every To + CC + BCC. Each entry is
  `{ bucket: "from" | "to" | "cc" | "bcc", address, id, name }`; pair
  to the source field by `(bucket, address)` since the same address
  may legally appear in multiple buckets. List is always present,
  possibly empty.
- New `data.message.bcc_addresses: list[str] | null` on mail webhook
  payloads. Populated on outbound events; `null` on inbound (BCC is
  not visible to recipients).
- Phone and text webhook payloads carry `data.contact` (text) and a
  top-level `contact` (inbound call): singular `{ id, name } | null`
  for the single remote party, scoped to the identity that owns the
  receiving phone number; `null` when no visible address-book entry
  matches.

### Changed

- README + skill docs (TS, Python, openclaw, CLI) updated with the
  new event taxonomy and contact-resolution semantics.
- TS `texts.send()` / `agentIdentity.sendText()` and Python
  `texts.send()` / `agent_identity.send_text()` docstrings now
  enumerate the four outbound text lifecycle events and reference
  `TextWebhookEventType` / `TextWebhookPayload`.

## 0.4.1

### Added

- `inkbox.sms_opt_ins` / `inkbox.smsOptIns` — SMS opt-in / opt-out
  registry (per-(org, receiver) consent). `list()` / `get()` read the
  calling org's rows; `opt_in()` / `optIn()` and `opt_out()` /
  `optOut()` write, but require the org to be on its own actively-
  used 10DLC campaign (server returns 409 `customer_campaign_required`
  for default-campaign orgs). Writes record an audit event with
  `source=api`.
- New types: `SmsOptIn`, `SmsOptInStatus`, `SmsOptInSource`.
- CLI: `inkbox sms-opt-in {list, get, opt-in, opt-out}` — same surface
  as the SDKs, with `--status` / `--limit` / `--offset` filters on
  list and `--json` on every command. `--base-url` now also reads
  `INKBOX_BASE_URL` so the CLI can target dev/beta without threading
  the flag.

## 0.4.0

Breaking-changes release. The repo is still sub-1.0 so the version is
0.4.0 rather than 1.0.0, but the breakage is real — the
**identity ↔ mailbox ↔ tunnel** triad is now locked into a strict
1:1:1 invariant. The handle is globally unique across all orgs and
shares its namespace with `tunnel_name`.

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

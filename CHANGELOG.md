# Changelog

All notable changes to the Inkbox SDK, CLI, and skills live here.
Versions move in lockstep across `@inkbox/sdk` (TypeScript), `inkbox`
(Python), `@inkbox/cli`, and `inkbox` (Rust, crates.io).

## 0.4.18 — One live client per tunnel

### Changed

- **A tunnel keeps a single live client; a newer client takes over.** When another client connects to the same tunnel, the earlier client now stops and does **not** reconnect — previously it would redial, and two clients on one tunnel could bounce back and forth. Run one client per tunnel; for redundancy, use separate identities. The runtime reports a new `"superseded"` status through the status callback (`onStatus` / `on_status`) and ends with a distinct terminal outcome instead of retrying: TypeScript throws `TunnelSupersededError`, Python stops out of `serve()` / `wait()`, and Rust returns a terminal `Err` from `serve_forever`. A normal server redeploy still reconnects seamlessly, unchanged.

### Added

- **`TunnelSupersededError`** (TypeScript) exported from the tunnels client alongside `TunnelAuthError`, thrown when another client takes over the tunnel — so an embedding app can notice, e.g., that an accidental second instance on the same identity went dark.

## 0.4.17 — Inline images, CLI attachments, and mark-unread

### Added

- **Inline images.** Attachment entries on `messages.send(...)` / `reply_all(...)` (and the identity `send_email` / `reply_all_email`) accept `content_id` (TS `contentId`; Rust `Attachment.content_id`). A part with `content_id` renders inline in the HTML body — reference it as `cid:<content_id>` (e.g. `<img src="cid:chart1">`) — instead of as a download, and is not counted in `has_attachments`. Requires `body_html`, an `image/*` `content_type`, and a unique id per send (else 422). Not supported on forwards (`additional_attachments`) — 422. CLI: `--inline-image <cid=path>` on `email send` / `email reply-all` (requires `--body-html`; repeatable).
- **`mark_emails_unread`** (TS `markEmailsUnread`) on the identity across the TypeScript, Python, and Rust SDKs — the batch counterpart to `mark_emails_read`. CLI: `email mark-unread <message-ids...>`.
- **CLI attachments.** `email send` / `email reply-all` / `email forward` gain `--attach <path>` (repeatable) to attach files; the content type is inferred from the file extension. `email download-attachment <message-id> <filename>` returns a time-limited download URL for a stored attachment.

### Changed

- **Rust `Attachment` gains a `content_id` field.** This is source-breaking for code that builds `Attachment` with a struct literal; add `content_id: None` or use `..Default::default()`. The Python dict and TypeScript object attachment shapes are additive and unaffected.

## 0.4.16 — Configurable webhook context + open tracking

### Added

- **Conversation-context webhooks.** Webhook subscriptions gain an optional per-class `context_config` (TS `contextConfig`) — `email` / `texts` / `calls`, each `{"mode": "count", "count": N}` (1..50) or `{"mode": "window", "hours": H}` (1..168) — on `create` and `update` (tri-state on update: omit = unchanged, `null` = clear, object = replace). Received events (`message.received`, `text.received`, `imessage.received`) then deliver the matching history under `data.context`, keyed by class. New types: Python `WebhookContextConfig` / `WebhookContextClassConfig` plus receiver wire shapes `WebhookContextWire` / `WebhookContextBlockWire` / `WebhookTranscriptEntryWire` (…); TS `WebhookContextConfig` / `WebhookContextClassConfig` / `WebhookContext` / `WebhookContextBlock` / `WebhookTranscriptEntry` (…). Discriminate transcript entries on `"marker" in entry`. CLI: `--context-email` / `--context-texts` / `--context-calls <count:N|window:H>` on `webhook subscription create` / `update`, plus `--clear-context` on `update`.
- **Open tracking.** `messages.send(...)` / `forward(...)` and the identity `send_email` / `forward_email` accept `track_opens` (TS `trackOpens`) to embed a tracking pixel. A plain-text send with `track_opens` (TS `trackOpens`) is rejected with 422; forwards need HTML on the outgoing message — inline forwards inherit the original's HTML (no caller body needed), wrapped forwards need one. Opens surface on the returned message as `first_opened_at` / `open_count` (TS `firstOpenedAt` / `openCount`); `open_count` is approximate (biased both ways — proxy prefetch inflates it, the per-window debounce collapses repeats), so prefer `first_opened_at`. Pixels can raise spam scores. CLI: `--track-opens` on `email send` (requires `--body-html`) and `email forward` (inline forwards reuse the original's HTML).

### Changed

- **`messages.get` marks inbound messages read.** Fetching a single inbound message by id with an API key now flips `is_read` / `isRead` server-side; list, thread, and attachment routes do not. `mark_read` / `markRead` remains for list-only workflows. `is_read` (agent consumed via API) is distinct from `first_opened_at` (recipient's client loaded the tracking pixel).

## 0.4.15 — Identity-centered calls + shared iMessage-line calling

### Added

- **Shared iMessage-line calls** in the TypeScript, Python, and Rust SDKs. `calls.place(...)` gains `origination` (`dedicated_number`, the default, or `shared_imessage_number`) and `agent_identity_id`. For shared origination the agent supplies only the recipient — the line is resolved server-side from the identity's active iMessage assignment (409 `no_shared_connection` when there is none), and the returned call's `local_phone_number` is `null` (the shared line is never surfaced). Also on the identity object: `identity.place_call(origination=...)`.
- **Identity-scoped call reads.** `calls.list(...)` is keyed by `agent_identity_id` (agent-scoped keys resolve their own) and returns calls across both origins — dedicated numbers past and present plus shared iMessage lines. `calls.get(call_id)` and `calls.transcripts(call_id)` address calls of either origin.
- **Incoming-call config resource.** `inkbox.incoming_call_action.get()/set(...)` (TS `incomingCallAction`, Rust `incoming_call_action()`) reads/writes the identity's inbound-call behavior (`auto_accept` / `auto_reject` / `webhook` + `client_websocket_url` / `incoming_call_webhook_url`), with `identity.get_incoming_call_action()` / `set_incoming_call_action()` delegators. Works for identities with no dedicated number.
- **`origin` on `PhoneCall`** — `"dedicated_number"` or `"shared_imessage_number"`; missing/null parses as `dedicated_number` for back-compat.

### Changed

- **`PhoneCall.local_phone_number` is now nullable** — `null` on shared-origin calls (Rust: `Option<String>`).
- **`calls.place(...)` signature** — `from_number` is required only for `dedicated_number` origination and must be omitted for shared.
- CLI pins `@inkbox/sdk` at `^0.4.15`.

### Removed

- **The standalone transcripts resource** (`inkbox.transcripts`) — transcripts are read via `calls.transcripts(call_id)`.
- **The number-scoped call/transcript methods** (`phone_number_id`-keyed list/get) — replaced by the identity-scoped surface above. The old server routes still work but are deprecated; the SDKs no longer call them. **Source-breaking** for consumers upgrading within `^0.4` — see the migration notes in the PR.

## 0.4.14 — Identity-scoped contact rules + per-identity signing keys

### Added

- **Identity-keyed mail + phone contact rules** in the TypeScript, Python, and Rust SDKs, plus the CLI. Mail and phone contact rules are now addressed by **agent handle** (mirroring iMessage), with the rule shape keyed by `agent_identity_id`.
  - SDKs: `inkbox.mail_identity_contact_rules` / `inkbox.phone_identity_contact_rules` (TS `mailIdentityContactRules` / `phoneIdentityContactRules`), each with `list/get/create/update/delete` keyed by `agent_handle` and an org-wide `list_all` filtered by `agent_identity_id`. Also surfaced as `identity.list_mail_contact_rules()` / `create_mail_contact_rule()` / … and the phone equivalents on the identity object (phone helpers require the identity to have a phone number). New types `MailIdentityContactRule` / `PhoneIdentityContactRule`.
  - CLI: `inkbox identity mail-rules [list|list-all|get|create|update|delete]` and `inkbox identity phone-rules [...]`.
- **Per-identity contact-rule filter mode.** `mail_filter_mode` / `phone_filter_mode` now live on the agent identity (alongside `imessage_filter_mode`) and are set via `identity.update(mail_filter_mode=…, phone_filter_mode=…)` (CLI `inkbox identity update --mail-filter-mode / --phone-filter-mode`). Unlike the deprecated channel update, the identity update does not return a `FilterModeChangeNotice`. `phone_filter_mode` requires the identity to have a phone number.
- **Per-identity webhook signing keys** in the TypeScript, Python, and Rust SDKs, plus the CLI. Each agent identity has its own signing key.
  - SDKs: `inkbox.signing_keys.create_or_rotate(agent_handle)` / `get_status(agent_handle)` and `identity.create_signing_key()` / `identity.get_signing_key_status()`, returning `SigningKey` / the new `SigningKeyStatus`.
  - CLI: `inkbox identity signing-key status <handle>` / `rotate <handle>`.
  - The **first webhook subscription** created for a keyless identity returns that identity's signing secret **once** — `inkbox.webhooks.subscriptions.create(...)` now returns a `WebhookSubscriptionCreateResponse` carrying an optional once-shown `signing_key`.
- **`owner_identity_id` on webhook subscriptions** — the resolved owning agent identity for every subscription (mail/phone/iMessage), parsed by the SDKs (optional/back-compatible).

### Deprecated

- The per-mailbox `inkbox.mail_contact_rules` / per-number `inkbox.phone_contact_rules` resources and the CLI `inkbox mailbox rules` / `inkbox number rules` groups — use the identity-keyed surface above. They still work but hit deprecated server routes (Sunset 2026-08-31).
- The org-level signing key (`inkbox.create_signing_key()` / no-arg `signing_keys.create_or_rotate()`, CLI `inkbox signing-key create`) — use the per-identity surface. With an agent-scoped key the org-level call still rotates that identity's key; with an admin key the server returns 409.

## 0.4.13 — Webhook delivery log + event id

### Added

- **Webhook delivery log + manual replay** in the TypeScript, Python, and Rust SDKs, plus the CLI. Every outbound webhook attempt is logged with its signed request body, the endpoint's response (or transport error), timing, and a replay flag.
  - SDKs: `inkbox.webhooks.deliveries.list(...)` / `.replay(deliveryId)` (Python `inkbox.webhooks.deliveries`, Rust `inkbox.webhooks().deliveries()`), returning the new `WebhookDelivery` type. `list` filters on subscription, phone number, event type, and 2xx success, with `limit` / `offset` paging.
  - CLI: `inkbox webhook delivery list` (with `--subscription-id` / `--phone-number-id` / `--event-type` / `--success` / `--failed` / `--limit` / `--offset`) and `inkbox webhook delivery replay <delivery-id>`.
  - Replay reuses the original envelope `event_id`, so a compliant endpoint dedupes a replay it already processed — it recovers a miss rather than forcing reprocessing. Incoming-call deliveries are logged but not replayable.
- **Stable per-event `id` on webhook payloads** in the TypeScript, Python, and Rust SDKs. The mail / text / iMessage webhook envelopes now carry a top-level `id` (`evt_...`) — a stable idempotency key that is the same across the original delivery and any retries or replays. Dedupe on it instead of the per-delivery `X-Inkbox-Request-ID` header. (Incoming-call payloads are flat and keep their own call `id`.) The Rust field is `#[serde(default)]`, so a payload without `id` parses to `""` rather than failing; the TypeScript and Python types are compile-time-only and already tolerant.

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

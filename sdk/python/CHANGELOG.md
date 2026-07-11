# Changelog

## 0.4.22 — Hosted call agent

### Added

- **Hosted call mode.** `calls.place(...)` and `identity.place_call(...)` accept keyword-only `mode` (`CallMode.CLIENT_WEBSOCKET`, the default, or `CallMode.HOSTED_AGENT` — the platform-run voice agent drives the call, no WebSocket needed) and `reason` (the hosted agent's task brief; required with `mode=hosted_agent`, invalid otherwise). Nothing is client-gated — server 422s/503s (`hosted_agent_at_capacity`, `hosted_agent_unavailable`) surface verbatim. `PhoneCall` gains `mode` (older responses default to `"client_websocket"`) and `reason` (nullable).
- **`IncomingCallAction.HOSTED_AGENT`.** The hosted agent answers inbound calls; the only action needing neither `client_websocket_url` nor `incoming_call_webhook_url`. Accepted by `incoming_call_action.set(...)` / `identity.set_incoming_call_action(...)` URL-less.
- **Hosted agent config.** `inkbox.hosted_agent.get_config(agent_identity_id=None)` / `set_config(voice=None, model=None, instructions=None, agent_identity_id=None)` (`GET`/`PUT /phone/hosted-agent-config`; full-replace PUT — a field left `None` resets to the server default). New `HostedAgentConfig` type. Identity delegators `identity.get_hosted_agent_config()` / `set_hosted_agent_config(...)`.
- **Post-call action items.** `PhoneCall` gains `post_call_action_items` — the hosted agent's recorded action items surfaced inline on every call response (`seq`-ascending, open items only; canceled items are withdrawn). Empty for `client_websocket` calls and hosted calls with no open items. New slim `PostCallActionItem` type: `id`, `seq`, `action`, `details`, `status` (`"open"`). Mirrors the `call.ended` webhook.
- **`call.ended` receiver types.** `WebhookPhoneCall` gains `mode` / `reason` (on `data["call"]`); `CallEndedWebhookData` gains `outcome` (`"completed"|"no_answer"|"declined"|"failed"`, `None` iff client-driven) and `post_call_action_items` (open items only). All `NotRequired` — pre-hosted payloads parse unchanged. New exports: `CallModeWire`, `CallOutcomeWire`, `WebhookPostCallActionItemWire`.

## 0.4.20 — Date-range filters, call.ended receivers, external hangup, spam-filter status

### Added

- **Date-range filters.** `messages.list(...)` / `identity.iter_emails(...)` (and `iter_unread_emails`), `calls.list(...)` / `identity.list_calls(...)`, `texts.list(...)` / `identity.list_texts(...)`, `texts.list_conversations(...)` / `identity.list_text_conversations(...)`, `imessages.list(...)` / `identity.list_imessages(...)`, and `imessages.list_conversations(...)` / `identity.list_imessage_conversations(...)` accept keyword-only `start_datetime` / `end_datetime` / `tz` (all `str | None = None`). They filter on the resource's `created_at`: bare dates resolve to calendar days in `tz` (default UTC) with `end_datetime` whole-day inclusive; datetimes with an explicit `Z`/offset are exact instants (`tz` ignored); naive datetimes are interpreted in `tz`. Params are sent only when non-`None`, so omitting all three preserves current behavior exactly (no filtering; ordering and pagination unchanged). The server owns resolution.
- **`call.ended` webhook receivers + external hangup.** New receiver types `CallEndedWebhookPayload` / `CallEndedWebhookData` / `WebhookPhoneCall` / `WebhookCallTranscript` / `CallLifecycleWebhookEventType` / `CallOriginWire`; `webhooks.subscriptions.create(...)` accepts `call.ended` on an `agent_identity_id` owner; `calls.hangup(call_id)` and `identity.hangup_call(call_id)` end a live call from outside it (`POST /phone/calls/{id}/hangup`; already-ended calls surface the server's 409).

### Fixed

- **`SmsDeliveryStatus` gains `blocked_spam_filter`.** Stored rows blocked pre-carrier by the outbound spam filter crashed `texts.list` / `texts.get` hydration (`ValueError`); the enum now carries the variant. It appears on stored rows only — delivery webhooks never fire for blocked sends.


## 0.4.16 — Configurable webhook context + open tracking

### Added

- **Conversation-context webhooks.** `webhooks.subscriptions.create(...)` / `update(...)` accept `context_config` — per class (`email` / `texts` / `calls`) a `{"mode": "count", "count": N}` (1..50) or `{"mode": "window", "hours": H}` (1..168). `update` is tri-state (omit = unchanged, `None` = clear, dict = replace). Received events carry the history under `data["context"]`. New exports: `WebhookContextConfig`, `WebhookContextClassConfig`, and the receiver wire shapes `WebhookContextWire`, `WebhookContextBlockWire`, `WebhookTranscriptEntryWire` (discriminate transcript entries on `"marker" in entry`), plus the item wire types; `data["context"]` is optional on `MailWebhookData` / `TextWebhookData` / `IMessageWebhookData`.
- **Open tracking.** `messages.send(...)` / `forward(...)` and `identity.send_email(...)` / `forward_email(...)` accept `track_opens`. A plain-text `track_opens` send is rejected with 422; forwards need HTML on the outgoing message (inline forwards inherit the original's HTML, wrapped forwards need a caller body). `Message` gains `first_opened_at` and `open_count` (approximate/biased both ways — prefer `first_opened_at`; pixels can raise spam scores).

### Changed

- **`messages.get` marks inbound messages read.** Fetching a single inbound message by id with an API key now flips `is_read` server-side; list, thread, and attachment routes do not. `mark_read` remains for list-only workflows. `is_read` (agent consumed via API) is distinct from `first_opened_at` (recipient's client loaded the tracking pixel).

## 0.4.12 — Tunnel DX

### Added

- **Config-file / env auth resolution.** `Inkbox()` resolves `api_key` / `base_url` / `vault_key` from the argument, then the env var, then `~/.inkbox/config` — so it works with no explicit key in background/agent processes.

### Fixed

- **macOS TLS verification.** The tunnel data plane falls back to certifi's CA bundle when the system trust store is empty (the python.org installer case), avoiding `SSL: CERTIFICATE_VERIFY_FAILED`.

## 0.4.11 — Reply all

### Added

- **Email reply-all helpers.** `messages.reply_all(...)` and `identity.reply_all_email(...)` call the mailbox reply-all endpoint, with server-resolved recipients and optional subject/body/attachment fields.

## 0.4.10 — Agent harness

### Added

- **Optional `harness` on agent self-signup.** `Inkbox.signup(...)` accepts a `harness` keyword identifying the agent harness/runtime (free-form string; unknown values accepted). When a plugin exists for the harness, post-verification guidance is folded into the verify response's `message`.

## 0.4.8 — graceful tunnel reconnect on redeploy

### Added

- **Make-before-break tunnel reconnect.** When the tunnel server signals a graceful drain (a NO_ERROR `GOAWAY`) during a redeploy, the client now opens a new persistent connection and parks a fresh intake pool **before** closing the draining one, instead of tearing down and reconnecting cold. In-flight HTTP webhook replies are posted on the new connection so they round-trip across the handoff. The reconnect is in-band — it does not surface as a `reconnecting` status or wait out the backoff schedule.
- **Typed `server_draining` WebSocket close.** When the draining connection drops a live WebSocket bridge, the handler now receives a `websocket.disconnect` carrying close code `4500` (the `server_draining` code) instead of a generic reset, so it can reconnect promptly.

### Notes / limits

- In-progress WebSocket and passthrough-TCP sessions **cannot** migrate across a redeploy — the third-party socket lives on the dying task, and the client's HTTP/2 connection closes the moment it receives the `GOAWAY`. The client surfaces a clean typed close and reconnects fast; the third-party peer reconnects onto the new task. Idempotent reconnect is the right client pattern.

## 0.4.6 — webhook subscriptions refactor

### Breaking

- **`Mailbox.webhook_url` removed.** Mailbox PATCH no longer accepts `webhook_url`; sending it returns 422. Migration: create a `webhooks.subscriptions` row for each mailbox that needs delivery (see Added below).
- **`PhoneNumber.incoming_text_webhook_url` removed** from every shape that carried it (`PhoneNumber`, `IdentityPhoneNumber`, `IdentityPhoneNumberCreateOptions`, `phone_numbers.update`, `phone_numbers.provision`, identity-create's nested `phone_number`). Sending it returns 422 server-side. Replace with a `text.*` subscription on the phone number.
- **Phone-text webhook payload — `data["contact"]` → `data["contacts"]` + `data["agent_identities"]`.** `contact` is gone. `contacts` is always a list (possibly empty); `agent_identities` is a new always-present list of matched agent identities.
- **Inbound-call webhook payload — top-level `contact` → `contacts` + `agent_identities`.** Same shape swap at the top level of the flat payload.
- **Mail webhook payload — `data["agent_identities"]` is now required on the wire** alongside the existing `data["contacts"]` (both default `[]`). Receivers that did strict shape checks will see a new key.

### Added

- **`inkbox.webhooks.subscriptions` resource** — full CRUD for the new `/webhooks/subscriptions` endpoint surface. `list`, `get`, `create`, `update`, `delete`. The SDK runs structural + prefix validation client-side (exactly-one FK, non-empty distinct events, no `phone.incoming_call`, `message.` / `text.` prefix matching the owner's channel) so most shape mistakes surface as `ValueError` rather than 422 round-trips. The server remains authoritative for the exact event-name enum, so a typo with a valid prefix (e.g. `message.received_typo`) passes the SDK's check and is rejected as 422 by the server. New exports: `WebhookSubscription`, `WebhookSubscriptionsResource`, `WebhookSubscriptionStatus`.
- **`WebhookAgentIdentity` / `WebhookMailAgentIdentity`** TypedDicts covering identity matches on text/call and mail payloads. Same shape as the contact types but with `agent_handle` / `display_name` instead of `name`. Mail variant also carries `bucket` + `address`.

## 0.4.5

### Added

- **Conversation-centric text messaging.** `send_text()` /
  `texts.send()` now accept a single destination, a list of
  destinations, or `conversation_id` plus optional `media_urls`;
  `list_text_conversations()` / `texts.list_conversations()` accept
  `include_groups`; and conversation read/list helpers accept either
  the legacy remote number or the new conversation UUID.
- New additive text fields: `TextMessage.conversation_id`,
  `sender_phone_number`, `recipients`, and
  `TextConversationSummary.id`, `participants`, `is_group`,
  `latest_has_media`. Existing one-to-one `remote_phone_number`
  behavior is preserved.

- **Identity visibility controls.** New `IdentityAccess` type and three methods on both `IdentitiesResource` and `AgentIdentity`:
  - `list_access()` — list who can see an identity. Returns either a single wildcard row (`viewer_identity_id=None` — every active identity in the org sees it) or explicit per-viewer rows. An empty list means no scoped agent can see the identity.
  - `grant_access(viewer_identity_id)` — grant a viewer identity visibility on the target. Pass `None` to reset the target to the org-wide wildcard.
  - `revoke_access(viewer_identity_id)` — revoke one viewer's visibility, keyed by the viewer identity's UUID.

  Granting a viewer against an already-wildcard target raises `RedundantContactAccessGrantError` (409); revoking a non-existent grant raises `InkboxAPIError` (404).

## 0.4.3

### Breaking

- **`identity.unlink_phone_number()` / `IdentitiesResource.unlink_phone_number()` were renamed to `release_phone_number()`** and their behavior changed accordingly. The method now releases the number at the carrier and removes it locally; previously it only cleared the FK on the row and left the carrier-side number live. There is no "unlink without release" path anymore — once a number is released, it cannot be reattached.
- **`identity.assign_phone_number()` (and the underlying `IdentitiesResource.assign_phone_number()`) were removed.** The server no longer supports cross-identity reassignment; phone numbers are bound to the identity they were provisioned on. To attach a number to an identity, either pass the nested `phone_number` payload to `inkbox.create_identity(...)`, or call `inkbox.phone_numbers.provision(agent_handle=..., ...)` for an existing identity.
- **`identity.delete()` cascade now releases the linked phone number** (vendor + local), instead of clearing the FK and leaving the carrier-side number live.

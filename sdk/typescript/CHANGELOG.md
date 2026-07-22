# Changelog

## 0.5.2 — Dedicated outbound iMessage groups

### Added

- `sendIMessage` and `imessages.send` accept one recipient or a recipient array; two or more recipients select or create a dedicated-outbound group. Reply with the returned `conversationId`.
- Message and conversation lists accept `includeGroups: false`; group models expose nullable assignment/remote fields, sender attribution, participants, group identity, and per-recipient status.
- iMessage webhook message types expose the additive group fields.

### Compatibility

- Scalar sends and default one-to-one listings are unchanged. Group sends require the matching API rollout; group reactions, read receipts, and typing indicators return `409`.

## 0.5.0 — Identity tunnel summaries and inlined access

### Added

- Identity lists preserve linked mailbox, phone, iMessage, tunnel, and access fields when included. Older summary-only responses remain supported with empty defaults.
- Tunnel summaries expose routing fields without connection state or certificate material. Fetch the full tunnel when those fields are needed.
- Vault secret reads can include access rules; omitted access defaults to an empty list.

## 0.4.26 — Self-serve dedicated iMessage numbers

### Added

- **Dedicated iMessage number management.** `inkbox.imessages.listNumbers()` lists every non-released number owned by the organization, including unattached numbers, and `claimNumber({ type, idempotencyKey })` claims a dedicated inbound or outbound number. New public models are `IMessageNumber`, `IMessageNumberType`, and `IMessageNumberStatus`; attachment fields are always present and nullable. Dedicated outbound capability is identified by `number.type === IMessageNumberType.DEDICATED_OUTBOUND`.
- **Atomic identity provisioning.** `inkbox.createIdentity(...)` and `identity.update(...)` accept `imessageNumberType` to claim and attach a dedicated number in the same operation. Updates require a stable caller-provided `idempotencyKey` with `imessageNumberType`, and also accept `imessageNumberId` to attach an already-owned number or `null` to return to shared service. Detailed identity responses and `AgentIdentity.imessageNumber` expose the attached number.
- **Typed provisioning errors.** `DedicatedIMessageNumberQuotaExceededError` exposes the requested number type, quota counts, upgrade URL, and contact email. `DedicatedIMessageNumberInventoryPendingError` exposes the requested number type and `retryAfterSeconds`, preferring the HTTP `Retry-After` header when present. `IdempotencyKeyReusedError` represents reuse of a key with a different request.

### Changed

- Identity updates consume the detailed PATCH response so `identity.imessageNumber` reflects the committed attachment before the call returns.
- Identity 409 handling now maps only actual handle collisions to `HandleUnavailableError`; dedicated-number conflicts retain their original structured detail.
- Version bumped to 0.4.26.

### Notes

- `imessageNumberType` and `imessageNumberId` cannot be combined in one identity update. A new number cannot be selected while disabling iMessage; `imessageNumberId: null` may be sent with `imessageEnabled: false` to detach explicitly.
- Idempotency keys must contain 1–255 characters. Reuse the same key after an ambiguous failure; generating a new key can claim another number.

## 0.4.25 — Clearer connection errors, proxy hint, tunnel field tolerance

### Added

- **`InkboxConnectionError`.** New `InkboxError` subclass thrown when a request fails before any HTTP response exists — DNS failure, refused connection, TLS error, unreachable proxy. The message names the request URL and the underlying cause (`connect ECONNREFUSED …`, `getaddrinfo ENOTFOUND …`) instead of Node's bare `TypeError: fetch failed`; the original fetch error is preserved on `cause`. When proxy environment variables (`HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY`) are set but env-proxying can't actually be active, the message appends a hint: run with `NODE_USE_ENV_PROXY=1` (Node 22.21+ / 24+) or configure a proxy-aware fetch dispatcher on older versions. The suppression is version-aware — `NODE_USE_ENV_PROXY` set on a Node that ignores it (pre-22.21 / 23.x) gets a dedicated warning naming the running version instead of silence.

### Changed

- **Tunnel runtime/cert fields tolerate omission.** `Tunnel.organizationId` is now `string | null` and `Tunnel.currentlyConnected` is `boolean | null`, using `null` when the response omits them. The certificate and last-connected fields were already nullable; missing `metadata` still becomes `{}`, and unknown keys are ignored. Fetch `tunnels.get(id)` when connection state or certificate material is needed.

### Notes

- Scope of `InkboxConnectionError` is failures *before* a response: HTTP error responses still raise the `InkboxAPIError` family, and timeouts still surface as an abort. Code catching `InkboxError` picks the new error up automatically.
- **Source-breaking.** The two `Tunnel` field types above changed (`string` → `string | null`, `boolean` → `boolean | null`), so strict-null consumers using them in non-null positions need a guard — the same caveat 0.4.24 carried for `Mailbox`.

## 0.4.24 — Mailbox storage caps, IMAP/SMTP

### Added

- **Mailbox storage fields.** `Mailbox` gains `storageUsedBytes` (bytes currently stored) and `storageLimitBytes` (the plan cap, or `null` when the server didn't resolve it), populated by `mailboxes.list()` / `.get()` / `.update()`. Caps are **binary** — 2 GiB is `2 * 1024 ** 3` = 2,147,483,648 bytes; divide by 1024 and label GiB/MiB.
- **`StorageLimitExceededError`.** New `InkboxAPIError` subclass thrown on `402` with `detail.error === "storage_limit_exceeded"` — raised by `messages.send`, `messages.replyAll`, and `messages.forward` (and the `identity.sendEmail` / `replyAllEmail` / `forwardEmail` delegators) when the send would push the mailbox past its cap. Exposes `message` (the server's sentence, also as `detailMessage`), `upgradeUrl`, and `limitBytes`. Deleting messages or threads frees space immediately. A `402` whose `detail` is a plain string still surfaces as a plain `InkboxAPIError`.
- **Mail clients (IMAP/SMTP).** README section covering the gateway settings (hosts/ports, username = inbox address, password = an identity-scoped API key — revoking the key revokes mail-client access) and the constraints that bite: `From` must be the authenticated inbox address, and Free-plan sends of signed/encrypted mail over SMTP are refused. No SDK surface — the gateway speaks IMAP/SMTP, not HTTP.

### Notes

- **Free plan:** a footer is appended to the **stored** body of outgoing mail, so `messages.get(...)` does not return byte-for-byte what you sent — a `sentBody === fetchedBody` round-trip assertion fails on Free plans. Documented on `send` / `replyAll` / `forward`.
- TypeScript note: the `Mailbox` interface gains **required** properties (`storageUsedBytes`, `storageLimitBytes`), so code constructing those object literals (fixtures, mocks) needs the new properties. Parsing is unaffected: responses missing the fields default to `0` / `null`.

## 0.4.23 — Inkbox Voice AI rebrand

### Changed

- **Prose-only rebrand: the hosted call agent is now "Inkbox Voice AI".** JSDoc now uses the product name (short form "Voice AI"). No API changes: `CallMode.HOSTED_AGENT`, `IncomingCallAction.HOSTED_AGENT`, `inkbox.hostedAgent`, and `HostedAgentConfig` are all unchanged.

## 0.4.22 — Hosted call agent

### Added

- **Hosted call mode.** `calls.place({...})` and `identity.placeCall({...})` accept optional `mode` (`CallMode.CLIENT_WEBSOCKET`, the default, or `CallMode.HOSTED_AGENT` — the platform-run voice agent drives the call, no WebSocket needed) and `reason` (the hosted agent's task brief; required with `mode=hosted_agent`, invalid otherwise). Nothing is client-gated — server 422s/503s (`hosted_agent_at_capacity`, `hosted_agent_unavailable`) surface verbatim. `PhoneCall` gains `mode` (older responses default to `"client_websocket"`) and `reason` (nullable).
- **`IncomingCallAction.HOSTED_AGENT`.** The hosted agent answers inbound calls; the only action needing neither `clientWebsocketUrl` nor `incomingCallWebhookUrl`. Accepted by `incomingCallAction.set({...})` / `identity.setIncomingCallAction({...})` URL-less.
- **Hosted agent config.** `inkbox.hostedAgent.getConfig({ agentIdentityId? })` / `setConfig({ voice?, model?, instructions?, agentIdentityId? })` (`GET`/`PUT /phone/hosted-agent-config`; full-replace PUT — an omitted field resets to the server default). New `HostedAgentConfig` type. Identity delegators `identity.getHostedAgentConfig()` / `setHostedAgentConfig({...})`.
- **Post-call action items.** The hosted agent's recorded action items surface inline on the call resource: `PhoneCall` gains `postCallActionItems` on every call response (`calls.list` / `calls.get` / `calls.hangup` / `calls.place`), `seq`-ascending and open items only. Empty for `client_websocket` calls and hosted calls with no open items. New slim `PostCallActionItem` type: `{ id, seq, action, details, status }` (`status` always `"open"` on the wire). Mirrors the `call.ended` webhook. No separate endpoint or method.
- **`call.ended` receiver types.** `WebhookPhoneCall` gains `mode` / `reason` (on `data.call`); `CallEndedWebhookData` gains `outcome` (`"completed"|"no_answer"|"declined"|"failed"`, `null` iff client-driven) and `post_call_action_items` (open items only). All optional — pre-hosted payloads parse unchanged. New exports: `CallModeWire`, `CallOutcomeWire`, `WebhookPostCallActionItem`.

## 0.4.20 — Date-range filters, call.ended receivers, external hangup, spam-filter status

### Added

- **Date-range filters.** `messages.list(...)` / `identity.iterEmails(...)` (and `iterUnreadEmails`), `calls.list(...)` / `identity.listCalls(...)`, `texts.list(...)` / `identity.listTexts(...)`, `texts.listConversations(...)` / `identity.listTextConversations(...)`, `imessages.list(...)` / `identity.listIMessages(...)`, and `imessages.listConversations(...)` / `identity.listIMessageConversations(...)` accept optional `startDatetime` / `endDatetime` / `tz` on their options object. They filter on the resource's `created_at`: bare dates resolve to calendar days in `tz` (default UTC) with `endDatetime` whole-day inclusive; datetimes with an explicit `Z`/offset are exact instants (`tz` ignored); naive datetimes are interpreted in `tz`. Params are sent only when defined, so omitting all three preserves current behavior exactly (no filtering; ordering and pagination unchanged). The server owns resolution.
- **`call.ended` webhook receivers + external hangup.** New receiver types `CallEndedWebhookPayload` (with `CallEndedWebhookData`) / `WebhookPhoneCall` / `WebhookCallTranscript` and the `CallLifecycleWebhookEventType` / `CallOriginWire` literals; `webhooks.subscriptions.create(...)` accepts `call.ended` on an `agentIdentityId` owner; `calls.hangup(callId)` and `identity.hangupCall(callId)` end a live call from outside it (`POST /phone/calls/{id}/hangup`; already-ended calls surface the server's 409).

### Fixed

- **`SmsDeliveryStatus` gains `BLOCKED_SPAM_FILTER`.** Stored rows blocked pre-carrier by the outbound spam filter now type-check; the value appears on stored rows only — delivery webhooks never fire for blocked sends.


## 0.4.16 — Configurable webhook context + open tracking

### Added

- **Conversation-context webhooks.** `webhooks.subscriptions.create(...)` / `update(...)` accept `contextConfig` — per class (`email` / `texts` / `calls`) a `{ mode: "count", count: N }` (1..50) or `{ mode: "window", hours: H }` (1..168). `update` is tri-state (omit = unchanged, `null` = clear, object = replace). Received events carry the history under `payload.data.context`. New exports: `WebhookContextConfig`, `WebhookContextClassConfig`, `WebhookContext`, `WebhookContextBlock`, `WebhookContextMailItem` / `WebhookContextTextItem` / `WebhookContextCallItem`, and `WebhookTranscriptEntry` (discriminate transcript entries on `"marker" in entry`).
- **Open tracking.** `messages.send(...)` / `forward(...)` and `identity.sendEmail(...)` / `forwardEmail(...)` accept `trackOpens`. A plain-text `trackOpens` send is rejected with 422; forwards need HTML on the outgoing message (inline forwards inherit the original's HTML, wrapped forwards need a caller body). `Message` gains `firstOpenedAt` and `openCount` (approximate/biased both ways — prefer `firstOpenedAt`; pixels can raise spam scores).

### Changed

- **`messages.get` marks inbound messages read.** Fetching a single inbound message by id with an API key now flips `isRead` server-side; list, thread, and attachment routes do not. `markRead` remains for list-only workflows. `isRead` (agent consumed via API) is distinct from `firstOpenedAt` (recipient's client loaded the tracking pixel).

## 0.4.12 — Tunnel DX

### Added

- **Config-file / env auth resolution.** `new Inkbox()` resolves `apiKey` / `baseUrl` / `vaultKey` from the options, then the env var, then `~/.inkbox/config` — so it works with no explicit key in background/agent processes.

## 0.4.11 — Reply all

### Added

- **Email reply-all helpers.** `messages.replyAll(...)` and `identity.replyAllEmail(...)` call the mailbox reply-all endpoint, with server-resolved recipients and optional subject/body/attachment fields.

## 0.4.10 — Agent harness

### Added

- **Optional `harness` on agent self-signup.** The signup helper accepts an optional `harness` identifying the agent harness/runtime (free-form string; unknown values accepted). When a plugin exists for the harness, post-verification guidance is folded into the verify response's `message`.

## 0.4.8 — graceful tunnel reconnect on redeploy

### Added

- **Make-before-break tunnel reconnect.** When the tunnel server signals a graceful drain (a NO_ERROR `GOAWAY`) during a redeploy, the client now opens a new persistent connection and parks a fresh intake pool **before** closing the draining one, instead of tearing down and reconnecting cold. In-flight HTTP webhook replies are posted on the new connection so they round-trip across the handoff. The reconnect is in-band — it does not surface as a `reconnecting` status or wait out the backoff schedule.
- **Typed `server_draining` WebSocket close.** When the draining connection closes with a live WebSocket bridge, the inbound stream now throws `WsServerDraining` (a `WsClosed` subclass, close code `4500`, `reconnectAdvised = true`) instead of a generic stream-reset error, so a handler can reconnect promptly. New exports: `WsServerDraining`, `SERVER_DRAINING_WS_CLOSE_CODE`.

### Notes / limits

- In-progress WebSocket and passthrough-TCP sessions **cannot** migrate across a redeploy — the third-party socket lives on the dying task. The client makes the close clean and the reconnect fast; the third-party peer reconnects onto the new task. Idempotent reconnect is the right client pattern.

## 0.4.6 — webhook subscriptions refactor

### Breaking

- **`Mailbox.webhookUrl` removed.** Mailbox PATCH no longer accepts `webhookUrl`; sending it returns 422. Migration: create a `webhooks.subscriptions` row for each mailbox that needs delivery (see Added below).
- **`PhoneNumber.incomingTextWebhookUrl` removed** from every shape that carried it (`PhoneNumber`, `IdentityPhoneNumber`, `IdentityPhoneNumberCreateOptions`, `phoneNumbers.update`, `phoneNumbers.provision`, identity-create's nested `phoneNumber`). Sending it returns 422 server-side. Replace with a `text.*` subscription on the phone number.
- **Phone-text webhook payload — `data.contact` → `data.contacts` + `data.agent_identities`.** `contact` is gone. `contacts` is always a list (possibly empty); `agent_identities` is a new always-present list of matched agent identities. Destructuring `const { contact } = data` silently breaks.
- **Inbound-call webhook payload — top-level `contact` → `contacts` + `agent_identities`.** Same shape swap at the top level of the flat payload.
- **Mail webhook payload — `data.agent_identities` is now required on the wire** alongside the existing `data.contacts` (both default `[]`). Receivers that previously did `Object.keys(data)` or strict shape checks will see a new key.

### Added

- **`inkbox.webhooks.subscriptions` resource** — full CRUD for the new `/webhooks/subscriptions` endpoint surface. `list`, `get`, `create`, `update`, `delete`. The SDK runs structural + prefix validation client-side (exactly-one FK, non-empty distinct events, no `phone.incoming_call`, `message.` / `text.` prefix matching the owner's channel) so most shape mistakes surface as thrown errors rather than 422 round-trips. The server remains authoritative for the exact event-name enum, so a typo with a valid prefix (e.g. `message.received_typo`) passes the SDK's check and is rejected as 422 by the server. New exports: `WebhookSubscription`, `WebhookSubscriptionsResource`, `WebhookSubscriptionStatus`, plus option types for create/update/list.
- **`WebhookAgentIdentity` / `WebhookMailAgentIdentity`** types covering identity matches on text/call and mail payloads. Same shape as the contact types but with `agent_handle` / `display_name` instead of `name`. Mail variant also carries `bucket` + `address`.

## 0.4.5

### Added

- **Conversation-centric text messaging.** `sendText()` /
  `texts.send()` now accept a single destination, an array of
  destinations, or `conversationId` plus optional `mediaUrls`;
  `listTextConversations()` / `texts.listConversations()` accept
  `includeGroups`; and conversation read/list helpers accept either the
  legacy remote number or the new conversation UUID.
- New additive text fields: `TextMessage.conversationId`,
  `senderPhoneNumber`, `recipients`, and
  `TextConversationSummary.id`, `participants`, `isGroup`,
  `latestHasMedia`. Existing one-to-one `remotePhoneNumber` behavior is
  preserved.
- **TypeScript users:** group rows can legitimately have no single remote
  party, so `remotePhoneNumber` / `remote_phone_number` is now typed as
  `string | null` on text messages, conversation summaries, webhook
  messages, raw wire types, and conversation update results.

- **Identity visibility controls.** New `IdentityAccess` type and three methods on both `IdentitiesResource` and `AgentIdentity`:
  - `listAccess()` — list who can see an identity. Returns either a single wildcard row (`viewerIdentityId === null` — every active identity in the org sees it) or explicit per-viewer rows. An empty list means no scoped agent can see the identity.
  - `grantAccess(viewerIdentityId)` — grant a viewer identity visibility on the target. Pass `null` to reset the target to the org-wide wildcard.
  - `revokeAccess(viewerIdentityId)` — revoke one viewer's visibility, keyed by the viewer identity's UUID.

  Granting a viewer against an already-wildcard target raises `RedundantContactAccessGrantError` (409); revoking a non-existent grant raises `InkboxAPIError` (404).

## 0.4.3

### Breaking

- **`identity.unlinkPhoneNumber()` / `IdentitiesResource.unlinkPhoneNumber()` were renamed to `releasePhoneNumber()`** and their behavior changed accordingly. The method now releases the number at the carrier and removes it locally; previously it only cleared the FK on the row and left the carrier-side number live. There is no "unlink without release" path anymore — once a number is released, it cannot be reattached.
- **`identity.assignPhoneNumber()` (and the underlying `IdentitiesResource.assignPhoneNumber()`) were removed.** The server no longer supports cross-identity reassignment; phone numbers are bound to the identity they were provisioned on. To attach a number to an identity, either pass the nested `phoneNumber` option to `inkbox.createIdentity(...)`, or call `inkbox.phoneNumbers.provision({ agentHandle, ... })` for an existing identity.
- **`identity.delete()` cascade now releases the linked phone number** (vendor + local), instead of clearing the FK and leaving the carrier-side number live.

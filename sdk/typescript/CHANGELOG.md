# Changelog

## 0.4.10 — Agent harness

### Added

- **Optional `harness` on agent self-signup.** The signup helper accepts an optional `harness` identifying the agent harness/runtime. The verify response now carries `nextSteps`, which reads with a default (`null`) so responses from older servers still parse.

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

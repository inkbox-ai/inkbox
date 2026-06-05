# Changelog

## 0.4.7 — graceful tunnel reconnect on redeploy

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

# Changelog

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

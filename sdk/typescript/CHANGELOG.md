# Changelog

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

# Changelog

## 0.4.4

### Added

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

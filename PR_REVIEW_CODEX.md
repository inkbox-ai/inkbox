# PR Review: Fresh OTP/Vault Pass

## Findings

### 1. High: newly created secrets do not show up in `identity.credentials` until the vault is re-unlocked

Both SDKs rebuild identity-scoped credentials from the unlocked vault's in-memory `secrets` snapshot, but `create_secret` / `createSecret` never append the new secret back into that cache. The identity helpers do invalidate the credentials cache after creation, yet the next rebuild still filters the old secret list.

- Python cache read path: `AgentIdentity.credentials` filters `vault._unlocked.secrets` in `sdk/python/inkbox/agent_identity.py:99-115`
- Python create path: `UnlockedVault.create_secret()` posts the new secret but never updates `_secrets_cache` in `sdk/python/inkbox/vault/resources/vault.py:349-383`
- Python identity helper: `AgentIdentity.create_secret()` invalidates `self._credentials`, but does not refresh the unlocked cache in `sdk/python/inkbox/agent_identity.py:135-162`
- TypeScript cache read path: `AgentIdentity.getCredentials()` filters `unlocked.secrets` in `sdk/typescript/src/agent_identity.ts:69-95`
- TypeScript create path: `UnlockedVault.createSecret()` posts the new secret but never updates `secretsCache` in `sdk/typescript/src/vault/resources/vault.ts:373-389`
- TypeScript identity helper: `AgentIdentity.createSecret()` invalidates `_credentials`, but does not refresh the unlocked cache in `sdk/typescript/src/agent_identity.ts:125-135`

This is already visible in the new examples, which create a secret and then immediately list credentials as if the new login will be present:

- `examples/use-inkbox-vault/agent_totp.py:41-56`
- `examples/use-inkbox-vault/agent-totp.ts:43-63`

In practice, a freshly created login can be missing from `identity.credentials.list_logins()` until the caller re-unlocks the vault.

### 2. Medium: the new secret-ID AAD scheme is still not applied when creating secrets

The refactor added secret-ID-based AAD for payload encryption, but only the update path actually uses it. New secrets are still encrypted without a `secret_id`, so they are written in the legacy format until they are later updated.

- Python create path omits `secret_id`: `sdk/python/inkbox/vault/resources/vault.py:370-383`
- Python update path uses `secret_id`: `sdk/python/inkbox/vault/resources/vault.py:420-436`
- TypeScript create path omits `secretId`: `sdk/typescript/src/vault/resources/vault.ts:378-388`
- TypeScript update path uses `secretId`: `sdk/typescript/src/vault/resources/vault.ts:418-431`

The matching decrypt logic now has to carry an explicit fallback to empty AAD:

- Python unlock/get paths: `sdk/python/inkbox/vault/resources/vault.py:230-234`, `sdk/python/inkbox/vault/resources/vault.py:330-333`
- TypeScript unlock/get paths: `sdk/typescript/src/vault/resources/vault.ts:238-243`, `sdk/typescript/src/vault/resources/vault.ts:342-345`

If the intent of the AAD change is to bind ciphertext to the server-side secret UUID, the create flow is still incomplete. Right now, only secrets that have been updated at least once benefit from the new binding.

### 3. Medium: TypeScript `vaultKey` auto-unlock still leaks internals because there is no public await/error surface

The TypeScript client starts an async unlock in the constructor when `vaultKey` is provided, but the only handle it keeps is the internal `_vaultUnlockPromise`. The shipped example then reaches into `@internal` state to make this usable.

- Constructor starts unlock eagerly: `sdk/typescript/src/inkbox.ts:122-124`
- Identity credentials wait on the internal promise: `sdk/typescript/src/agent_identity.ts:69-74`
- Public docs advertise the `vaultKey` option: `sdk/typescript/README.md:22-25`, `sdk/typescript/README.md:55-57`
- Example reaches into internals: `examples/use-inkbox-vault/agent-totp.ts:20-31`
- Existing test coverage only asserts the promise exists, not that consumers have a safe public way to observe failure: `sdk/typescript/tests/inkbox.test.ts:136-148`

This leaves the API in an awkward spot:

- consumers who want to know whether auto-unlock succeeded have to rely on internals
- a rejected unlock promise has no public lifecycle API of its own
- the official example is already teaching users to depend on `_vaultUnlockPromise` and `_unlocked`

I would either remove constructor-time unlock from the public story, or expose a supported method/property for awaiting and handling vault unlock state.

## Verification

- `python3 -m py_compile sdk/python/inkbox/agent_identity.py sdk/python/inkbox/credentials.py sdk/python/inkbox/vault/crypto.py sdk/python/inkbox/vault/resources/vault.py sdk/python/inkbox/vault/totp.py examples/use-inkbox-vault/agent_totp.py`
- `npm run build` in `sdk/typescript`
- `npm test` in `sdk/typescript`

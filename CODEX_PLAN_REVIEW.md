# CODEX Plan Review: OTP Refactor

## Overall

The direction is good: moving TOTP generation client-side and keeping the secret inside the encrypted vault is a better fit for the zero-knowledge model than the current server-side authenticator flow.

Before implementation starts, I would tighten the plan in five places. Right now the biggest risks are incomplete API removal, stale credential caches, and a missing migration story for existing authenticator data.

## High-Priority Findings

### 1. The removal scope is incomplete

Part 2 removes the dedicated authenticator modules and the `AgentIdentity` convenience methods, but the SDK still has authenticator concepts in the identities layer:

- `sdk/python/inkbox/identities/resources/identities.py:135-159`
- `sdk/typescript/src/identities/resources/identities.ts:132-156`
- `sdk/python/inkbox/identities/types.py:92-137`
- `sdk/typescript/src/identities/types.ts:40-103`

Those files still expose:

- `IdentityAuthenticatorApp`
- `authenticator_app` / `authenticatorApp` on identity detail types
- `assign_authenticator_app` / `assignAuthenticatorApp`
- `unlink_authenticator_app` / `unlinkAuthenticatorApp`

If the goal is to remove the old authenticator infrastructure "entirely", those APIs need to be explicitly removed or deprecated too. Otherwise the SDK will still publicly model authenticator state even after the main module is gone.

### 2. There is no migration story for existing authenticator data

The current authenticator account model can represent more than the new plan preserves:

- `otp_type`, including HOTP
- `counter`
- `display_name`
- `description`
- arbitrary `period` values

See:

- `sdk/python/inkbox/authenticator/types.py:38-97`
- `sdk/typescript/src/authenticator/types.ts:17-52`

The plan, by contrast:

- stores OTP only under `LoginPayload`
- rejects HOTP in `parse_totp_uri()`
- restricts `period` to `30` or `60`

Relevant plan sections:

- `OTP_REFACTOR.md:53-84`
- `OTP_REFACTOR.md:103-131`
- `OTP_REFACTOR.md:188-240`

Open questions the plan does not answer:

- What happens to existing HOTP accounts?
- What happens to TOTP accounts that are not tied to a login/password secret?
- Where do legacy `display_name` and `description` values go?
- Is rejecting non-30/60 periods intentional, or an accidental regression?

This is the biggest product/API gap in the plan. Without an explicit migration rule, the change is more than a refactor; it is a data-model break.

### 3. `Credentials.get_totp_codes()` conflicts with the current cache model

The plan says `Credentials.get_totp_codes()` should use cached decrypted `LoginPayload.totp`.

That is risky with the current architecture:

- `Credentials` is a snapshot wrapper over decrypted secrets:
  - `sdk/python/inkbox/credentials.py:45-49`
  - `sdk/typescript/src/credentials.ts:42-45`
- `VaultResource.unlock()` snapshots decrypted secrets into `UnlockedVault`:
  - `sdk/python/inkbox/vault/resources/vault.py:215-239`
  - `sdk/typescript/src/vault/resources/vault.ts:228-247`
- `UnlockedVault` CRUD methods currently do not refresh that cache after writes:
  - `sdk/python/inkbox/vault/resources/vault.py:251-396`
  - `sdk/typescript/src/vault/resources/vault.ts:258-393`

So after `set_totp()` or `remove_totp()`, `identity.credentials.get_totp_codes()` can immediately become stale unless the vault is re-unlocked or the cache is manually rebuilt.

I would not ship the credentials-level helper until the cache story is explicit.

### 4. The generated-code return shape is awkward, especially in TypeScript

The plan returns `{unix_ts: code}` even for a single generated code.

Relevant sections:

- `OTP_REFACTOR.md:74-75`
- `OTP_REFACTOR.md:82-83`
- `OTP_REFACTOR.md:129-130`
- `OTP_REFACTOR.md:149-178`

Problems with this shape:

- A single code still comes back as a map instead of a value object.
- In TypeScript, `Record<number, string>` becomes string-keyed object properties at runtime.
- It drops convenience metadata the current OTP API exposes, like `valid_for_seconds`.

The older API returned a structured object:

- `sdk/python/inkbox/authenticator/types.py:77-97`
- `sdk/typescript/src/authenticator/types.ts:40-52`

I think a structured return would be easier to consume:

- single code: `{ code, periodStart, expiresAt, validForSeconds }`
- multiple codes: `Array<{ periodStart, code, expiresAt }>`

## Medium-Priority Gaps

### 5. Public exports, docs, and tests are under-scoped

The plan mentions Python vault exports, but it does not fully cover the package entry points that users actually import from:

- `sdk/python/inkbox/vault/__init__.py:5-52`
- `sdk/python/inkbox/__init__.py:31-124`
- `sdk/typescript/src/index.ts:1-56`

Docs also still present authenticator as a first-class feature:

- `README.md:9`
- `README.md:44-83`
- `sdk/python/README.md:207-243`
- `sdk/typescript/README.md:218-254`

And test cleanup is broader than the current deletion list. The plan only removes dedicated authenticator tests, but authenticator references also exist in:

- identities tests
- agent identity tests
- credentials tests sample data
- README example inventories

## Suggested Plan Changes

### Revise the plan before implementation

1. Add an explicit migration section.
   Decide whether HOTP is unsupported, how old account metadata maps into vault secrets, and whether OTP-only records need their own vault payload type instead of living only under `LoginPayload`.

2. Expand the removal matrix.
   Include identities types/resources, remaining top-level exports, sample data, tests, and README content so the old authenticator surface is removed consistently.

3. Settle cache semantics before adding `Credentials.get_totp_codes()`.
   Either:
   - keep TOTP generation only on `UnlockedVault` in the first pass,
   - update `UnlockedVault` caches after secret writes,
   - or redesign `Credentials` so it can fetch fresh secret data.

4. Change the generated-code API shape.
   Prefer a structured object or array of structured objects over timestamp-keyed dictionaries/records.

5. Add a real test plan.
   I would expect:
   - RFC 6238 test vectors in both SDKs
   - `otpauth://` parsing tests
   - payload serialize/parse round-trips with nested `totp`
   - cache/coherency tests for `set_totp()` / `remove_totp()`
   - removal tests for old authenticator exports and methods

## Short Version

I agree with the architectural direction, but I would not treat the current plan as implementation-ready yet. The two things I would resolve first are:

1. how legacy authenticator data migrates into the new model
2. whether credentials-level TOTP helpers can be correct with the current snapshot cache design

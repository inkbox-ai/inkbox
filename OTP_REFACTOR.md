# TOTP Support in Vault + Remove Old Authenticator Infrastructure

## Context

OTP functionality is moving from a server-side authenticator model (where the server held OTP master keys and generated codes) to a **client-side zero-knowledge vault model** where TOTP secrets are stored as part of `LoginPayload` in the encrypted vault. The server never sees plaintext TOTP secrets.

This requires two things:
1. **Add TOTP support** to the vault `LoginPayload` (both Python and TypeScript SDKs)
2. **Remove the old `authenticator` module** entirely from both SDKs

---

## Design Decision: OTP Code Generation

**Separate method, not auto-generated on get.**

Reasons:
- OTP codes are ephemeral (~30s lifetime) — embedding in a static payload is misleading
- Not all logins have TOTP — a nullable auto-populated field adds confusion
- Caller needs timing control (generate right before use)
- Pure local computation — no API call, so a dedicated method is cheap to call

API surface:
- `totp_config.generate_code()` for a single code
- `unlocked_vault.get_totp_code(secret_id)` for convenience
- `credentials.get_totp_code(secret_id)` at agent level

---

## Part 1: Add TOTP Support

### [x] 1a. New file: `sdk/python/inkbox/vault/totp.py`

**`TOTPAlgorithm` enum (lowercase values, matching servers `OTPAlgorithm` and otpauth URI convention):**
```python
class TOTPAlgorithm(StrEnum):
    SHA1   = "sha1"
    SHA256 = "sha256"
    SHA512 = "sha512"

    @property
    def hash_func(self) -> Callable:
        """Return the corresponding hashlib constructor."""
        return {
            TOTPAlgorithm.SHA1:   hashlib.sha1,
            TOTPAlgorithm.SHA256: hashlib.sha256,
            TOTPAlgorithm.SHA512: hashlib.sha512,
        }[self]
```
Used in TOTP generation: `hmac.new(secret_bytes, T_bytes, config.algorithm.hash_func)`
Matches the servers repo `OTPAlgorithm` enum (same lowercase values).

**`TOTPConfig` dataclass with `__post_init__` validation:**
```python
@dataclass
class TOTPConfig:
    secret: str                          # base32-encoded
    algorithm: TOTPAlgorithm = TOTPAlgorithm.SHA1
    digits: int = 6                      # 6 or 8
    period: int = 30                     # 30 or 60
    issuer: str | None = None
    account_name: str | None = None

    def __post_init__(self):
        if self.digits not in (6, 8):
            raise ValueError(f"digits must be 6 or 8, got {self.digits}")
        if self.period not in (30, 60):
            raise ValueError(f"period must be 30 or 60, got {self.period}")
        if not isinstance(self.algorithm, TOTPAlgorithm):
            self.algorithm = TOTPAlgorithm(self.algorithm)  # coerce str -> enum
```
- `_to_dict()` — omit None values (matches existing pattern)
- `_from_dict(d)` — reconstruct from dict
- `generate_code() -> TOTPCode` — generate current OTP code with timing metadata (always uses current time)

**`TOTPCode` dataclass:**
```python
@dataclass
class TOTPCode:
    code: str              # e.g. "482901"
    period_start: int      # unix ts when this code became valid
    period_end: int        # unix ts when this code expires
    seconds_remaining: int # seconds left until expiry
```

**Standalone functions (port from `servers` repo `otp` branch: `src/utils/otp.py`):**

The servers repo already had a working implementation at `servers/src/utils/otp.py` (branch `otp`). We are porting this client-side, stripping HOTP support, and adapting to use `TOTPConfig` instead of loose params.

- `_b32decode(secret) -> bytes` — base32 decode with auto-padding (ported directly from servers)
- `generate_totp(config) -> TOTPCode` — Port of `generate_hotp()` + `generate_totp()` from servers. Always uses current time. Same RFC 6238 algorithm: b32decode secret, pack time step as big-endian u64, HMAC with `config.algorithm.hash_func`, dynamic truncation (RFC 4226 §5.4), modulo 10^digits, zero-pad. Returns a `TOTPCode` with the code string and timing metadata.
- `parse_totp_uri(uri) -> TOTPConfig` — Port of `parse_otpauth_uri()` from servers. Same `urlparse` + `parse_qs` approach. Key difference: **rejects HOTP** (`ValueError`) instead of supporting both types. Maps parsed params into `TOTPConfig` instead of `OTPAuthParams`.

### [x] 1b. New file: `sdk/typescript/src/vault/totp.ts`

Mirror of Python. Uses `node:crypto` for HMAC (already used in vault/crypto.ts). Same interfaces/functions in camelCase:

**`TOTPAlgorithm` const enum:**
```typescript
export const TOTPAlgorithm = {
  SHA1:   "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
} as const;
export type TOTPAlgorithm = (typeof TOTPAlgorithm)[keyof typeof TOTPAlgorithm];
```
Values are lowercase (matching servers repo and otpauth URI convention). Since values already match `node:crypto` digest names, pass directly to `crypto.createHmac(config.algorithm, ...)`.

**`TOTPConfig` interface + validation:**
```typescript
export interface TOTPConfig {
  secret: string;
  algorithm?: TOTPAlgorithm;   // default "sha1"
  digits?: number;             // 6 or 8, default 6
  period?: number;             // 30 or 60, default 30
  issuer?: string;
  accountName?: string;
}

export function validateTotpConfig(config: TOTPConfig): void {
  const digits = config.digits ?? 6;
  if (digits !== 6 && digits !== 8)
    throw new Error(`digits must be 6 or 8, got ${digits}`);
  const period = config.period ?? 30;
  if (period !== 30 && period !== 60)
    throw new Error(`period must be 30 or 60, got ${period}`);
  const alg = config.algorithm ?? "sha1";
  if (!["sha1", "sha256", "sha512"].includes(alg))
    throw new Error(`algorithm must be sha1, sha256, or sha512, got ${alg}`);
}
```
Called from `parseTotpUri()` and `parsePayload()` (login case with totp).

**`TOTPCode` interface:**
```typescript
interface TOTPCode {
  code: string;
  periodStart: number;
  periodEnd: number;
  secondsRemaining: number;
}
```

**Standalone functions (TS mirror of Python, same algorithm ported from `servers/src/utils/otp.py`):**
- `generateTotp(config) -> TOTPCode` — same RFC 6238 logic using `node:crypto` HMAC + `Buffer` for byte ops. Always uses current time.
- `parseTotpUri(uri)` — same parsing logic using `URL` constructor, rejects HOTP

### [x] 1c. Modify: `sdk/python/inkbox/vault/types.py`

- Import `TOTPConfig` from `inkbox.vault.totp`
- Add `totp: TOTPConfig | None = None` to `LoginPayload`
- Override `_to_dict()` to call `self.totp._to_dict()` for the nested object (avoid `asdict()` leaving None values in nested dict)
- Override `_from_dict()` to reconstruct `TOTPConfig` from raw dict

### [x] 1d. Modify: `sdk/typescript/src/vault/types.ts`

- Import `TOTPConfig` from `./totp.js`
- Add `totp?: TOTPConfig` to `LoginPayload` interface
- Update `serializePayload` login case: serialize `totp` with `accountName` -> `account_name`
- Update `parsePayload` login case: parse `totp` with `account_name` -> `accountName`

### [x] 1e. Modify: `sdk/python/inkbox/vault/resources/vault.py`

Add to `UnlockedVault`:
- `set_totp(secret_id, totp: TOTPConfig | str) -> VaultSecret` — if str, parse as URI. Fetch secret, set totp, re-encrypt, patch.
- `remove_totp(secret_id) -> VaultSecret` — fetch, clear totp, re-encrypt, patch.
- `get_totp_code(secret_id) -> TOTPCode` — fetch+decrypt, extract TOTPConfig, generate code. Raises `TypeError` if not login, `ValueError` if no TOTP configured.

### [x] 1f. Modify: `sdk/typescript/src/vault/resources/vault.ts`

Mirror 1e on `UnlockedVault`:
- `setTotp(secretId, totp)`, `removeTotp(secretId)`, `getTotpCode(secretId) -> TOTPCode`

### [x] 1g. Modify: `sdk/python/inkbox/credentials.py`

Add to `Credentials`:
- `get_totp_code(secret_id) -> TOTPCode` — returns the current TOTP code with timing metadata. Uses the cached decrypted `LoginPayload.totp` config — agent never needs to handle `TOTPConfig` directly, just passes a secret ID they got from `list_logins()`.

Raises `TypeError` if not a login, `ValueError` if login has no TOTP configured.

```python
# Agent usage — no TOTPConfig knowledge needed:
identity.credentials.get_totp_code("secret-uuid")
# TOTPCode(code="482901", period_start=1711843200, period_end=1711843230, seconds_remaining=17)
```

### [x] 1h. Modify: `sdk/typescript/src/credentials.ts`

Add to `Credentials`:
- `getTotpCode(secretId) -> TOTPCode`

Same pattern — agent just passes a secret ID, never touches `TOTPConfig`.

### [x] 1i. Modify: `sdk/python/inkbox/vault/__init__.py`

Export: `TOTPAlgorithm`, `TOTPConfig`, `TOTPCode`, `generate_totp`, `parse_totp_uri`

---

## Part 2: Remove Old Authenticator Infrastructure

### [x] 2a. Delete: `sdk/python/inkbox/authenticator/` (entire directory)

Files: `__init__.py`, `_http.py`, `types.py`, `exceptions.py`, `resources/apps.py`, `resources/accounts.py`, `resources/__init__.py`

### [x] 2b. Delete: `sdk/typescript/src/authenticator/` (entire directory)

Files: `types.ts`, `resources/apps.ts`, `resources/accounts.ts`

### [x] 2c. Delete: test files

- `sdk/python/tests/test_authenticator_apps.py`
- `sdk/python/tests/test_authenticator_accounts.py`
- `sdk/python/tests/sample_data_authenticator.py`

### [x] 2d. Modify: `sdk/python/inkbox/client.py`

- Remove imports: `AuthHttpTransport`, `AuthenticatorAppsResource`, `AuthenticatorAccountsResource`
- Remove from `__init__`: `self._auth_http`, `self._auth_apps`, `self._auth_accounts`
- Remove property: `authenticator_apps`
- Remove from `close()`: `self._auth_http.close()`

### [x] 2e. Modify: `sdk/typescript/src/inkbox.ts`

- Remove imports: `AuthenticatorAppsResource`, `AuthenticatorAccountsResource`
- Remove from constructor: `authHttp`, `this._authApps`, `this._authAccounts`
- Remove fields: `_authApps`, `_authAccounts`
- Remove getter: `authenticatorApps`

### [x] 2f. Modify: `sdk/python/inkbox/agent_identity.py`

- Remove import of `AuthenticatorAccount`, `AuthenticatorApp`, `OTPCode`
- Remove import of `IdentityAuthenticatorApp`
- Remove `self._authenticator_app` from `__init__`
- Remove property: `authenticator_app`
- Remove methods: `create_authenticator_app`, `assign_authenticator_app`, `unlink_authenticator_app`, `create_authenticator_account`, `list_authenticator_accounts`, `get_authenticator_account`, `update_authenticator_account`, `delete_authenticator_account`, `generate_otp`
- Remove `_require_authenticator_app` guard
- Remove authenticator_app from `update()`, `refresh()`, `__repr__`

### [x] 2g. Modify: `sdk/typescript/src/agent_identity.ts`

Same removals as 2f in TypeScript:
- Remove all authenticator imports, properties, methods, guards

### [x] 2h. Modify: `sdk/python/inkbox/__init__.py`

- Remove `AuthenticatorAccount`, `AuthenticatorApp`, `OTPCode` imports and `__all__` entries
- Remove `IdentityAuthenticatorApp` import and `__all__` entry

### [x] 2i. Modify: `sdk/typescript/src/index.ts`

- Remove `AuthenticatorApp`, `AuthenticatorAccount`, `OTPCode` type exports
- Remove `IdentityAuthenticatorApp` type export

### [x] 2j. Modify: `sdk/python/inkbox/identities/types.py`

- Remove `IdentityAuthenticatorApp` dataclass
- Remove `authenticator_app` field from `_AgentIdentityData`
- Update `_AgentIdentityData._from_dict()` to stop parsing `authenticator_app`

### [x] 2k. Modify: `sdk/typescript/src/identities/types.ts`

- Remove `IdentityAuthenticatorApp` interface and `RawIdentityAuthenticatorApp`
- Remove `authenticatorApp` from `_AgentIdentityData`
- Remove `parseIdentityAuthenticatorApp()` function
- Update `parseAgentIdentityData()` to stop parsing `authenticator_app`

### [x] 2l. Modify: `sdk/python/inkbox/identities/resources/identities.py`

- Remove `assign_authenticator_app` and `unlink_authenticator_app` methods

### [x] 2m. Modify: `sdk/typescript/src/identities/resources/identities.ts`

- Remove `assignAuthenticatorApp` and `unlinkAuthenticatorApp` methods

### [x] 2n. Modify: `sdk/python/inkbox/identities/__init__.py`

- Remove `IdentityAuthenticatorApp` from exports

---

## Part 3: Export Updates

### [x] 3a. Modify: `sdk/python/inkbox/__init__.py`

Add vault TOTP exports:
- `TOTPAlgorithm`, `TOTPConfig`, `TOTPCode`, `generate_totp`, `parse_totp_uri`

### [x] 3b. Modify: `sdk/typescript/src/index.ts`

Add vault TOTP exports:
- `TOTPAlgorithm`, `TOTPConfig` (type), `TOTPCode` (type), `generateTotp`, `parseTotpUri`

---

## Part 4: Tests

### [x] 4a. New: `sdk/python/tests/test_vault_totp.py`

- `TOTPConfig` construction, serialization roundtrip
- `generate_totp` with RFC 6238 test vectors (SHA1 secret `12345678901234567890`, known timestamps)
- `parse_totp_uri` — valid URIs, minimal URI, issuer in label, reject HOTP, reject missing secret, reject bad algorithm/digits
- `LoginPayload` with totp field — roundtrip serialization, backward compat (old payloads without totp parse with `totp=None`)

### [x] 4b. New: `sdk/typescript/tests/vault/totp.test.ts`

Mirror all Python test cases using vitest.

---

## Part 5: Cleanup (from review findings)

### [x] 5a. Clean up authenticator references in `sdk/python/tests/test_agent_identity.py`

### [x] 5b. Clean up authenticator sections in `sdk/python/README.md`

### [x] 5c. Clean up authenticator sections in `sdk/typescript/README.md`

### [x] 5d. Clean up authenticator references in `README.md` (root)

---

## Verification

- [x] **Python tests:** `cd sdk/python && uv run pytest` — all existing + new tests pass
- [x] **TypeScript tests:** `cd sdk/typescript && npx vitest run` — all existing + new tests pass
- [x] **TypeScript build:** `cd sdk/typescript && npm run build` — compiles without errors
- [x] **Python lint:** `cd sdk/python && uv run ruff check .`
- [x] **Manual check:** ensure no remaining imports of `inkbox.authenticator` or `./authenticator/` in either SDK

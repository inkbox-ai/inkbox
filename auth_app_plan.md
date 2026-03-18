# Authenticator Module — Implementation Plan

## Context

The Inkbox backend added a new `authenticator` subapp (`/api/v1/authenticator`) that provides OTP (TOTP/HOTP) management for AI agents. We need to extend both the Python and TypeScript SDKs to support this new API, following the exact patterns already established for mail, phone, and identities.

---

## New Files to Create

### Python SDK (`sdk/python/`)

| File | Purpose |
|------|---------|
| `inkbox/authenticator/__init__.py` | Module exports (types + exceptions) |
| `inkbox/authenticator/_http.py` | `HttpTransport` (same pattern as other modules) |
| `inkbox/authenticator/exceptions.py` | `InkboxError`, `InkboxAPIError` |
| `inkbox/authenticator/types.py` | `AuthenticatorApp`, `AuthenticatorAccount`, `OTPCode` dataclasses |
| `inkbox/authenticator/resources/__init__.py` | Resource exports |
| `inkbox/authenticator/resources/apps.py` | `AuthenticatorAppsResource` — CRUD for apps |
| `inkbox/authenticator/resources/accounts.py` | `AuthenticatorAccountsResource` — CRUD + generate-otp for accounts |
| `tests/sample_data_authenticator.py` | Mock API response dicts |
| `tests/test_authenticator_apps.py` | Tests for apps resource |
| `tests/test_authenticator_accounts.py` | Tests for accounts resource |

### TypeScript SDK (`sdk/typescript/`)

| File | Purpose |
|------|---------|
| `src/authenticator/types.ts` | Public interfaces + Raw interfaces + parsers |
| `src/authenticator/resources/apps.ts` | `AuthenticatorAppsResource` |
| `src/authenticator/resources/accounts.ts` | `AuthenticatorAccountsResource` |
| `tests/authenticator/apps.test.ts` | Tests for apps resource |
| `tests/authenticator/accounts.test.ts` | Tests for accounts resource |

---

## Existing Files to Modify

### Python SDK

| File | Changes |
|------|---------|
| `inkbox/identities/types.py` | Add `IdentityAuthenticatorApp` dataclass; add `authenticator_app` field to `_AgentIdentityData`; update `_from_dict` |
| `inkbox/identities/__init__.py` | Export `IdentityAuthenticatorApp` |
| `inkbox/identities/resources/identities.py` | Add `assign_authenticator_app()` and `unlink_authenticator_app()` methods |
| `inkbox/client.py` | Add auth HTTP transport, `_auth_apps`, `_auth_accounts` resources, `authenticator_apps` property, update `close()` |
| `inkbox/agent_identity.py` | Add `authenticator_app` property, `_authenticator_app` field, channel mgmt methods (`create_authenticator_app`, `assign_authenticator_app`, `unlink_authenticator_app`), convenience methods (`list_authenticator_accounts`, `create_authenticator_account`, `get_authenticator_account`, `update_authenticator_account`, `delete_authenticator_account`, `generate_otp`), `_require_authenticator_app` guard, update `refresh()` and `update()` |
| `inkbox/__init__.py` | Export `AuthenticatorApp`, `AuthenticatorAccount`, `OTPCode`, `IdentityAuthenticatorApp` |
| `tests/sample_data_identities.py` | Add authenticator_app to identity detail fixture |
| `tests/test_identities.py` | Add assign/unlink authenticator app tests |
| `tests/test_agent_identity.py` | Add authenticator convenience method tests |
| `tests/conftest.py` | Add `_auth_apps` and `_auth_accounts` to client fixture |

### TypeScript SDK

| File | Changes |
|------|---------|
| `src/identities/types.ts` | Add `IdentityAuthenticatorApp`, `RawIdentityAuthenticatorApp`, `parseIdentityAuthenticatorApp`; add field to `_AgentIdentityData` and `RawAgentIdentityData`; update `parseAgentIdentityData` |
| `src/identities/resources/identities.ts` | Add `assignAuthenticatorApp()` and `unlinkAuthenticatorApp()` methods |
| `src/inkbox.ts` | Add auth HTTP transport, `_authApps`, `_authAccounts` resources, `authenticatorApps` getter |
| `src/agent_identity.ts` | Add `authenticatorApp` getter, `_authenticatorApp` field, channel mgmt methods, convenience methods, `_requireAuthenticatorApp` guard, update `refresh()` and `update()` |
| `src/index.ts` | Export new types |
| `tests/sampleData.ts` | Add `RAW_AUTHENTICATOR_APP`, `RAW_AUTHENTICATOR_ACCOUNT`, `RAW_OTP_CODE`, `RAW_IDENTITY_AUTHENTICATOR_APP`; update `RAW_IDENTITY_DETAIL` |
| `tests/identities/identities.test.ts` | Add assign/unlink tests |
| `tests/agent_identity.test.ts` | Add authenticator convenience method tests |

---

## Type Definitions

### `AuthenticatorApp`
Fields: `id` (UUID), `organization_id` (str), `identity_id` (UUID|null), `status` (str), `created_at`, `updated_at`

### `AuthenticatorAccount`
Fields: `id` (UUID), `authenticator_app_id` (UUID), `otp_type` ("totp"|"hotp"), `issuer` (str|null), `account_name` (str|null), `display_name` (str|null), `description` (str|null), `algorithm` ("sha1"|"sha256"|"sha512"), `digits` (6|8), `period` (int|null), `counter` (int|null), `status`, `created_at`, `updated_at`

### `OTPCode`
Fields: `otp_code` (str), `valid_for_seconds` (int|null), `otp_type`, `algorithm`, `digits`, `period` (int|null)

### `IdentityAuthenticatorApp` (in identities/types)

Embedded in the `AgentIdentityDetailResponse` when an authenticator app is linked. Matches the full `AuthenticatorAppResponse` from the server:

Fields: `id` (UUID), `organization_id` (str), `identity_id` (UUID|null), `status` (str), `created_at`, `updated_at`

---

## AgentIdentity Changes (Detailed)

The `AgentIdentity` domain object (Python: `agent_identity.py`, TS: `agent_identity.ts`) needs a new channel for authenticator apps, following the exact same pattern as mailbox and phone_number.

### New Fields & Properties

```
_authenticator_app: IdentityAuthenticatorApp | None  (set from data.authenticator_app in __init__)

@property authenticator_app -> IdentityAuthenticatorApp | None
```

### New Guard

```python
# Python
def _require_authenticator_app(self) -> None:
    if not self._authenticator_app:
        raise InkboxError(
            f"Identity '{self.agent_handle}' has no authenticator app assigned. "
            "Call identity.create_authenticator_app() or identity.assign_authenticator_app() first."
        )

# TypeScript
private _requireAuthenticatorApp(): void {
    if (!this._authenticatorApp) throw new InkboxAPIError(0, `Identity '${this.agentHandle}' has no authenticator app assigned. ...`);
}
```

### Channel Management Methods

| Method | Description | Delegates To |
|--------|-------------|-------------|
| `create_authenticator_app()` | Create a new authenticator app linked to this identity | `_inkbox._auth_apps.create(agent_handle=self.agent_handle)` → sets `_authenticator_app` from response |
| `assign_authenticator_app(authenticator_app_id)` | Link an existing unlinked app to this identity | `_inkbox._ids_resource.assign_authenticator_app(handle, app_id)` → sets `_authenticator_app` and `_data` from response |
| `unlink_authenticator_app()` | Unlink app from identity (does NOT delete the app) | Guard → `_inkbox._ids_resource.unlink_authenticator_app(handle)` → sets `_authenticator_app = None` |

### Authenticator Convenience Methods

These all call `_require_authenticator_app()` first, then delegate to the accounts resource using `self._authenticator_app.id` as the app ID.

| Method | Signature (Python) | Delegates To |
|--------|-------------------|-------------|
| `create_authenticator_account` | `(*, otpauth_uri: str, display_name: str \| None = None, description: str \| None = None) -> AuthenticatorAccount` | `_inkbox._auth_accounts.create(app_id, ...)` |
| `list_authenticator_accounts` | `() -> list[AuthenticatorAccount]` | `_inkbox._auth_accounts.list(app_id)` |
| `get_authenticator_account` | `(account_id: str) -> AuthenticatorAccount` | `_inkbox._auth_accounts.get(app_id, account_id)` |
| `update_authenticator_account` | `(account_id: str, *, display_name: str \| None = None, description: str \| None = None) -> AuthenticatorAccount` | `_inkbox._auth_accounts.update(app_id, account_id, ...)` |
| `delete_authenticator_account` | `(account_id: str) -> None` | `_inkbox._auth_accounts.delete(app_id, account_id)` |
| `generate_otp` | `(account_id: str) -> OTPCode` | `_inkbox._auth_accounts.generate_otp(app_id, account_id)` |

### Updates to Existing Methods

| Method | Change |
|--------|--------|
| `refresh()` | Add `self._authenticator_app = data.authenticator_app` |
| `update()` | Include `authenticator_app=self._authenticator_app` when reconstructing `_AgentIdentityData` |
| `__repr__` (Python) | Include authenticator app ID |

### TypeScript Equivalents

All methods above use camelCase naming (`createAuthenticatorApp`, `assignAuthenticatorApp`, `unlinkAuthenticatorApp`, `createAuthenticatorAccount`, `listAuthenticatorAccounts`, `getAuthenticatorAccount`, `updateAuthenticatorAccount`, `deleteAuthenticatorAccount`, `generateOtp`). All are `async` and return `Promise<T>`.

---

## API Endpoints → Resource Methods

| Endpoint | Resource Method |
|----------|----------------|
| `POST /authenticator/apps` | `AuthenticatorAppsResource.create(agent_handle=None)` |
| `GET /authenticator/apps` | `AuthenticatorAppsResource.list()` |
| `GET /authenticator/apps/{id}` | `AuthenticatorAppsResource.get(id)` |
| `DELETE /authenticator/apps/{id}` | `AuthenticatorAppsResource.delete(id)` |
| `POST /authenticator/apps/{id}/accounts` | `AuthenticatorAccountsResource.create(app_id, otpauth_uri=, ...)` |
| `GET /authenticator/apps/{id}/accounts` | `AuthenticatorAccountsResource.list(app_id)` |
| `GET /authenticator/apps/{id}/accounts/{aid}` | `AuthenticatorAccountsResource.get(app_id, account_id)` |
| `PATCH /authenticator/apps/{id}/accounts/{aid}` | `AuthenticatorAccountsResource.update(app_id, account_id, ...)` |
| `DELETE /authenticator/apps/{id}/accounts/{aid}` | `AuthenticatorAccountsResource.delete(app_id, account_id)` |
| `POST .../accounts/{aid}/generate-otp` | `AuthenticatorAccountsResource.generate_otp(app_id, account_id)` |
| `POST /identities/{handle}/authenticator_app` | `IdentitiesResource.assign_authenticator_app(handle, app_id)` |
| `DELETE /identities/{handle}/authenticator_app` | `IdentitiesResource.unlink_authenticator_app(handle)` |

---

## Implementation Order

1. **Types first** — authenticator types + `IdentityAuthenticatorApp` on identity types (both SDKs)
2. **HTTP transport + exceptions** — authenticator module boilerplate
3. **Resources** — apps and accounts resource classes
4. **Identity resource changes** — assign/unlink methods on `IdentitiesResource`
5. **Client wiring** — new transport + resources in `Inkbox` constructor
6. **AgentIdentity changes** — property, channel mgmt, convenience methods, guard
7. **Top-level exports** — `__init__.py` / `index.ts`
8. **Tests** — sample data, resource tests, identity tests, agent identity tests

---

## Verification

1. **Python**: `cd sdk/python && python -m pytest --cov --cov-report=term-missing --cov-fail-under=75`
2. **TypeScript**: `cd sdk/typescript && npx vitest run --coverage`
3. **Python lint**: `cd sdk/python && ruff check .`
4. **TypeScript type check**: `cd sdk/typescript && npx tsc --noEmit`

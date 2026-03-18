# Authenticator Subapp API Specification

Base path: `/api/v1/authenticator`

Authenticated endpoints require **API Key** (`X-Service-Token` header) or **JWT** (`Authorization: Bearer` header). The authenticated caller's `organization_id` is used for all access control and data scoping.

All endpoints in the authenticator subapp require API-key/JWT authentication.

Related identity-linking endpoints live on the identities subapp:
- `POST /api/v1/identities/{agent_handle}/authenticator_app`
- `DELETE /api/v1/identities/{agent_handle}/authenticator_app`

---

## 1. Authenticator Apps

### `POST /authenticator/apps`

Create a new authenticator app. An authenticator app is an org-scoped container for OTP accounts and may optionally be linked 1:1 to an existing agent identity.

**Path parameters:** none

**Query parameters:** none

**Request body:** `AuthenticatorAppCreateRequest`
```json
{
  "agent_handle": "sales-agent"
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `agent_handle` | `string \| null` | `null` | Optional agent identity handle to link this app to. Leading `@` is stripped. If omitted or `null`, the app is created unbound. |

**Response:** `201 Created` — `AuthenticatorAppResponse`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "organization_id": "org_123",
  "identity_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "status": "active",
  "created_at": "2026-03-18T12:00:00Z",
  "updated_at": "2026-03-18T12:00:00Z"
}
```

**Errors:**
- `403` — Organization ID required
- `404` — Agent identity not found
- `409` — Identity already has an authenticator app assigned

---

### `GET /authenticator/apps`

List all non-deleted authenticator apps belonging to the caller's organization.

**Path parameters:** none

**Query parameters:** none

**Request body:** none

**Response:** `200 OK` — `list[AuthenticatorAppResponse]`

**Errors:**
- `403` — Organization ID required

---

### `GET /authenticator/apps/{authenticator_app_id}`

Get a single authenticator app by ID.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Authenticator app ID |

**Query parameters:** none

**Request body:** none

**Response:** `200 OK` — `AuthenticatorAppResponse`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app not found

---

### `DELETE /authenticator/apps/{authenticator_app_id}`

Soft-delete an authenticator app. This also unlinks the app from its identity (if any) and soft-deletes all child authenticator accounts.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Authenticator app ID |

**Query parameters:** none

**Request body:** none

**Response:** `204 No Content`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app not found

---

## 2. Authenticator Accounts

### `POST /authenticator/apps/{authenticator_app_id}/accounts`

Create a new authenticator account from an `otpauth://` URI. The secret is parsed from the URI, validated, encrypted at rest, and never returned in the response.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |

**Query parameters:** none

**Request body:** `AuthenticatorAccountCreateRequest`
```json
{
  "otpauth_uri": "otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub",
  "display_name": "GitHub Work",
  "description": "Primary engineering account"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `otpauth_uri` | `string` | yes | `otpauth://totp/...` or `otpauth://hotp/...` URI. |
| `display_name` | `string \| null` | no | Optional user-managed label. Max 255 characters. |
| `description` | `string \| null` | no | Optional free-form notes for the account. |

**Parsed from the URI:**
- `otp_type`: `totp` or `hotp`
- `issuer`
- `account_name`
- `algorithm`: `sha1`, `sha256`, or `sha512`
- `digits`: `6` or `8`
- `period` for TOTP
- `counter` for HOTP

**Response:** `201 Created` — `AuthenticatorAccountResponse`
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "authenticator_app_id": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "otp_type": "totp",
  "issuer": "GitHub",
  "account_name": "alice@example.com",
  "display_name": "GitHub Work",
  "description": "Primary engineering account",
  "algorithm": "sha1",
  "digits": 6,
  "period": 30,
  "counter": null,
  "status": "active",
  "created_at": "2026-03-18T12:00:00Z",
  "updated_at": "2026-03-18T12:00:00Z"
}
```

**Errors:**
- `400` — Valid URI structure but invalid OTP parameters (missing secret, invalid base32, unsupported algorithm, invalid digits, invalid period/counter)
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app not found
- `422` — Request body validation failed (includes malformed `otpauth://` URI that doesn't match `otpauth://(totp|hotp)/...` pattern, missing fields, or invalid types)

---

### `GET /authenticator/apps/{authenticator_app_id}/accounts`

List all non-deleted authenticator accounts for an app.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |

**Query parameters:** none

**Request body:** none

**Response:** `200 OK` — `list[AuthenticatorAccountResponse]`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app not found

---

### `GET /authenticator/apps/{authenticator_app_id}/accounts/{account_id}`

Get a single authenticator account by ID.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |
| `account_id` | `UUID` | Authenticator account ID |

**Query parameters:** none

**Request body:** none

**Response:** `200 OK` — `AuthenticatorAccountResponse`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app or account not found

---

### `PATCH /authenticator/apps/{authenticator_app_id}/accounts/{account_id}`

Partial update of user-managed account metadata. Only `display_name` and `description` are mutable through this endpoint; OTP parameters imported from the URI are not editable here.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |
| `account_id` | `UUID` | Authenticator account ID |

**Query parameters:** none

**Request body:** `AuthenticatorAccountUpdateRequest`
```json
{
  "display_name": "Renamed Account",
  "description": "Updated notes"
}
```

| Field | Type | Description |
|-------|------|-------------|
| `display_name` | `string \| null` | Optional user-managed label. Max 255 characters. |
| `description` | `string \| null` | Optional notes. Set to `null` to clear. |

**Response:** `200 OK` — `AuthenticatorAccountResponse`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app or account not found
- `422` — Request body validation failed

---

### `DELETE /authenticator/apps/{authenticator_app_id}/accounts/{account_id}`

Soft-delete an authenticator account.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |
| `account_id` | `UUID` | Authenticator account ID |

**Query parameters:** none

**Request body:** none

**Response:** `204 No Content`

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app or account not found

---

### `POST /authenticator/apps/{authenticator_app_id}/accounts/{account_id}/generate-otp`

Generate the current OTP code for an account.

For TOTP accounts, the response includes `valid_for_seconds`, which is the number of seconds remaining before the current code expires.

For HOTP accounts, the stored counter is incremented atomically during the request and `valid_for_seconds` is `null`.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `authenticator_app_id` | `UUID` | Parent authenticator app ID |
| `account_id` | `UUID` | Authenticator account ID |

**Query parameters:** none

**Request body:** none

**Response:** `200 OK` — `OTPCodeResponse`
```json
{
  "otp_code": "123456",
  "valid_for_seconds": 17,
  "otp_type": "totp",
  "algorithm": "sha1",
  "digits": 6,
  "period": 30
}
```

**HOTP example response:**
```json
{
  "otp_code": "654321",
  "valid_for_seconds": null,
  "otp_type": "hotp",
  "algorithm": "sha256",
  "digits": 8,
  "period": null
}
```

**Errors:**
- `403` — Not authorized for this authenticator app
- `404` — Authenticator app or account not found
- `500` — Secret decryption or OTP generation failed unexpectedly

---

## 3. Identity Assignment

These endpoints are part of the identities subapp, but they are the supported way to bind or unbind an existing authenticator app after creation.

### `POST /api/v1/identities/{agent_handle}/authenticator_app`

Assign an existing authenticator app to an identity.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `agent_handle` | `string` | Agent identity handle. Leading `@` is accepted. |

**Query parameters:** none

**Request body:** `AssignAuthenticatorAppRequest`
```json
{
  "authenticator_app_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:** `200 OK` — `AgentIdentityDetailResponse`

**Errors:**
- `404` — Identity or authenticator app not found
- `409` — App already assigned to another identity, or identity already has a different authenticator app assigned

---

### `DELETE /api/v1/identities/{agent_handle}/authenticator_app`

Unlink the authenticator app currently assigned to an identity. The authenticator app itself is not deleted.

**Path parameters:**
| Name | Type | Description |
|------|------|-------------|
| `agent_handle` | `string` | Agent identity handle. Leading `@` is accepted. |

**Query parameters:** none

**Request body:** none

**Response:** `204 No Content`

**Errors:**
- `404` — Identity not found

---

## 4. OTP Behavior Notes

### Supported OTP Types

- `totp` — time-based OTP (RFC 6238)
- `hotp` — counter-based OTP (RFC 4226)

### Supported Algorithms

- `sha1`
- `sha256`
- `sha512`

### Default URI Values

If the `otpauth://` URI omits optional parameters, the current implementation uses:
- `algorithm=sha1`
- `digits=6`
- `period=30` for TOTP
- `counter=0` for HOTP

### Validation Rules

- The `secret` parameter must be valid base32. Unpadded secrets (common in real-world URIs) are accepted and normalized automatically.
- `digits` must be `6` or `8`.
- `period` must be a positive integer (TOTP only).
- `counter` must be a non-negative integer (HOTP only). Negative counters are rejected at import time.
- `algorithm` must be one of `sha1`, `sha256`, `sha512` (case-insensitive).

### Secret Handling

- The shared secret from the `otpauth://` URI is validated and stored encrypted at rest using Fernet envelope encryption.
- The plaintext secret is never returned by any API response.
- Account responses only expose non-secret OTP metadata such as issuer, account name, algorithm, digits, period, and counter.

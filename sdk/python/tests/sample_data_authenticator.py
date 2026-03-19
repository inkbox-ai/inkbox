"""Sample API response dicts for authenticator tests."""

AUTHENTICATOR_APP_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "identity_id": "eeee5555-0000-0000-0000-000000000001",
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
}

AUTHENTICATOR_APP_UNLINKED_DICT = {
    **AUTHENTICATOR_APP_DICT,
    "identity_id": None,
}

AUTHENTICATOR_ACCOUNT_DICT = {
    "id": "dddd4444-0000-0000-0000-000000000001",
    "authenticator_app_id": "cccc3333-0000-0000-0000-000000000001",
    "otp_type": "totp",
    "issuer": "GitHub",
    "account_name": "alice@example.com",
    "display_name": "GitHub Work",
    "description": "Primary engineering account",
    "algorithm": "sha1",
    "digits": 6,
    "period": 30,
    "counter": None,
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
}

OTP_CODE_DICT = {
    "otp_code": "123456",
    "valid_for_seconds": 17,
    "otp_type": "totp",
    "algorithm": "sha1",
    "digits": 6,
    "period": 30,
}

IDENTITY_AUTHENTICATOR_APP_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "organization_id": "org-abc123",
    "identity_id": "eeee5555-0000-0000-0000-000000000001",
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
}

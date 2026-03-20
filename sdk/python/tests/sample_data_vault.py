"""Sample API response dicts for vault tests."""

VAULT_INFO_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000001",
    "organization_id": "org_test_123",
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
    "key_count": 1,
    "secret_count": 2,
    "recovery_key_count": 4,
}

VAULT_KEY_DICT = {
    "id": "bbbb2222-0000-0000-0000-000000000001",
    "key_type": "primary",
    "name": "Admin Key",
    "description": None,
    "created_by": "user_abc",
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
}

VAULT_SECRET_DICT = {
    "id": "cccc3333-0000-0000-0000-000000000001",
    "name": "AWS Production",
    "description": "Production AWS credentials",
    "secret_type": "login",
    "status": "active",
    "created_at": "2026-03-18T12:00:00Z",
    "updated_at": "2026-03-18T12:00:00Z",
}

VAULT_SECRET_DETAIL_DICT = {
    **VAULT_SECRET_DICT,
    "encrypted_payload": "",  # populated dynamically in tests
}

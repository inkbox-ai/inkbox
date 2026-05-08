"""
sdk/python/tests/test_api_keys.py

Tests for ApiKeysResource and api_keys.types.
"""

from datetime import datetime, timezone
from unittest.mock import MagicMock
from uuid import UUID

from inkbox.api_keys.resources.api_keys import ApiKeysResource
from inkbox.api_keys.types import ApiKey, ApiKeyStatus, CreatedApiKey


# Sample server payload for `POST /api/v1/api-keys` (CreateApiKeyResponse).
API_KEY_RECORD_DICT = {
    "id": "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9",
    "organization_id": "org_test_123",
    "created_by": "user_test_456",
    "creator_type": "human",
    "scoped_identity_id": "11111111-1111-1111-1111-111111111111",
    "label": "Hermes gateway · sales-bot",
    "description": "Auto-minted by hermes setup gateway",
    "status": "active",
    "last4": "wxyz",
    "display_prefix": "ApiKey_67e166e4",
    "last_used_at": None,
    "expires_at": None,
    "revoked_at": None,
    "created_at": "2026-05-08T12:00:00+00:00",
    "updated_at": "2026-05-08T12:00:00+00:00",
}

CREATE_RESPONSE_DICT = {
    "api_key": "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9.secret_xyz",
    "record": API_KEY_RECORD_DICT,
}


def _resource():
    http = MagicMock()
    return ApiKeysResource(http), http


class TestApiKeysCreate:
    def test_creates_admin_scoped_key_with_label_only(self):
        res, http = _resource()
        admin_record = {**API_KEY_RECORD_DICT, "scoped_identity_id": None}
        http.post.return_value = {**CREATE_RESPONSE_DICT, "record": admin_record}

        result = res.create(label="My admin key")

        # Empty optional fields are omitted from the wire body
        http.post.assert_called_once_with(
            "/api-keys",
            json={"label": "My admin key"},
        )
        assert isinstance(result, CreatedApiKey)
        assert result.api_key.startswith("ApiKey_")
        assert result.record.scoped_identity_id is None

    def test_creates_identity_scoped_key(self):
        res, http = _resource()
        http.post.return_value = CREATE_RESPONSE_DICT
        identity_id = UUID("11111111-1111-1111-1111-111111111111")

        result = res.create(
            label="Hermes gateway · sales-bot",
            description="Auto-minted by hermes setup gateway",
            scoped_identity_id=identity_id,
        )

        http.post.assert_called_once_with(
            "/api-keys",
            json={
                "label": "Hermes gateway · sales-bot",
                "description": "Auto-minted by hermes setup gateway",
                "scoped_identity_id": "11111111-1111-1111-1111-111111111111",
            },
        )
        assert isinstance(result, CreatedApiKey)
        assert result.record.scoped_identity_id == identity_id

    def test_accepts_string_identity_id(self):
        res, http = _resource()
        http.post.return_value = CREATE_RESPONSE_DICT

        res.create(
            label="x",
            scoped_identity_id="11111111-1111-1111-1111-111111111111",
        )

        # String UUIDs are passed through untouched
        kwargs = http.post.call_args.kwargs
        assert kwargs["json"]["scoped_identity_id"] == "11111111-1111-1111-1111-111111111111"


class TestApiKeyParsing:
    def test_parses_full_record(self):
        record = ApiKey._from_dict(API_KEY_RECORD_DICT)

        assert record.id == "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9"
        assert record.organization_id == "org_test_123"
        assert record.creator_type == "human"
        assert record.scoped_identity_id == UUID("11111111-1111-1111-1111-111111111111")
        assert record.status == ApiKeyStatus.ACTIVE
        assert record.last4 == "wxyz"
        assert record.last_used_at is None
        assert record.created_at == datetime(2026, 5, 8, 12, 0, 0, tzinfo=timezone.utc)

    def test_admin_scoped_record_has_no_scoped_identity_id(self):
        record = ApiKey._from_dict({**API_KEY_RECORD_DICT, "scoped_identity_id": None})
        assert record.scoped_identity_id is None

    def test_revoked_status_parses(self):
        record = ApiKey._from_dict({
            **API_KEY_RECORD_DICT,
            "status": "revoked",
            "revoked_at": "2026-05-09T01:00:00+00:00",
        })
        assert record.status == ApiKeyStatus.REVOKED
        assert record.revoked_at == datetime(2026, 5, 9, 1, 0, 0, tzinfo=timezone.utc)

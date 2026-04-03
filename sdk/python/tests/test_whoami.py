"""
sdk/python/tests/test_whoami.py

Tests for the whoami types and client method.
"""

from unittest.mock import MagicMock

from inkbox import Inkbox
from inkbox.whoami.types import (
    WhoamiApiKeyResponse,
    WhoamiJwtResponse,
    _parse_whoami,
)

RAW_API_KEY = {
    "auth_type": "api_key",
    "auth_subtype": "human",
    "organization_id": "org_001",
    "created_by": "user_abc",
    "creator_type": "human",
    "key_id": "key_xyz",
    "label": "My Key",
    "description": "Dev key",
    "created_at": 1711929600.0,
    "last_used_at": 1711933200.0,
    "expires_at": None,
}

RAW_JWT = {
    "auth_type": "jwt",
    "auth_subtype": "clerk",
    "user_id": "user_abc",
    "email": "dev@example.com",
    "name": "Dev User",
    "organization_id": "org_001",
    "org_role": "admin",
    "org_slug": "my-org",
}


class TestParseWhoami:
    def test_parses_api_key_response(self):
        result = _parse_whoami(RAW_API_KEY)
        assert isinstance(result, WhoamiApiKeyResponse)
        assert result.auth_type == "api_key"
        assert result.organization_id == "org_001"
        assert result.key_id == "key_xyz"
        assert result.label == "My Key"
        assert result.expires_at is None

    def test_parses_jwt_response(self):
        result = _parse_whoami(RAW_JWT)
        assert isinstance(result, WhoamiJwtResponse)
        assert result.auth_type == "jwt"
        assert result.email == "dev@example.com"
        assert result.org_role == "admin"


class TestClientWhoami:
    def test_whoami_calls_root_api_http(self):
        client = Inkbox(api_key="sk-test")
        client._root_api_http = MagicMock()
        client._root_api_http.get = MagicMock(return_value=RAW_API_KEY)

        result = client.whoami()

        client._root_api_http.get.assert_called_once_with("/whoami")
        assert isinstance(result, WhoamiApiKeyResponse)
        assert result.organization_id == "org_001"
        client.close()

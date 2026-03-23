"""
sdk/python/tests/test_client.py

Tests for Inkbox unified client.
"""

from unittest.mock import patch

import pytest

from inkbox import Inkbox
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.signing_keys import SigningKeysResource


class TestInkboxPhoneResources:
    def test_creates_phone_resource_instances(self):
        client = Inkbox(api_key="sk-test")

        assert isinstance(client._numbers, PhoneNumbersResource)
        assert isinstance(client._calls, CallsResource)
        assert isinstance(client._transcripts, TranscriptsResource)
        assert isinstance(client._signing_keys, SigningKeysResource)

        client.close()

    def test_phone_http_base_url(self):
        client = Inkbox(api_key="sk-test", base_url="https://localhost:8000")
        assert str(client._phone_http._client.base_url) == "https://localhost:8000/api/v1/phone/"
        client.close()

    def test_rejects_http_base_url(self):
        with pytest.raises(ValueError, match="Only HTTPS base URLs are permitted"):
            Inkbox(api_key="sk-test", base_url="http://example.com")

    def test_allows_http_localhost(self):
        client = Inkbox(api_key="sk-test", base_url="http://localhost:8000")
        assert str(client._phone_http._client.base_url) == "http://localhost:8000/api/v1/phone/"
        client.close()

    def test_allows_http_127(self):
        client = Inkbox(api_key="sk-test", base_url="http://127.0.0.1:8000")
        assert str(client._phone_http._client.base_url) == "http://127.0.0.1:8000/api/v1/phone/"
        client.close()


class TestInkboxVaultKey:
    @patch("inkbox.client.VaultResource.unlock")
    def test_vault_key_triggers_unlock(self, mock_unlock):
        client = Inkbox(api_key="sk-test", vault_key="my-Vault-key-01!")
        mock_unlock.assert_called_once_with("my-Vault-key-01!")
        client.close()

    @patch("inkbox.client.VaultResource.unlock")
    def test_no_vault_key_skips_unlock(self, mock_unlock):
        client = Inkbox(api_key="sk-test")
        mock_unlock.assert_not_called()
        client.close()

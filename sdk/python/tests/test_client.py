"""
sdk/python/tests/test_client.py

Tests for Inkbox unified client.
"""

from unittest.mock import patch

import httpx
import pytest

from inkbox import Inkbox
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.resources.texts import TextsResource
from inkbox.phone.resources.transcripts import TranscriptsResource
from inkbox.signing_keys import SigningKeysResource


class TestInkboxPublicAccessors:
    def test_exposes_documented_org_level_resources(self):
        client = Inkbox(api_key="sk-test")

        assert client.messages is client._messages
        assert isinstance(client.messages, MessagesResource)
        assert client.threads is client._threads
        assert isinstance(client.threads, ThreadsResource)
        assert client.calls is client._calls
        assert isinstance(client.calls, CallsResource)
        assert client.texts is client._texts
        assert isinstance(client.texts, TextsResource)
        assert client.transcripts is client._transcripts
        assert isinstance(client.transcripts, TranscriptsResource)

        client.close()


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


class TestInkboxCookies:
    def test_mail_transport_reuses_cookie_from_previous_response(self):
        client = Inkbox(api_key="sk-test", base_url="https://test.inkbox.ai")

        client._mail_http._cookie_jar.store_from_headers(
            "https://test.inkbox.ai/api/v1/mail/first",
            {"set-cookie": "AWSALB=mail-cookie; Path=/api/v1/mail; HttpOnly"},
        )

        seen: dict[str, str | None] = {"cookie": None}

        def fake_send(request: httpx.Request) -> httpx.Response:
            seen["cookie"] = request.headers.get("cookie")
            return httpx.Response(200, json={}, request=request)

        client._mail_http._client.send = fake_send  # type: ignore[method-assign]
        client._mail_http.get("/second")

        assert seen["cookie"] == "AWSALB=mail-cookie"
        client.close()

    def test_client_shares_cookies_across_transports(self):
        client = Inkbox(api_key="sk-test", base_url="https://test.inkbox.ai")

        client._mail_http._cookie_jar.store_from_headers(
            "https://test.inkbox.ai/api/v1/mail/first",
            {"set-cookie": "AWSALB=shared-cookie; Path=/api/v1; HttpOnly"},
        )

        seen: dict[str, str | None] = {"cookie": None}

        def fake_send(request: httpx.Request) -> httpx.Response:
            seen["cookie"] = request.headers.get("cookie")
            return httpx.Response(200, json=[], request=request)

        client._phone_http._client.send = fake_send  # type: ignore[method-assign]
        client._phone_http.get("/numbers")

        assert seen["cookie"] == "AWSALB=shared-cookie"
        client.close()

    def test_client_does_not_leak_path_scoped_cookie_across_transports(self):
        client = Inkbox(api_key="sk-test", base_url="https://test.inkbox.ai")

        client._mail_http._cookie_jar.store_from_headers(
            "https://test.inkbox.ai/api/v1/mail/first",
            {"set-cookie": "AWSALB=mail-only; Path=/api/v1/mail; HttpOnly"},
        )

        seen: dict[str, str | None] = {"cookie": None}

        def fake_send(request: httpx.Request) -> httpx.Response:
            seen["cookie"] = request.headers.get("cookie")
            return httpx.Response(200, json=[], request=request)

        client._phone_http._client.send = fake_send  # type: ignore[method-assign]
        client._phone_http.get("/numbers")

        assert seen["cookie"] is None
        client.close()

    def test_cookie_jar_accepts_expires_attribute(self):
        client = Inkbox(api_key="sk-test", base_url="https://test.inkbox.ai")

        client._mail_http._cookie_jar.store_from_headers(
            "https://test.inkbox.ai/api/v1/mail/first",
            {"set-cookie": "AWSALB=exp-cookie; Expires=Wed, 21 Oct 2030 07:28:00 GMT; Path=/api/v1"},
        )

        seen: dict[str, str | None] = {"cookie": None}

        def fake_send(request: httpx.Request) -> httpx.Response:
            seen["cookie"] = request.headers.get("cookie")
            return httpx.Response(200, json={}, request=request)

        client._mail_http._client.send = fake_send  # type: ignore[method-assign]
        client._mail_http.get("/second")

        assert seen["cookie"] == "AWSALB=exp-cookie"
        client.close()

"""
sdk/python/tests/test_http_connect_retries.py

The SDK's httpx clients must retry connection setup; httpx does not by default.
"""

from unittest.mock import patch

import httpx

from inkbox import Inkbox
from inkbox._http import CONNECT_RETRIES, HttpTransport
from inkbox.a2a.client import A2AClient


def _captured_retries(build) -> list[int]:
    real = httpx.HTTPTransport
    seen: list[int] = []

    def _record(*args, **kwargs):
        seen.append(kwargs.get("retries", 0))
        return real(*args, **kwargs)

    with patch("httpx.HTTPTransport", side_effect=_record):
        build()
    return seen


class TestConnectRetries:
    def test_connect_retries_is_positive(self):
        assert CONNECT_RETRIES > 0

    def test_api_transport_retries_connection_setup(self):
        seen = _captured_retries(
            lambda: HttpTransport(api_key="sk-test", base_url="https://example.invalid")
        )

        assert seen == [CONNECT_RETRIES]

    def test_a2a_client_retries_connection_setup(self):
        seen = _captured_retries(
            lambda: A2AClient(api_key="sk-test", platform_base_url="https://example.invalid")
        )

        assert seen == [CONNECT_RETRIES]

    def test_one_shot_request_retries_connection_setup(self):
        # `Inkbox.signup` runs through the one-shot helper, which builds its own
        # client rather than reusing HttpTransport.
        seen = _captured_retries(
            lambda: _swallow_connect_error(
                lambda: Inkbox._one_shot_request(
                    "POST",
                    "/api/v1/agent-signup/",
                    json={},
                    base_url="https://127.0.0.1:1",
                    timeout=0.01,
                )
            )
        )

        assert seen == [CONNECT_RETRIES]


def _swallow_connect_error(call) -> None:
    try:
        call()
    except httpx.HTTPError:
        pass

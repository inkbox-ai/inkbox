"""Shared fixtures for Inkbox SDK tests."""

from __future__ import annotations

from unittest.mock import MagicMock

import httpx._transports.default as _httpx_transport
import pytest

from inkbox import Inkbox


@pytest.fixture(autouse=True, scope="session")
def _shared_default_ssl_context():
    """Build httpx's default verifying SSL context once per session.

    Every ``Inkbox`` builds ~10 transports, each loading the CA bundle;
    on Windows runners that dominated the suite's wall time.
    """
    real = _httpx_transport.create_ssl_context
    cache: dict = {}

    def create_ssl_context(verify=True, cert=None, trust_env=True):
        if verify is not True or cert is not None:
            return real(verify=verify, cert=cert, trust_env=trust_env)
        if trust_env not in cache:
            cache[trust_env] = real(verify=True, cert=None, trust_env=trust_env)
        return cache[trust_env]

    mp = pytest.MonkeyPatch()
    mp.setattr(_httpx_transport, "create_ssl_context", create_ssl_context)
    yield
    mp.undo()


class FakeHttpTransport:
    """Mock HTTP transport that returns pre-configured responses."""

    def __init__(self) -> None:
        self.get = MagicMock()
        self.post = MagicMock()
        self.post_multipart = MagicMock()
        self.put = MagicMock()
        self.patch = MagicMock()
        self.delete = MagicMock()
        self.close = MagicMock()


@pytest.fixture
def transport() -> FakeHttpTransport:
    return FakeHttpTransport()


@pytest.fixture
def client(transport: FakeHttpTransport) -> Inkbox:
    c = Inkbox(api_key="sk-test")
    c._phone_http = transport  # type: ignore[attr-defined]
    c._api_http = transport  # type: ignore[attr-defined]
    c._numbers._http = transport
    c._calls._http = transport
    c._texts._http = transport
    c._imessages._http = transport
    c._imessage_contact_rules._http = transport
    c._incoming_call_action._http = transport
    c._hosted_agent._http = transport
    c._signing_keys._http = transport
    c._webhook_subscriptions._http = transport
    return c

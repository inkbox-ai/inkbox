"""Shared fixtures for Inkbox SDK tests."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from inkbox import Inkbox


class FakeHttpTransport:
    """Mock HTTP transport that returns pre-configured responses."""

    def __init__(self) -> None:
        self.get = MagicMock()
        self.post = MagicMock()
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
    c._transcripts._http = transport
    c._signing_keys._http = transport
    return c

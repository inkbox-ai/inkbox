"""Tests for AsyncInkbox / AsyncAgentIdentity."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from sample_data_identities import IDENTITY_DETAIL_DICT

from inkbox import AsyncAgentIdentity, AsyncInkbox, Inkbox
from inkbox.agent_identity import AgentIdentity
from inkbox.async_client import AsyncProxy
from inkbox.identities.types import _AgentIdentityData
from inkbox.mail.resources.messages import MessagesResource


@pytest.mark.asyncio
async def test_async_inkbox_create_identity_returns_async_agent():
    client = AsyncInkbox(api_key="sk-test")
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)

    with patch.object(client._sync, "create_identity") as create:
        create.return_value = AgentIdentity(data, client._sync)
        identity = await client.create_identity("sales-agent")

    assert isinstance(identity, AsyncAgentIdentity)
    assert identity.agent_handle == "sales-agent"
    assert identity.sync.agent_handle == "sales-agent"
    create.assert_called_once_with("sales-agent")
    await client.aclose()


@pytest.mark.asyncio
async def test_async_agent_send_email_awaits_sync_impl():
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    sync_inkbox = MagicMock()
    sync_identity = AgentIdentity(data, sync_inkbox)
    async_identity = AsyncAgentIdentity(sync_identity)

    with patch.object(sync_identity, "send_email", return_value={"id": "m1"}) as send:
        result = await async_identity.send_email(
            to=["a@example.com"],
            subject="Hi",
            body_text="Hello",
        )

    assert result == {"id": "m1"}
    send.assert_called_once_with(
        to=["a@example.com"],
        subject="Hi",
        body_text="Hello",
    )


@pytest.mark.asyncio
async def test_async_iter_emails_drains_iterator_off_loop():
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    sync_identity = AgentIdentity(data, MagicMock())
    async_identity = AsyncAgentIdentity(sync_identity)

    def fake_iter():
        yield "one"
        yield "two"

    with patch.object(sync_identity, "iter_emails", side_effect=lambda **_: fake_iter()):
        result = await async_identity.iter_emails()

    assert result == ["one", "two"]


@pytest.mark.asyncio
async def test_resource_accessor_is_async_proxy():
    client = AsyncInkbox(api_key="sk-test")
    assert isinstance(client.messages, AsyncProxy)
    assert isinstance(client.sync.messages, MessagesResource)

    with patch.object(client._sync.messages, "list", return_value=[]) as list_messages:
        assert await client.messages.list() == []
        list_messages.assert_called_once()

    await client.aclose()


@pytest.mark.asyncio
async def test_async_context_manager_closes():
    client = AsyncInkbox(api_key="sk-test")
    with patch.object(client._sync, "close") as close:
        async with client:
            pass
        close.assert_called_once()


@pytest.mark.asyncio
async def test_classmethod_signup_delegates():
    with patch.object(Inkbox, "signup", return_value="ok") as signup:
        result = await AsyncInkbox.signup(
            "human@example.com",
            note_to_human="please",
        )
    assert result == "ok"
    signup.assert_called_once()


def test_exports():
    from inkbox import AsyncAgentIdentity as A
    from inkbox import AsyncInkbox as B

    assert A is AsyncAgentIdentity
    assert B is AsyncInkbox

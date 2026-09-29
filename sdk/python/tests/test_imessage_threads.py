from dataclasses import fields
from uuid import UUID

import pytest
from inkbox import IMessage, IMessageThread
from inkbox.imessage import IMessageThread as ExportedThread
from test_imessage import IMESSAGE_DICT, CONVO_ID, MSG_ID, IDENTITY_ID

THREAD_ID = "99999999-0000-0000-0000-000000000001"
REPLY_ID = "88888888-0000-0000-0000-000000000001"
ROW = {**IMESSAGE_DICT, "id": REPLY_ID, "reply_to_message_id": MSG_ID, "thread_id": THREAD_ID,
       "thread_root_message_id": MSG_ID}
PAGE = {"thread_id": THREAD_ID, "conversation_id": CONVO_ID,
        "thread_root_message_id": MSG_ID, "messages": [ROW], "next_cursor": "next:opaque"}


def test_thread_metadata_legacy_null_and_constructor_compatibility():
    legacy = IMessage._from_dict(IMESSAGE_DICT)
    assert legacy.thread_id is None and legacy.reply_to_message_id is None
    assert legacy.thread_root_message_id is None
    assert ExportedThread is IMessageThread
    assert [f.name for f in fields(IMessage)][-3:] == ["reply_to_message_id", "thread_id", "thread_root_message_id"]
    assert IMessage._from_dict({**IMESSAGE_DICT, "thread_id": None}).thread_id is None
    assert IMessage._from_dict(ROW).thread_id == UUID(THREAD_ID)


def test_send_thread_reply_exact_wire(client, transport):
    transport.post.return_value = {"message": ROW}
    msg = client.imessages.send(conversation_id=UUID(CONVO_ID), reply_to_message_id=UUID(MSG_ID),
                                text="Agreed", agent_identity_id=IDENTITY_ID, idempotency_key="reply-one")
    transport.post.assert_called_once_with("/messages", json={"conversation_id": CONVO_ID,
        "reply_to_message_id": MSG_ID, "text": "Agreed"}, params={"agent_identity_id": IDENTITY_ID},
        headers={"Idempotency-Key": "reply-one", "Prefer": "idempotency-replay"})
    assert msg.thread_root_message_id == UUID(MSG_ID)


def test_plain_send_omits_thread_target(client, transport):
    transport.post.return_value = {"message": IMESSAGE_DICT}
    client.imessages.send(conversation_id=CONVO_ID, text="Hello")
    assert "reply_to_message_id" not in transport.post.call_args.kwargs["json"]


@pytest.mark.parametrize("kwargs", [{}, {"to": "+15550100101"}, {"to": "+15550100101", "conversation_id": CONVO_ID}])
def test_reply_requires_only_conversation_destination(client, transport, kwargs):
    with pytest.raises(ValueError, match="requires conversation_id"):
        client.imessages.send(reply_to_message_id=MSG_ID, text="Hello", **kwargs)
    transport.post.assert_not_called()


def test_thread_lookup_cursor_and_message_parsing(client, transport):
    transport.get.return_value = PAGE
    page = client.imessages.get_thread(MSG_ID, limit=2, cursor="prior+/=", agent_identity_id=IDENTITY_ID)
    transport.get.assert_called_once_with(f"/messages/{MSG_ID}/thread", params={
        "limit": 2, "cursor": "prior+/=", "agent_identity_id": IDENTITY_ID})
    assert isinstance(page, IMessageThread) and page.next_cursor == "next:opaque"
    assert page.messages[0].reply_to_message_id == UUID(MSG_ID)
    assert page.thread_id == UUID(THREAD_ID)


def test_conversation_thread_defaults_and_null_singleton(client, transport):
    transport.get.return_value = {**PAGE, "thread_id": None, "thread_root_message_id": None, "next_cursor": None}
    page = client.imessages.get_conversation_thread(CONVO_ID, THREAD_ID)
    transport.get.assert_called_once_with(f"/conversations/{CONVO_ID}/threads/{THREAD_ID}", params={"limit": 50})
    assert page.thread_id is None and page.thread_root_message_id is None and page.next_cursor is None


def test_thread_list_filter_keeps_offset_contract(client, transport):
    transport.get.return_value = [ROW]
    rows = client.imessages.list(conversation_id=CONVO_ID, thread_id=THREAD_ID, offset=10)
    transport.get.assert_called_once_with("/messages", params={"conversation_id": CONVO_ID,
        "thread_id": THREAD_ID, "limit": 50, "offset": 10})
    assert rows[0].thread_id == UUID(THREAD_ID)


def test_thread_list_requires_conversation(client, transport):
    with pytest.raises(ValueError, match="thread_id requires conversation_id"):
        client.imessages.list(thread_id=THREAD_ID)
    transport.get.assert_not_called()


def test_identity_helpers_scope_every_thread_operation():
    from unittest.mock import MagicMock
    from inkbox.agent_identity import AgentIdentity
    from inkbox.identities.types import _AgentIdentityData
    from sample_data_identities import IDENTITY_DETAIL_DICT

    sdk = MagicMock()
    identity = AgentIdentity(_AgentIdentityData._from_dict({**IDENTITY_DETAIL_DICT, "imessage_enabled": True}), sdk)
    identity.get_imessage(MSG_ID)
    sdk._imessages.get.assert_called_once_with(MSG_ID, agent_identity_id=identity.id)
    identity.get_imessage_thread(MSG_ID, cursor="next")
    sdk._imessages.get_thread.assert_called_once_with(MSG_ID, limit=50, cursor="next", agent_identity_id=identity.id)
    identity.get_imessage_conversation_thread(CONVO_ID, THREAD_ID, limit=2)
    sdk._imessages.get_conversation_thread.assert_called_once_with(CONVO_ID, THREAD_ID, limit=2, cursor=None, agent_identity_id=identity.id)
    identity.send_imessage(conversation_id=CONVO_ID, reply_to_message_id=MSG_ID, text="Agreed")
    assert sdk._imessages.send.call_args.kwargs["reply_to_message_id"] == MSG_ID
    assert sdk._imessages.send.call_args.kwargs["agent_identity_id"] == identity.id
    identity.list_imessages(conversation_id=CONVO_ID, thread_id=THREAD_ID)
    assert sdk._imessages.list.call_args.kwargs["thread_id"] == THREAD_ID
    assert sdk._imessages.list.call_args.kwargs["agent_identity_id"] == identity.id


def test_reply_retry_preserves_exact_target_body_and_key(client, transport, monkeypatch):
    import httpx
    import inkbox._message_requests

    monkeypatch.setattr(inkbox._message_requests.time, "sleep", lambda _: None)
    transport.post.side_effect = [httpx.ConnectError("temporary connection failure"), {"message": ROW}]
    client.imessages.send(conversation_id=CONVO_ID, reply_to_message_id=MSG_ID,
                          text="Agreed", idempotency_key="reply-one")
    assert transport.post.call_count == 2
    first, second = transport.post.call_args_list
    assert first == second
    assert first.kwargs["json"]["reply_to_message_id"] == MSG_ID
    assert first.kwargs["headers"]["Idempotency-Key"] == "reply-one"

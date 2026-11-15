"""Shared-number connections, router lookup, and reply-first wire contracts."""

import json
from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest

from inkbox import InkboxAPIError, WhatsAppAwaitingInboundError
from inkbox._http import HttpTransport
from inkbox.whatsapp import WhatsAppResource

S = json.loads((Path(__file__).parents[3] / "tests/fixtures/whatsapp-shared.json").read_text())
OWNER = S["identity_id"]
RECIPIENT = S["recipient_number"]


def test_connect_sends_exact_body_and_required_key_without_a_message():
    http = MagicMock()
    http.post.return_value = S["connect"]
    result = WhatsAppResource(http).connect(
        agent_identity_id=OWNER, recipient_number=RECIPIENT, idempotency_key="connect-1"
    )
    http.post.assert_called_once_with(
        "/connect",
        json={"agent_identity_id": OWNER, "recipient_number": RECIPIENT},
        headers={"Idempotency-Key": "connect-1"},
    )
    assert result.number == S["connect"]["assigned_number"]
    assert result.awaiting_inbound is True and result.already_connected is False
    assert result.connection.id == UUID(S["assignment"]["id"])
    assert result.assignment.status == "active"
    assert result.conversation_id == UUID(S["connect"]["conversation_id"])
    assert result.connection.recipient_number == RECIPIENT


@pytest.mark.parametrize(
    "kwargs",
    [
        {"recipient_number": "+15555550101,+15555550102", "idempotency_key": "k"},
        {"recipient_number": "5555550101", "idempotency_key": "k"},
        {"recipient_number": RECIPIENT, "idempotency_key": ""},
        {"recipient_number": RECIPIENT, "idempotency_key": " "},
        {"recipient_number": RECIPIENT, "idempotency_key": "k" * 256},
    ],
)
def test_connect_and_disconnect_reject_invalid_input_before_requesting(kwargs):
    http = MagicMock()
    resource = WhatsAppResource(http)
    for method in (resource.connect, resource.disconnect):
        with pytest.raises(ValueError):
            method(agent_identity_id=OWNER, **kwargs)
    with pytest.raises(TypeError):
        resource.connect(agent_identity_id=OWNER, recipient_number=RECIPIENT)  # type: ignore[call-arg]
    http.post.assert_not_called()


def test_disconnect_preserves_released_and_already_disconnected_results():
    http = MagicMock()
    http.post.side_effect = [S["disconnect"], S["already_disconnected"]]
    resource = WhatsAppResource(http)
    first = resource.disconnect(agent_identity_id=OWNER, recipient_number=RECIPIENT, idempotency_key="d-1")
    assert http.post.call_args.args[0] == "/disconnect"
    assert http.post.call_args.kwargs["json"] == {"agent_identity_id": OWNER, "recipient_number": RECIPIENT}
    assert http.post.call_args.kwargs["headers"] == {"Idempotency-Key": "d-1"}
    assert first.connection_id == UUID(S["disconnect"]["assignment_id"]) and first.disconnected
    second = resource.disconnect(agent_identity_id=OWNER, recipient_number=RECIPIENT, idempotency_key="d-2")
    assert second.connection_id is None and second.disconnected


def test_list_connections_and_router():
    http = MagicMock()
    http.get.side_effect = [[S["assignment"]], S["triage"]]
    resource = WhatsAppResource(http)
    rows = resource.list_connections(agent_identity_id=OWNER)
    http.get.assert_called_with("/assignments", params={"agent_identity_id": OWNER, "limit": 50, "offset": 0})
    assert [str(row.id) for row in rows] == [S["assignment"]["id"]]
    assert rows[0].updated_at.isoformat().startswith("2026-10-01T12:05")
    router = resource.get_router()
    http.get.assert_called_with("/triage-number", params={})
    assert (router.number, router.connect_command) == ("+15555550180", "connect @agent")


def test_media_upload_forwards_optional_recipient_number():
    http = MagicMock()
    http.post_multipart.return_value = {
        "id": "40000000-0000-4000-8000-000000000004", "filename": "a.png",
        "content_type": "image/png", "size": 3, "status": "ready", "url": None,
    }
    resource = WhatsAppResource(http)
    resource.upload_media(content=b"png", filename="a.png", agent_identity_id=OWNER, recipient_number=RECIPIENT)
    assert http.post_multipart.call_args.kwargs["params"] == {
        "agent_identity_id": OWNER, "recipient_number": RECIPIENT,
    }
    resource.upload_media(content=b"png", filename="a.png", agent_identity_id=OWNER)
    assert http.post_multipart.call_args.kwargs["params"] == {"agent_identity_id": OWNER}
    with pytest.raises(ValueError):
        resource.upload_media(content=b"png", filename="a.png", recipient_number="not-a-number")
    assert http.post_multipart.call_count == 2


def _transport(handler):
    http = HttpTransport("test-only", "https://inkbox.ai/api/v1/whatsapp")
    http._client.close()
    http._client = httpx.Client(
        base_url="https://inkbox.ai/api/v1/whatsapp", transport=httpx.MockTransport(handler)
    )
    return http


def test_awaiting_inbound_is_typed_and_not_retried_with_a_new_key():
    requests = []

    def handler(request):
        requests.append(request)
        return httpx.Response(409, json={"detail": S["awaiting_inbound_error"]})

    http = _transport(handler)
    try:
        with pytest.raises(WhatsAppAwaitingInboundError) as caught:
            WhatsAppResource(http).send(
                to=RECIPIENT, text="Hello", agent_identity_id=OWNER, idempotency_key="reply-1"
            )
    finally:
        http.close()
    error = caught.value
    assert isinstance(error, InkboxAPIError) and error.status_code == 409
    assert error.retry_condition == "recipient_message"
    assert error.message.startswith("This recipient has not messaged")
    assert error.idempotency_key == "reply-1"
    assert len(requests) == 1


def test_assignment_delete_typing_and_optional_read_boundary_use_current_wire():
    http = MagicMock()
    resource = WhatsAppResource(http)
    assignment_id = S["assignment"]["id"]
    resource.delete_assignment(assignment_id)
    http.delete.assert_called_once_with(f"/assignments/{assignment_id}")
    conversation = S["connect"]["conversation_id"]
    http.post.return_value = {"status": "sent"}
    assert resource.send_typing(conversation, agent_identity_id=OWNER) == {"status": "sent"}
    http.post.assert_called_with("/typing", json={"conversation_id": conversation}, params={"agent_identity_id": OWNER})
    http.post.return_value = {"conversation_id": conversation, "updated_count": 2, "read_receipts_sent": True}
    assert resource.mark_read(conversation, agent_identity_id=OWNER).read_receipts_sent
    http.post.assert_called_with("/mark-read", json={"conversation_id": conversation}, params={"agent_identity_id": OWNER})
    http.post.return_value = {**S["connect"], "assigned_number": None}
    assert resource.connect(agent_identity_id=OWNER, recipient_number=RECIPIENT, idempotency_key="global").assigned_number is None


def test_identity_enablement_creation_and_update_preserve_false_and_omission():
    from inkbox.identities.resources.identities import IdentitiesResource
    http = MagicMock()
    data = {"id": OWNER, "organization_id": "org_example", "agent_handle": "agent",
            "created_at": S["assignment"]["created_at"], "updated_at": S["assignment"]["updated_at"]}
    http.post.return_value = http.patch.return_value = data
    resource = IdentitiesResource(http)
    resource.create(agent_handle="agent", whatsapp_enabled=True)
    assert http.post.call_args.kwargs["json"]["whatsapp_enabled"] is True
    resource.update("agent", whatsapp_enabled=False)
    assert http.patch.call_args.kwargs["json"] == {"whatsapp_enabled": False}
    resource.create(agent_handle="agent")
    assert "whatsapp_enabled" not in http.post.call_args.kwargs["json"]

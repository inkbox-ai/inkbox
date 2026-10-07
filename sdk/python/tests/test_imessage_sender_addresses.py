"""Exercise sender-address reads and receive-only errors through the real SDK."""

import json
from pathlib import Path
from typing import cast
from unittest.mock import patch

import httpx
import pytest

from inkbox import Inkbox, IMessage, IMessageWebhookPayload
from inkbox.exceptions import InkboxAPIError

FIXTURE = json.loads(
    (Path(__file__).resolve().parents[3] / "tests/fixtures/imessage_sender_addresses.json").read_text()
)


@pytest.mark.parametrize("sender", [FIXTURE["sender"], "+15551234567"])
def test_sender_addresses_survive_message_conversation_assignment_and_webhook_reads(sender):
    message = {**FIXTURE["message"], "remote_number": sender, "reactions": [
        {**FIXTURE["message"]["reactions"][0], "remote_number": sender},
    ]}
    conversation = {**FIXTURE["conversation"], "remote_number": sender, "participants": [sender]}
    assignment = {**FIXTURE["assignment"], "remote_number": sender}
    responses = {
        "/messages": [message],
        f"/messages/{message['id']}": message,
        "/conversations": [conversation],
        f"/conversations/{conversation['id']}": conversation,
        "/assignments": [assignment],
    }
    requests = []

    def respond(request):
        requests.append(request)
        path = request.url.path.removeprefix("/api/v1/imessage")
        return httpx.Response(200, json=responses[path])

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox("test-key", base_url="https://example.com")
    with client:
        resource = client.imessages
        received = resource.get(message["id"])
        assert received.remote_number == sender
        assert received.reactions[0].remote_number == sender
        assert resource.list(conversation_id=conversation["id"])[0].remote_number == sender
        row = resource.get_conversation(conversation["id"])
        assert row.remote_number == sender and row.participants == [sender]
        summary = resource.list_conversations()[0]
        assert summary.remote_number == sender and summary.participants == [sender]
        assert resource.list_assignments()[0].remote_number == sender
    assert len(requests) == 5
    assert all(request.method == "GET" for request in requests)

    payload = cast(IMessageWebhookPayload, json.loads(json.dumps({
        **FIXTURE["webhook"], "data": {**FIXTURE["webhook"]["data"], "message": message},
    })))
    assert payload["event_type"] == "imessage.received"
    assert payload["data"]["message"] is not None
    parsed = IMessage._from_dict(dict(payload["data"]["message"]))
    assert parsed.remote_number == sender
    assert parsed.reactions[0].remote_number == sender
    assert parsed.sender_number is None and not parsed.is_group


@pytest.mark.parametrize("operation,path", [
    ("send", "/messages"),
    ("send_reaction", "/reactions"),
    ("remove_reaction", "/reactions/50000000-0000-4000-8000-000000000005"),
    ("mark_conversation_read", "/mark-read"),
    ("send_typing", "/typing"),
])
def test_receive_only_error_preserves_status_and_detail_without_retry(operation, path):
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(422, json={"detail": FIXTURE["error"]})

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox("test-key", base_url="https://example.com")
    with client:
        resource = client.imessages
        operations = {
            "send": lambda: resource.send(conversation_id=FIXTURE["conversation"]["id"], text="Hello"),
            "send_reaction": lambda: resource.send_reaction(message_id=FIXTURE["message"]["id"], reaction="like"),
            "remove_reaction": lambda: resource.remove_reaction("50000000-0000-4000-8000-000000000005"),
            "mark_conversation_read": lambda: resource.mark_conversation_read(FIXTURE["conversation"]["id"]),
            "send_typing": lambda: resource.send_typing(FIXTURE["conversation"]["id"]),
        }
        with pytest.raises(InkboxAPIError) as raised:
            operations[operation]()
        assert raised.value.status_code == 422
        assert raised.value.detail == FIXTURE["error"]
    assert len(requests) == 1
    assert requests[0].url.path == f"/api/v1/imessage{path}"
    assert requests[0].method == ("DELETE" if operation == "remove_reaction" else "POST")

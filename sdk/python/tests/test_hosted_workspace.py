import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from inkbox._http import HttpTransport
from inkbox.hosted_workspace import HostedWorkspace
from inkbox.exceptions import InkboxAPIError

FIXTURES = Path(__file__).resolve().parents[3] / "contracts"


def test_rename_forwards_title_and_idempotency_key():
    http = MagicMock()
    HostedWorkspace(http, "example-agent").rename_conversation(
        "conversation", "Inbox review", idempotency_key="rename-once"
    )
    http.patch.assert_called_once_with(
        "/example-agent/hosting/chat/conversations/conversation",
        json={"title": "Inbox review"}, headers={"Idempotency-Key": "rename-once"},
    )


def test_versioned_response_and_cursor_are_forwarded_without_replay():
    http = MagicMock()
    workspace = HostedWorkspace(http, "example-agent")
    answer = {"kind": "approval", "decision": "deny"}
    workspace.respond(
        "conversation", "request", 3, answer, idempotency_key="answer-once"
    )
    http.post.assert_called_once_with(
        "/example-agent/hosting/chat/conversations/conversation/interactions/request/response",
        json={"expected_version": 3, "response": answer},
        headers={"Idempotency-Key": "answer-once"},
    )
    workspace.messages("conversation", snapshot="snapshot-token", after="page-token")
    assert http.get.call_args.kwargs["params"] == {
        "after": "page-token",
        "snapshot": "snapshot-token",
        "limit": 50,
    }


def test_shared_events_stream_and_close():
    events = json.loads((FIXTURES / "events-v1.json").read_text())
    body = ": heartbeat\r\n\r\n" + "".join(
        "id: " + e["cursor"] + "\r\ndata: " + json.dumps(e) + "\r\n\r\n" for e in events
    )
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(
            200, headers={"content-type": "text/event-stream"}, content=body
        )

    with HttpTransport("synthetic-key", "https://example.test") as transport:
        transport._client.close()
        transport._client = httpx.Client(
            base_url="https://example.test", transport=httpx.MockTransport(respond)
        )
        assert (
            list(
                HostedWorkspace(transport, "example-agent").stream_events(
                    "conversation", after="resume-token"
                )
            )
            == events
        )
    assert len(requests) == 1
    assert requests[0].url.params["after"] == "resume-token"
    assert requests[0].headers["Accept"] == "text/event-stream"


def test_stream_rejects_oversized_frame():
    with HttpTransport("synthetic-key", "https://example.test") as transport:
        transport._client.close()
        transport._client = httpx.Client(
            base_url="https://example.test",
            transport=httpx.MockTransport(
                lambda _: httpx.Response(200, content=b"data: " + b"x" * 1048576)
            ),
        )
        with pytest.raises(ValueError, match="limit"):
            list(transport.iter_sse("/events"))


def test_stream_reset_is_an_actionable_error_without_replay():
    with HttpTransport("synthetic-key", "https://example.test") as transport:
        transport._client.close()
        transport._client = httpx.Client(
            base_url="https://example.test",
            transport=httpx.MockTransport(lambda _: httpx.Response(
                200, content='event: stream.reset\ndata: {"code":"event_cursor_expired","status":410}\n\n'
            )),
        )
        with pytest.raises(InkboxAPIError) as error:
            list(transport.iter_sse("/events"))
        assert error.value.status_code == 410
        assert error.value.detail["code"] == "event_cursor_expired"


@pytest.mark.parametrize("model", [None, "gpt-6.1-sol"])
def test_turn_model_is_forwarded_only_when_selected(model):
    http = MagicMock()
    workspace = HostedWorkspace(http, "example-agent")
    content = [{"type": "text", "text": "Hello"}]
    workspace.send("conversation", content, idempotency_key="turn-once", model=model)
    expected = {"content": content}
    if model is not None:
        expected["model"] = model
    assert http.post.call_args.kwargs["json"] == expected


def test_permission_mode_uses_chat_patch_and_validates_mode():
    http = MagicMock()
    workspace = HostedWorkspace(http, "example-agent")
    workspace.set_permission_mode("conversation", "yolo", idempotency_key="mode-once")
    http.patch.assert_called_once_with(
        "/example-agent/hosting/chat/conversations/conversation",
        json={"permission_mode": "yolo"}, headers={"Idempotency-Key": "mode-once"},
    )
    with pytest.raises(ValueError, match="mode must"):
        workspace.set_permission_mode("conversation", "invalid", idempotency_key="mode-twice")
    assert http.patch.call_count == 1

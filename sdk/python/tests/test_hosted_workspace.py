import json
from pathlib import Path
from unittest.mock import MagicMock

import httpx
import pytest
from inkbox._http import HttpTransport
from inkbox.hosted_workspace import HostedWorkspace

FIXTURES = Path(__file__).resolve().parents[3] / "contracts"


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

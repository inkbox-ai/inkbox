"""A2A inbox and standard-client wire contract tests."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import httpx
import pytest

from inkbox.a2a.client import A2AClient
from inkbox.a2a.resource import A2AResource
from inkbox.a2a.types import A2AReplyIntent, A2ATaskState
from inkbox.exceptions import InkboxError


def test_inbox_tasks_use_exact_path_and_query() -> None:
    http = MagicMock()
    http.get.return_value = {"items": [], "next_cursor": None}
    resource = A2AResource(http)

    page = resource.tasks(
        "helper",
        state=A2ATaskState.SUBMITTED,
        cursor="next",
        limit=25,
    )

    assert page.items == []
    http.get.assert_called_once_with(
        "/identities/helper/a2a/tasks",
        params={
            "state": "submitted",
            "context_id": None,
            "cursor": "next",
            "limit": 25,
        },
    )


def test_inbox_reply_uses_exact_wire_body() -> None:
    http = MagicMock()
    http.post.return_value = {
        "id": "task-1",
        "context_id": "context-1",
        "state": "completed",
        "caller": {
            "identity_id": "caller-1",
            "organization_id": "org-1",
            "handle": "caller",
        },
        "messages": [],
        "transitions": [],
        "completed_at": "2026-07-23T00:00:00Z",
        "created_at": "2026-07-23T00:00:00Z",
        "updated_at": "2026-07-23T00:00:00Z",
    }
    resource = A2AResource(http)

    task = resource.reply(
        "helper",
        "task-1",
        intent=A2AReplyIntent.COMPLETE,
        text="Done",
    )

    assert task.state is A2ATaskState.COMPLETED
    http.post.assert_called_once_with(
        "/identities/helper/a2a/tasks/task-1/reply",
        json={"intent": "complete", "parts": [{"text": "Done"}]},
    )


def test_a2a_client_fetches_card_without_key_then_pins_rpc_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "name": "@helper",
                    "supportedInterfaces": [
                        {
                            "url": "https://inkbox.ai/a2a/helper",
                            "protocolBinding": "JSONRPC",
                            "protocolVersion": "1.0",
                        }
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "id": "task-1",
                    "contextId": "context-1",
                    "status": {"state": "TASK_STATE_SUBMITTED"},
                },
            },
        )

    client = A2AClient(api_key="ApiKey_secret", platform_base_url="https://inkbox.ai")
    client._client.close()
    client._client = httpx.Client(
        transport=httpx.MockTransport(handler),
        follow_redirects=False,
    )

    target = client.fetch_card("https://inkbox.ai/a2a/helper/card")
    result = client.send(target, text="Investigate", message_id="msg-1")

    assert "X-API-Key" not in requests[0].headers
    assert requests[1].headers["X-API-Key"] == "ApiKey_secret"
    assert requests[1].headers["A2A-Version"] == "1.0"
    body = json.loads(requests[1].content)
    assert body == {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "SendMessage",
        "params": {
            "message": {
                "messageId": "msg-1",
                "role": "ROLE_USER",
                "parts": [{"text": "Investigate"}],
            },
            "configuration": {"returnImmediately": True},
        },
    }
    assert result.kind == "task"
    assert result.task is not None
    assert result.task.id == "task-1"
    client.close()


def test_external_card_never_receives_inkbox_key() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "name": "external",
                    "supportedInterfaces": [
                        {
                            "url": "https://agent.example/rpc",
                            "protocolBinding": "JSONRPC",
                            "protocolVersion": "1.0",
                        }
                    ],
                },
            )
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "id": "task-1",
                    "contextId": "context-1",
                    "status": {"state": "TASK_STATE_SUBMITTED"},
                },
            },
        )

    client = A2AClient(api_key="ApiKey_secret", platform_base_url="https://inkbox.ai")
    client._client.close()
    client._client = httpx.Client(transport=httpx.MockTransport(handler))
    target = client.fetch_card("https://agent.example/card")
    client.get_task(target, "task-1")

    assert all("X-API-Key" not in request.headers for request in requests)
    client.close()


def test_card_redirect_is_refused() -> None:
    client = A2AClient(api_key="ApiKey_secret", platform_base_url="https://inkbox.ai")
    client._client.close()
    client._client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                302,
                headers={"Location": "https://attacker.example/card"},
            )
        )
    )

    with pytest.raises(InkboxError, match="redirects are refused"):
        client.fetch_card("https://inkbox.ai/a2a/helper/card")
    client.close()

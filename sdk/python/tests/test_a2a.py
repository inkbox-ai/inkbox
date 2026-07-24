"""A2A inbox and standard-client wire contract tests."""

from __future__ import annotations

import json
from unittest.mock import MagicMock, call

import httpx
import pytest

from inkbox.a2a.client import A2AClient
from inkbox.a2a.resource import A2AResource
from inkbox.a2a.types import (
    A2AHistoryDirection,
    A2AMessageRole,
    A2AReplyIntent,
    A2ATaskState,
)
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
            "direction": None,
            "requester_handle": None,
            "worker_handle": None,
            "state": "submitted",
            "context_id": None,
            "q": None,
            "since": None,
            "cursor": "next",
            "limit": 25,
        },
    )


def test_sent_tasks_use_exact_path_and_parse_target() -> None:
    http = MagicMock()
    http.get.return_value = {
        "items": [
            {
                "id": "task-1",
                "context_id": "context-1",
                "state": "completed",
                "caller": {
                    "identity_id": "caller-1",
                    "organization_id": "org-caller",
                    "handle": "caller",
                },
                "target": {
                    "identity_id": "target-1",
                    "organization_id": "org-target",
                    "handle": "helper",
                },
                "messages": [],
                "history_truncated": True,
                "completed_at": "2026-07-24T00:00:00Z",
                "created_at": "2026-07-24T00:00:00Z",
                "updated_at": "2026-07-24T00:00:00Z",
            }
        ],
        "next_cursor": None,
    }
    resource = A2AResource(http)

    page = resource.sent_tasks(
        "caller",
        state=A2ATaskState.COMPLETED,
        cursor="next",
        limit=25,
    )

    assert page.items[0].target is not None
    assert page.items[0].target.handle == "helper"
    assert page.items[0].history_truncated is True
    http.get.assert_called_once_with(
        "/identities/caller/a2a/sent/tasks",
        params={
            "requester_handle": None,
            "worker_handle": None,
            "state": "completed",
            "context_id": None,
            "q": None,
            "since": None,
            "cursor": "next",
            "limit": 25,
        },
    )


def test_task_history_filters_use_exact_wire_names() -> None:
    http = MagicMock()
    http.get.return_value = {"items": [], "next_cursor": None}
    resource = A2AResource(http)

    resource.tasks(
        "coordinator",
        direction=A2AHistoryDirection.BOTH,
        requester_handle="coordinator",
        worker_handle="researcher",
        state=A2ATaskState.WORKING,
        context_id="context-1",
        q="quarterly 2026",
        since="2026-07-01T00:00:00Z",
        cursor="opaque",
        limit=20,
    )

    http.get.assert_called_once_with(
        "/identities/coordinator/a2a/tasks",
        params={
            "direction": "both",
            "requester_handle": "coordinator",
            "worker_handle": "researcher",
            "state": "working",
            "context_id": "context-1",
            "q": "quarterly 2026",
            "since": "2026-07-01T00:00:00Z",
            "cursor": "opaque",
            "limit": 20,
        },
    )


def test_message_history_filters_parse_provenance_and_cursor() -> None:
    http = MagicMock()
    http.get.return_value = {
        "items": [
            {
                "id": "message-row-1",
                "message_id": "protocol-message-1",
                "task_id": "task-1",
                "context_id": "context-1",
                "task_state": "input_required",
                "caller": {
                    "identity_id": "caller-1",
                    "organization_id": "org-caller",
                    "handle": "coordinator",
                },
                "target": {
                    "identity_id": "worker-1",
                    "organization_id": "org-worker",
                    "handle": "researcher",
                },
                "role": "agent",
                "parts": [{"text": "Which quarter?"}],
                "metadata": None,
                "extensions": None,
                "reference_task_ids": None,
                "created_at": "2026-07-24T00:00:00Z",
            }
        ],
        "next_cursor": "next-page",
    }
    resource = A2AResource(http)

    page = resource.messages(
        "coordinator",
        direction=A2AHistoryDirection.BOTH,
        requester_handle="coordinator",
        worker_handle="researcher",
        task_id="task-1",
        context_id="context-1",
        role=A2AMessageRole.AGENT,
        q="quarter",
        since="2026-07-01T00:00:00Z",
        cursor="opaque",
        limit=10,
    )

    assert page.next_cursor == "next-page"
    assert page.items[0].task_state is A2ATaskState.INPUT_REQUIRED
    assert page.items[0].caller.handle == "coordinator"
    assert page.items[0].target is not None
    assert page.items[0].target.handle == "researcher"
    http.get.assert_called_once_with(
        "/identities/coordinator/a2a/messages",
        params={
            "direction": "both",
            "requester_handle": "coordinator",
            "worker_handle": "researcher",
            "task_id": "task-1",
            "context_id": "context-1",
            "role": "agent",
            "q": "quarter",
            "since": "2026-07-01T00:00:00Z",
            "cursor": "opaque",
            "limit": 10,
        },
    )


def test_message_iterator_preserves_filters_across_pages() -> None:
    http = MagicMock()
    http.get.side_effect = [
        {"items": [], "next_cursor": "page-2"},
        {"items": [], "next_cursor": None},
    ]
    resource = A2AResource(http)

    assert list(
        resource.iter_messages(
            "coordinator",
            direction="outbound",
            worker_handle="researcher",
            q="invoice",
            since="2026-07-01T00:00:00Z",
            limit=5,
        )
    ) == []

    common = {
        "direction": "outbound",
        "requester_handle": None,
        "worker_handle": "researcher",
        "task_id": None,
        "context_id": None,
        "role": None,
        "q": "invoice",
        "since": "2026-07-01T00:00:00Z",
        "limit": 5,
    }
    assert http.get.call_args_list == [
        call(
            "/identities/coordinator/a2a/messages",
            params={**common, "cursor": None},
        ),
        call(
            "/identities/coordinator/a2a/messages",
            params={**common, "cursor": "page-2"},
        ),
    ]


def test_sent_task_and_context_use_exact_paths() -> None:
    http = MagicMock()
    http.get.side_effect = [
        {
            "id": "task-1",
            "context_id": "context-1",
            "state": "submitted",
            "caller": {
                "identity_id": "caller-1",
                "organization_id": "org-caller",
                "handle": "caller",
            },
            "messages": [],
            "completed_at": None,
            "created_at": "2026-07-24T00:00:00Z",
            "updated_at": "2026-07-24T00:00:00Z",
        },
        {
            "id": "context-1",
            "caller": {
                "identity_id": "caller-1",
                "organization_id": "org-caller",
                "handle": "caller",
            },
            "tasks": [],
            "tasks_truncated": True,
            "created_at": "2026-07-24T00:00:00Z",
            "last_activity_at": "2026-07-24T00:00:00Z",
        },
    ]
    resource = A2AResource(http)

    assert resource.sent_task("caller", "task-1").id == "task-1"
    context = resource.sent_context("caller", "context-1")
    assert context.id == "context-1"
    assert context.tasks_truncated is True
    assert http.get.call_args_list == [
        call(
            "/identities/caller/a2a/sent/tasks/task-1"
        ),
        call(
            "/identities/caller/a2a/sent/contexts/context-1"
        ),
    ]


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
                    "task": {
                        "id": "task-1",
                        "contextId": "context-1",
                        "status": {"state": "TASK_STATE_SUBMITTED"},
                    },
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
    fetched = client.get_task(target, "task-1")
    canceled = client.cancel(target, "task-1")

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
    assert fetched.id == "task-1"
    assert canceled.id == "task-1"
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

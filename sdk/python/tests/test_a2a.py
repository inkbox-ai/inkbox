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
    A2ARuleDirection,
    A2AResolvedTarget,
    A2ATaskState,
)
from inkbox.exceptions import InkboxAPIError, InkboxError


def test_settings_parse_participant_task_counts() -> None:
    http = MagicMock()
    http.get.return_value = {
        "enabled": True,
        "publicly_discoverable": True,
        "allow_public_egress": False,
        "filter_mode": "whitelist",
        "skills": None,
        "card_url": "https://example.test/a2a/helper/card",
        "inbound_task_count": 3,
        "outbound_task_count": 5,
        "updated_at": None,
    }
    resource = A2AResource(http)

    settings = resource.settings("helper")

    assert settings.inbound_task_count == 3
    assert settings.outbound_task_count == 5
    assert settings.publicly_discoverable is True
    assert settings.allow_public_egress is False
    http.get.assert_called_once_with("/identities/helper/a2a/settings")


def test_settings_update_sends_discovery_controls() -> None:
    http = MagicMock()
    http.put.return_value = {
        "enabled": True,
        "publicly_discoverable": True,
        "allow_public_egress": False,
        "filter_mode": "whitelist",
        "skills": None,
        "card_url": "https://example.test/a2a/helper/card",
        "inbound_task_count": 0,
        "outbound_task_count": 0,
        "updated_at": None,
    }
    resource = A2AResource(http)

    settings = resource.update_settings(
        "helper",
        publicly_discoverable=True,
        allow_public_egress=False,
    )

    assert settings.publicly_discoverable is True
    assert settings.allow_public_egress is False
    http.put.assert_called_once_with(
        "/identities/helper/a2a/settings",
        json={
            "publicly_discoverable": True,
            "allow_public_egress": False,
        },
    )


def test_directory_paths_search_and_pagination() -> None:
    http = MagicMock()
    public_http = MagicMock()
    response = {
        "items": [{
            "card_url": "https://inkbox.ai/a2a/helper/card",
            "card": {"name": "@helper", "supportedInterfaces": []},
            "visibility": "public",
        }],
        "next_cursor": "next-page",
    }
    public_http.get.return_value = response
    http.get.return_value = response
    resource = A2AResource(http, public_http)

    public_page = resource.public_directory(q="research", cursor="page", limit=20)
    organization_page = resource.organization_directory(
        q="research", cursor="page", limit=20
    )

    assert public_page.items[0].card.name == "@helper"
    assert public_page.next_cursor == "next-page"
    assert organization_page.items[0].visibility.value == "public"
    public_http.get.assert_called_once_with(
        "/a2a/directory",
        params={"q": "research", "cursor": "page", "limit": 20},
    )
    http.get.assert_called_once_with(
        "/identities/a2a/directory",
        params={"q": "research", "cursor": "page", "limit": 20},
    )


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
            "name": "Quarterly Research",
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
    assert context.name == "Quarterly Research"
    assert context.tasks_truncated is True
    assert http.get.call_args_list == [
        call(
            "/identities/caller/a2a/sent/tasks/task-1"
        ),
        call(
            "/identities/caller/a2a/sent/contexts/context-1"
        ),
    ]


def test_context_history_forwards_direction() -> None:
    http = MagicMock()
    http.get.return_value = {"items": [], "next_cursor": "next-page"}
    resource = A2AResource(http)

    page = resource.contexts(
        "coordinator",
        direction=A2AHistoryDirection.BOTH,
        cursor="opaque",
        limit=20,
    )

    assert page.next_cursor == "next-page"
    http.get.assert_called_once_with(
        "/identities/coordinator/a2a/contexts",
        params={"direction": "both", "cursor": "opaque", "limit": 20},
    )


def test_context_preserves_original_pair_and_mixed_direction_tasks() -> None:
    http = MagicMock()
    http.get.return_value = {
        "id": "context-1",
        "name": "Analyse Überprüfung Ergebnis Jetzt",
        "caller": {
            "identity_id": "identity-a",
            "organization_id": "org-a",
            "handle": "coordinator",
        },
        "target": {
            "identity_id": "identity-b",
            "organization_id": "org-b",
            "handle": "researcher",
        },
        "tasks": [
            {
                "id": "task-a-b",
                "context_id": "context-1",
                "state": "working",
                "caller": {
                    "identity_id": "identity-a",
                    "organization_id": "org-a",
                    "handle": "coordinator",
                },
                "target": {
                    "identity_id": "identity-b",
                    "organization_id": "org-b",
                    "handle": "researcher",
                },
                "messages": [{
                    "id": "message-a-b",
                    "message_id": "protocol-a-b",
                    "role": "caller",
                    "parts": [{"text": "Analyse"}],
                    "metadata": None,
                    "extensions": None,
                    "reference_task_ids": None,
                    "created_at": "2026-08-01T00:00:00Z",
                }],
                "completed_at": None,
                "created_at": "2026-08-01T00:00:00Z",
                "updated_at": "2026-08-01T00:01:00Z",
            },
            {
                "id": "task-b-a",
                "context_id": "context-1",
                "state": "submitted",
                "caller": {
                    "identity_id": "identity-b",
                    "organization_id": "org-b",
                    "handle": "researcher",
                },
                "target": {
                    "identity_id": "identity-a",
                    "organization_id": "org-a",
                    "handle": "coordinator",
                },
                "messages": [{
                    "id": "message-b-a",
                    "message_id": "protocol-b-a",
                    "role": "caller",
                    "parts": [{"text": "Review"}],
                    "metadata": None,
                    "extensions": None,
                    "reference_task_ids": None,
                    "created_at": "2026-08-01T00:00:30Z",
                }],
                "completed_at": None,
                "created_at": "2026-08-01T00:00:30Z",
                "updated_at": "2026-08-01T00:00:30Z",
            },
        ],
        "created_at": "2026-08-01T00:00:00Z",
        "last_activity_at": "2026-08-01T00:01:00Z",
    }
    resource = A2AResource(http)

    context = resource.context("coordinator", "context-1")

    assert context.name == "Analyse Überprüfung Ergebnis Jetzt"
    assert context.caller.identity_id == "identity-a"
    assert context.target is not None
    assert context.target.identity_id == "identity-b"
    assert context.tasks[0].caller.identity_id == "identity-a"
    assert context.tasks[0].target is not None
    assert context.tasks[0].target.identity_id == "identity-b"
    assert context.tasks[0].state is A2ATaskState.WORKING
    assert context.tasks[0].messages[0].parts == [{"text": "Analyse"}]
    assert context.tasks[1].caller.identity_id == "identity-b"
    assert context.tasks[1].target is not None
    assert context.tasks[1].target.identity_id == "identity-a"
    assert context.tasks[1].state is A2ATaskState.SUBMITTED
    assert context.tasks[1].messages[0].parts == [{"text": "Review"}]


def test_update_context_uses_participant_path_and_exact_body() -> None:
    http = MagicMock()
    http.patch.return_value = {
        "id": "context-1",
        "name": "Analyse Überprüfung Ergebnis Jetzt",
        "caller": {
            "identity_id": "identity-a",
            "organization_id": "org-a",
            "handle": "coordinator",
        },
        "target": {
            "identity_id": "identity-b",
            "organization_id": "org-b",
            "handle": "researcher",
        },
        "tasks": [],
        "created_at": "2026-08-01T00:00:00Z",
        "last_activity_at": "2026-08-01T00:01:00Z",
    }
    resource = A2AResource(http)

    context = resource.update_context(
        "coordinator",
        "context-1",
        name="Analyse Überprüfung Ergebnis Jetzt",
    )

    assert context.name == "Analyse Überprüfung Ergebnis Jetzt"
    http.patch.assert_called_once_with(
        "/identities/coordinator/a2a/contexts/context-1",
        json={"name": "Analyse Überprüfung Ergebnis Jetzt"},
    )


def test_update_context_preserves_server_validation_detail() -> None:
    http = MagicMock()
    error = InkboxAPIError(422, "Context names contain at most five words")
    http.patch.side_effect = error
    resource = A2AResource(http)

    with pytest.raises(InkboxAPIError) as raised:
        resource.update_context("coordinator", "context-1", name="Too many words")

    assert raised.value is error
    assert raised.value.detail == "Context names contain at most five words"


def test_contact_rule_update_and_delete_use_admin_routes() -> None:
    http = MagicMock()
    http.patch.return_value = {
        "id": "rule-1",
        "action": "block",
        "match_type": "handle",
        "match_target": "peer",
        "direction": "both",
        "status": "active",
        "created_at": "2026-07-24T00:00:00Z",
        "updated_at": "2026-07-25T00:00:00Z",
    }
    resource = A2AResource(http)

    updated = resource.update_contact_rule(
        "coordinator",
        "rule-1",
        action="block",
        direction="both",
    )
    resource.delete_contact_rule("coordinator", "rule-1")

    assert updated.action.value == "block"
    assert updated.direction.value == "both"
    http.patch.assert_called_once_with(
        "/identities/coordinator/a2a/contact-rules/rule-1",
        json={"action": "block", "direction": "both"},
    )
    http.delete.assert_called_once_with(
        "/identities/coordinator/a2a/contact-rules/rule-1"
    )


def test_contact_rule_update_requires_a_change() -> None:
    resource = A2AResource(MagicMock())
    with pytest.raises(ValueError, match="at least one"):
        resource.update_contact_rule("coordinator", "rule-1")


def test_contact_rules_send_outbound_direction() -> None:
    http = MagicMock()
    http.post.return_value = {
        "id": "rule-1",
        "action": "allow",
        "match_type": "handle",
        "match_target": "peer",
        "direction": "outbound",
        "status": "active",
        "created_at": "2026-07-24T00:00:00Z",
        "updated_at": "2026-07-25T00:00:00Z",
    }
    resource = A2AResource(http)

    rule = resource.add_contact_rule(
        "coordinator",
        peer_handle="peer",
        action="allow",
        direction="outbound",
    )

    assert rule.direction is A2ARuleDirection.OUTBOUND
    http.post.assert_called_once_with(
        "/identities/coordinator/a2a/contact-rules",
        json={
            "action": "allow",
            "match_type": "handle",
            "match_target": "peer",
            "direction": "outbound",
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


def test_inbox_reply_supports_progress_updates() -> None:
    http = MagicMock()
    http.post.return_value = {
        "id": "task-1",
        "context_id": "context-1",
        "state": "working",
        "caller": {
            "identity_id": "caller-1",
            "organization_id": "org-1",
            "handle": "caller",
        },
        "messages": [],
        "completed_at": None,
        "created_at": "2026-07-23T00:00:00Z",
        "updated_at": "2026-07-23T00:00:01Z",
    }
    resource = A2AResource(http)

    task = resource.reply(
        "helper",
        "task-1",
        intent=A2AReplyIntent.PROGRESS,
        text="Still working",
    )

    assert task.state is A2ATaskState.WORKING
    http.post.assert_called_once_with(
        "/identities/helper/a2a/tasks/task-1/reply",
        json={
            "intent": "progress",
            "parts": [{"text": "Still working"}],
        },
    )


def test_a2a_client_authenticates_platform_card_and_pins_rpc_key() -> None:
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
    listed = client.list_tasks(
        target,
        status_timestamp_after="2026-07-25T12:30:00Z",
    )

    assert requests[0].headers["X-API-Key"] == "ApiKey_secret"
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
    assert listed.tasks == []
    list_body = json.loads(requests[4].content)
    assert list_body["method"] == "ListTasks"
    assert list_body["params"]["statusTimestampAfter"] == (
        "2026-07-25T12:30:00Z"
    )
    client.close()


def test_a2a_send_context_reuse_uses_exact_wire_fields() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": len(requests),
                "result": {
                    "task": {
                        "id": f"task-{len(requests)}",
                        "contextId": "context-1",
                        "status": {"state": "TASK_STATE_SUBMITTED"},
                    }
                },
            },
        )

    client = A2AClient(api_key="ApiKey_secret", platform_base_url="https://inkbox.ai")
    client._client.close()
    client._client = httpx.Client(transport=httpx.MockTransport(handler))
    target = A2AResolvedTarget(
        card_url="https://inkbox.ai/a2a/researcher/card",
        rpc_url="https://inkbox.ai/a2a/researcher",
        protocol_version="1.0",
        card=MagicMock(),
        credential="ApiKey_secret",
    )

    client.send(
        target,
        text="Start reverse review",
        message_id="message-1",
        context_id="context-1",
    )
    client.send(
        target,
        text="Continue the task",
        message_id="message-2",
        context_id="context-1",
        task_id="task-1",
    )

    first = json.loads(requests[0].content)["params"]["message"]
    assert first == {
        "messageId": "message-1",
        "role": "ROLE_USER",
        "parts": [{"text": "Start reverse review"}],
        "contextId": "context-1",
    }
    second = json.loads(requests[1].content)["params"]["message"]
    assert second == {
        "messageId": "message-2",
        "role": "ROLE_USER",
        "parts": [{"text": "Continue the task"}],
        "contextId": "context-1",
        "taskId": "task-1",
    }
    client.close()


def test_a2a_wait_caps_get_task_request_to_remaining_deadline() -> None:
    client = A2AClient(
        api_key="ApiKey_secret",
        platform_base_url="https://inkbox.ai",
        timeout=30,
    )
    target = MagicMock()
    observed_timeouts: list[float] = []

    def stalled_get_task(
        _target,
        _task_id,
        *,
        history_length,
        request_timeout,
    ):
        assert history_length is None
        observed_timeouts.append(request_timeout)
        raise httpx.ReadTimeout("stalled")

    client._get_task = stalled_get_task  # type: ignore[method-assign]

    with pytest.raises(
        TimeoutError,
        match="task-1 did not stop before timeout",
    ):
        client.wait(target, "task-1", timeout=0.05, interval=1)

    assert len(observed_timeouts) == 1
    assert 0 < observed_timeouts[0] <= 0.05
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


def test_external_credential_is_rpc_only_and_same_origin() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "GET":
            return httpx.Response(
                200,
                json={
                    "name": "external",
                    "supportedInterfaces": [{
                        "url": "https://agent.example/rpc",
                        "protocolBinding": "JSONRPC",
                        "protocolVersion": "1.0",
                    }],
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
    target = client.fetch_card(
        "https://agent.example/card",
        credential="external-secret",
    )
    client.get_task(target, "task-1")

    assert "X-API-Key" not in requests[0].headers
    assert requests[1].headers["X-API-Key"] == "external-secret"
    client.close()


def test_external_credential_rejects_cross_origin_rpc() -> None:
    client = A2AClient(api_key="ApiKey_secret", platform_base_url="https://inkbox.ai")
    client._client.close()
    client._client = httpx.Client(
        transport=httpx.MockTransport(
            lambda _request: httpx.Response(
                200,
                json={
                    "name": "external",
                    "supportedInterfaces": [{
                        "url": "https://rpc.example/rpc",
                        "protocolBinding": "JSONRPC",
                        "protocolVersion": "1.0",
                    }],
                },
            )
        )
    )

    with pytest.raises(ValueError, match="matching card and RPC origins"):
        client.fetch_card(
            "https://agent.example/card",
            credential="external-secret",
        )
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

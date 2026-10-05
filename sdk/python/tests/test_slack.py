"""Wire-level Slack contract tests with synthetic data and no live operations."""

import json
from pathlib import Path
from typing import get_args

import httpx
import pytest

from inkbox import IdempotencyKeyReusedError, Inkbox, InkboxAPIError, SlackWebhookEventType

FIXTURES = Path(__file__).parents[3] / "tests" / "fixtures"
DATA = json.loads((FIXTURES / "slack.json").read_text(encoding="utf-8"))
C = DATA["connection"]["id"]
IDENTITY_ID = DATA["connection"]["identity_id"]


@pytest.fixture
def wire():
    client = Inkbox(api_key="synthetic-test-key", base_url="https://example.com")
    requests = []
    replies = []

    def handle(request):
        requests.append(request)
        response = replies.pop(0)
        if isinstance(response, tuple):
            return httpx.Response(response[0], json=response[1])
        if isinstance(response, bytes):
            return httpx.Response(200, content=response)
        return httpx.Response(200, json=response)

    client._api_http._client.close()
    client._api_http._client = httpx.Client(
        base_url="https://example.com/api/v1", transport=httpx.MockTransport(handle),
        headers=client._api_http._client.headers,
    )
    yield client, requests, replies
    client.close()


def test_all_slack_operations_exact_wire(wire):
    c, requests, replies = wire

    def check(reply, call, method, path, body=None, query=None):
        replies.append(reply)
        result = call()
        r = requests[-1]
        assert r.method == method
        assert r.url.path == "/api/v1/slack" + path
        if body is not None:
            assert json.loads(r.content) == body
        assert dict(r.url.params) == (query or {})
        return result

    result = check(
        {"connections": [DATA["connection"]], "installation_available": False},
        lambda: c.slack.list_connections(IDENTITY_ID),
        "GET",
        "/connections",
        query={"identity_id": IDENTITY_ID},
    )
    assert not result.installation_available and str(result.connections[0].id) == C
    workspace = check(
        DATA["provisioning_workspace"],
        lambda: c.slack.save_provisioning_workspace(access_token="synthetic-access", refresh_token="synthetic-refresh"),
        "POST", "/provisioning-workspaces",
        {"access_token": "synthetic-access", "refresh_token": "synthetic-refresh"},
    )
    assert str(workspace.id) == DATA["provisioning_workspace"]["id"]
    assert workspace.token_expires_at.tzinfo is not None
    assert not hasattr(workspace, "access_token")
    saved = check(
        {"workspaces": [DATA["provisioning_workspace"]]},
        lambda: c.slack.list_provisioning_workspaces(),
        "GET", "/provisioning-workspaces",
    )
    assert saved == [workspace]
    check(
        DATA["connection"],
        lambda: c.slack.disconnect(C),
        "POST",
        f"/connections/{C}/disconnect",
    )
    page = check(
        {"conversations": [{"id": "CEXAMPLE"}], "next_cursor": "next"},
        lambda: c.slack.list_conversations(C, cursor="cur", limit=2),
        "GET",
        f"/connections/{C}/conversations",
        query={"cursor": "cur", "limit": "2"},
    )
    assert page.next_cursor == "next"
    check(
        {"id": "DEXAMPLE"},
        lambda: c.slack.open_conversation(C, ["UALICE", "UBOB"]),
        "POST",
        f"/connections/{C}/conversations",
        {"user_ids": ["UALICE", "UBOB"]},
    )
    check(
        {"id": "CEXAMPLE"},
        lambda: c.slack.get_conversation(C, "CEXAMPLE"),
        "GET",
        f"/connections/{C}/conversations/CEXAMPLE",
    )
    page = check(
        {
            "messages": [{"ts": "1780000000.000001"}],
            "next_cursor": None,
            "has_more": False,
        },
        lambda: c.slack.list_messages(C, "CEXAMPLE", thread_ts="1780000000.000001"),
        "GET",
        f"/connections/{C}/conversations/CEXAMPLE/messages",
        query={"limit": "15", "thread_ts": "1780000000.000001"},
    )
    assert page.next_cursor is None
    result = check(
        DATA["action"],
        lambda: c.slack.send_message(
            C,
            conversation_id="CEXAMPLE",
            text="Hello",
            idempotency_key="operation:1",
            thread_ts="1780000000.000001",
        ),
        "POST",
        f"/connections/{C}/messages",
        {
            "conversation_id": "CEXAMPLE",
            "text": "Hello",
            "thread_ts": "1780000000.000001",
        },
    )
    assert requests[-1].headers["Idempotency-Key"] == "operation:1"
    assert result.status == "unknown"
    check(
        DATA["action"],
        lambda: c.slack.get_action(C, DATA["action"]["id"]),
        "GET",
        f"/connections/{C}/actions/{DATA['action']['id']}",
    )
    check(
        DATA["file"],
        lambda: c.slack.get_file(C, "FEXAMPLE"),
        "GET",
        f"/connections/{C}/files/FEXAMPLE",
    )
    assert (
        check(
            b"\x00\xff\x80\x01",
            lambda: c.slack.download_file(C, "FEXAMPLE"),
            "GET",
            f"/connections/{C}/files/FEXAMPLE/content",
        )
        == b"\x00\xff\x80\x01"
    )
    assert len(requests) == 12


@pytest.mark.parametrize("retry_after", [73, 0, None])
def test_send_rate_limit_hint_and_read_only_key_recovery(wire, retry_after):
    c, requests, replies = wire
    failed = dict(DATA["action"], status="failed", error_code="rate_limited")
    replies.extend([dict(failed, retry_after=retry_after), failed, failed])
    result = c.slack.send_message(
        C, conversation_id="CEXAMPLE", text="Hello", idempotency_key="original:1"
    )
    assert result.status == "failed"
    assert result.retry_after == retry_after
    assert len(requests) == 1
    recovered = c.slack.get_action_by_key(C, "original:1")
    assert recovered.id == result.id
    assert recovered.retry_after is None
    assert requests[-1].method == "GET"
    assert requests[-1].url.path == f"/api/v1/slack/connections/{C}/actions/by-key"
    assert not requests[-1].url.query
    assert requests[-1].headers["Idempotency-Key"] == "original:1"
    assert c.slack.get_action(C, result.id).retry_after is None
    assert len(requests) == 3


def test_missing_key_lookup_does_not_send(wire):
    c, requests, replies = wire
    replies.append((404, {"detail": "Slack action not found"}))
    with pytest.raises(InkboxAPIError) as error:
        c.slack.get_action_by_key(C, "original:1")
    assert error.value.status_code == 404
    assert len(requests) == 1
    assert requests[0].method == "GET"


@pytest.mark.parametrize("status", [409, 429, 503])
def test_send_error_never_retried(wire, status):
    c, requests, replies = wire
    replies.append((status, {"detail": "Unable to send"}))
    with pytest.raises(InkboxAPIError) as error:
        c.slack.send_message(
            C,
            conversation_id="CEXAMPLE",
            text="Hello",
            idempotency_key="same-operation",
        )
    assert error.value.status_code == status
    assert len(requests) == 1


@pytest.mark.parametrize("key", ["", "has spaces", "x" * 129])
def test_invalid_keys(wire, key):
    c, requests, _ = wire
    with pytest.raises(ValueError):
        c.slack.send_message(
            C, conversation_id="CEXAMPLE", text="Hello", idempotency_key=key
        )
    assert not requests


def test_timestamps_remain_strings(wire):
    c, requests, _ = wire
    with pytest.raises(ValueError):
        c.slack.list_messages(C, "CEXAMPLE", thread_ts=1.5)
    with pytest.raises(ValueError):
        c.slack.send_message(
            C,
            conversation_id="CEXAMPLE",
            text="Hi",
            idempotency_key="key",
            thread_ts=1.5,
        )
    assert not requests


@pytest.mark.parametrize("event_type", get_args(SlackWebhookEventType)[:5])
def test_incoming_subscriptions_use_event_selection_only(wire, event_type):
    c, requests, replies = wire
    row_data = dict(DATA["subscription"], event_types=[event_type])
    replies.extend([row_data, row_data])
    row = c.webhooks.subscriptions.create(
        url="https://example.com/hook",
        agent_identity_id=IDENTITY_ID,
        event_types=[event_type],
    )
    assert not hasattr(row, "slack_filter")
    assert row.event_types == [event_type]
    assert requests[-1].method == "POST"
    assert requests[-1].url.path == "/api/v1/webhooks/subscriptions"
    assert json.loads(requests[-1].content) == {
        "url": "https://example.com/hook",
        "agent_identity_id": IDENTITY_ID,
        "event_types": [event_type],
    }
    c.webhooks.subscriptions.update(row.id, event_types=[event_type])
    assert requests[-1].method == "PATCH"
    assert json.loads(requests[-1].content) == {"event_types": [event_type]}


@pytest.mark.parametrize("value", [None, {}, {"message_kinds": ["mention"]}])
def test_removed_filter_arguments_fail_without_sending(wire, value):
    c, requests, _ = wire
    with pytest.raises(TypeError, match="slack_filter"):
        c.webhooks.subscriptions.create(
            url="https://example.com/hook",
            agent_identity_id=IDENTITY_ID,
            event_types=["slack.mention_received"],
            slack_filter=value,
        )
    with pytest.raises(TypeError, match="slack_filter"):
        c.webhooks.subscriptions.update(DATA["subscription"]["id"], slack_filter=value)
    assert not requests


def test_exact_webhook_event_vocabulary():
    payloads = json.loads(
        (FIXTURES / "slack_webhook_events.json").read_text(encoding="utf-8")
    )
    assert len(payloads) == 23
    assert {p["event_type"] for p in payloads} == set(get_args(SlackWebhookEventType))


@pytest.mark.parametrize(
    "event_types",
    [["slack.mention_received"], ["slack.mention_received", "message.received"]],
)
def test_slack_context_and_mixed_scoped_updates(wire, event_types):
    c, requests, replies = wire
    row = dict(DATA["subscription"], event_types=event_types)
    replies.extend([row] * 4)
    context = {"email": {"mode": "count", "count": 1}}
    subscription = c.webhooks.subscriptions.create(
        url="https://example.com/hook",
        agent_identity_id=IDENTITY_ID,
        event_types=event_types,
        context_config=context,
    )
    assert json.loads(requests[-1].content) == {
        "url": "https://example.com/hook",
        "agent_identity_id": IDENTITY_ID,
        "event_types": event_types,
        "context_config": context,
    }
    for kwargs in [{}, {"context_config": None}, {"auth_token": "synthetic-token"}]:
        c.webhooks.subscriptions.update(
            subscription.id, scope="identity", event_types=event_types, **kwargs
        )
        assert requests[-1].method == "PATCH"
        assert dict(requests[-1].url.params) == {"scope": "identity"}
        assert json.loads(requests[-1].content) == {
            "event_types": event_types,
            **kwargs,
        }
    assert len(requests) == 4  # Explicit mutation scope requires no catalog request.


@pytest.mark.parametrize("operation", ["send", "reaction"])
def test_slack_conflicts_preserve_typed_error_without_repeating_write(wire, operation):
    client, requests, replies = wire
    replies.append(
        (409, {"detail": {
            "error": "idempotency_key_reused",
            "message": "This key was already used for another request.",
        }})
    )
    with pytest.raises(IdempotencyKeyReusedError) as caught:
        if operation == "send":
            client.slack.send_message(
                C, conversation_id="CEXAMPLE", text="Hello", idempotency_key="used-key"
            )
        else:
            client.slack.add_reaction(
                C, "CEXAMPLE", "1780000000.000001", "eyes", idempotency_key="used-key"
            )
    assert caught.value.status_code == 409
    assert "another request" in caught.value.message
    assert len(requests) == 1


@pytest.mark.parametrize("thread_ts,window", [
    (None, "messages_at_or_before_timestamp"),
    ("1780000000.000000", "messages_at_or_after_timestamp"),
])
def test_context_preserves_direction_and_thread_selection(wire, thread_ts, window):
    client, requests, replies = wire
    replies.append({
        "messages": [{"ts": "1780000000.000001", "text": "Selected message"}],
        "next_cursor": None, "has_more": False, "window": window, "complete": False,
    })
    context = client.slack.message_context(
        C, "CEXAMPLE", "1780000000.000001", limit=5, thread_ts=thread_ts
    )
    assert context.window == window
    assert context.messages[0]["ts"] == "1780000000.000001"
    expected = {"limit": "5"}
    if thread_ts is not None:
        expected["thread_ts"] = thread_ts
    assert dict(requests[0].url.params) == expected


@pytest.mark.parametrize("status", [403, 409, 422, 429, 503])
def test_workspace_save_failures_are_not_retried(wire, status):
    client, requests, replies = wire
    replies.append((status, {"detail": "Workspace credentials could not be saved"}))
    with pytest.raises(InkboxAPIError) as error:
        client.slack.save_provisioning_workspace(access_token="synthetic-access", refresh_token="synthetic-refresh")
    assert error.value.status_code == status
    assert len(requests) == 1


def test_saved_workspace_dates_and_no_credential_echo(wire):
    client, _, replies = wire
    replies.append({"workspaces": [{**DATA["provisioning_workspace"], "token_expires_at": None,
        "status": "reauthorization_required", "access_token": "must-not-surface", "refresh_token": "must-not-surface"}]})
    workspace = client.slack.list_provisioning_workspaces()[0]
    assert workspace.token_expires_at is None
    assert workspace.updated_at.tzinfo is not None
    assert "must-not-surface" not in repr(workspace)

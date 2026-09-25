"""Wire-level Slack contract tests with synthetic data and no live operations."""

import json
from pathlib import Path
from typing import get_args
from uuid import UUID

import httpx
import pytest

from inkbox import Inkbox, InkboxAPIError, SlackWebhookEventType

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
        base_url="https://example.com/api/v1", transport=httpx.MockTransport(handle)
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
    result = check(
        DATA["invitation"],
        lambda: c.slack.create_invitation(IDENTITY_ID, expires_in_seconds=300),
        "POST",
        "/invitations",
        {"identity_id": IDENTITY_ID, "expires_in_seconds": 300},
    )
    assert "#token=" in result.invitation_url
    check(
        [dict(DATA["invitation"], invitation_url=None)],
        lambda: c.slack.list_invitations(IDENTITY_ID),
        "GET",
        "/invitations",
        query={"identity_id": IDENTITY_ID},
    )
    check(
        DATA["invitation"],
        lambda: c.slack.revoke_invitation(DATA["invitation"]["id"]),
        "POST",
        f"/invitations/{DATA['invitation']['id']}/revoke",
    )
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
    assert len(requests) == 13


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


def test_filters_preserve_clear_replace_and_channel_rules(wire):
    c, requests, replies = wire
    subs = c.webhooks.subscriptions
    replies.extend([DATA["subscription"]] * 4)
    row = subs.create(
        url="https://example.com/hooks/slack",
        event_types=["slack.message_received"],
        agent_identity_id=IDENTITY_ID,
        slack_filter={"message_kinds": ["mention", "thread"]},
    )
    assert row.slack_filter == {"message_kinds": ["mention", "thread"]}
    assert json.loads(requests[-1].content)["slack_filter"] == row.slack_filter
    subs.update(row.id, url="https://example.com/new")
    assert "slack_filter" not in json.loads(requests[-1].content)
    subs.update(row.id, slack_filter=None)
    assert json.loads(requests[-1].content) == {"slack_filter": None}
    subs.update(
        row.id, slack_filter={"connection_ids": [UUID(C)], "conversation_ids": None}
    )
    assert json.loads(requests[-1].content) == {
        "slack_filter": {"connection_ids": [C], "conversation_ids": None}
    }
    for filt in [
        {"message_kinds": []},
        {"message_kinds": ["dm", "dm"]},
        {"message_kinds": ["invalid"]},
    ]:
        with pytest.raises(ValueError):
            subs.update(row.id, slack_filter=filt)
    with pytest.raises(ValueError):
        subs.create(
            url="https://example.com/hook",
            event_types=["text.received"],
            phone_number_id=IDENTITY_ID,
            slack_filter={},
        )
    assert len(requests) == 4


def test_exact_webhook_event_vocabulary():
    payloads = json.loads(
        (FIXTURES / "slack_webhook_events.json").read_text(encoding="utf-8")
    )
    assert len(payloads) == 19
    assert {p["event_type"] for p in payloads} == set(get_args(SlackWebhookEventType))


@pytest.mark.parametrize(
    "event_types",
    [["slack.message_received"], ["slack.message_received", "message.received"]],
)
def test_slack_context_and_mixed_filter_scoped_updates(wire, event_types):
    c, requests, replies = wire
    row = dict(DATA["subscription"], event_types=event_types)
    replies.extend([row] * 4)
    context = {"email": {"mode": "count", "count": 1}}
    filter_value = {"message_kinds": ["mention"]}
    subscription = c.webhooks.subscriptions.create(
        url="https://example.com/hook",
        agent_identity_id=IDENTITY_ID,
        event_types=event_types,
        context_config=context,
        slack_filter=filter_value,
    )
    assert json.loads(requests[-1].content) == {
        "url": "https://example.com/hook",
        "agent_identity_id": IDENTITY_ID,
        "event_types": event_types,
        "context_config": context,
        "slack_filter": filter_value,
    }
    for kwargs in [{}, {"slack_filter": None}, {"slack_filter": filter_value}]:
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

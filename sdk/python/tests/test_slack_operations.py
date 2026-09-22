"""Public utility/archive surface exact-wire parity, with no live service calls."""

import json
from pathlib import Path
from uuid import UUID

import pytest
import test_slack as fixtures

from inkbox import InkboxAPIError, SlackArchivePurgeResponse, SlackOperation

wire = fixtures.wire

DATA = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/slack_operations.json").read_text(
        encoding="utf-8"
    )
)
C, OP_ID, TS = DATA["connection_id"], DATA["operation_id"], DATA["message_ts"]


def calls(s):
    return {
        "start_installation": lambda: s.start_installation(C, workspace_id="T123"),
        "start_installation_defaults": lambda: s.start_installation(C, return_url=None),
        "start_installation_return_url": lambda: s.start_installation(
            C,
            workspace_id="T123",
            return_url="https://example.com/console/slack/complete",
        ),
        "capabilities": lambda: s.capabilities(C),
        "list_users": lambda: s.list_users(C, limit=2, cursor="opaque"),
        "get_user": lambda: s.get_user(C, "U123"),
        "list_members": lambda: s.list_members(C, "C123", limit=2, cursor="opaque"),
        "get_message": lambda: s.get_message(
            C, "C123", TS, thread_ts="1234567890.000000"
        ),
        "message_context": lambda: s.message_context(C, "C123", TS),
        "get_permalink": lambda: s.get_permalink(C, "C123", TS),
        "get_reactions": lambda: s.get_reactions(C, "C123", TS),
        "list_pins": lambda: s.list_pins(C, "C123"),
        "get_operation": lambda: s.get_operation(C, OP_ID),
        "add_reaction": lambda: s.add_reaction(
            C, "C123", TS, "eyes", idempotency_key="stable-key"
        ),
        "remove_reaction": lambda: s.remove_reaction(
            C, "C123", TS, "eyes", idempotency_key="stable-key"
        ),
        "add_pin": lambda: s.add_pin(C, "C123", TS, idempotency_key="stable-key"),
        "remove_pin": lambda: s.remove_pin(C, "C123", TS, idempotency_key="stable-key"),
        "update_message": lambda: s.update_message(
            C, "C123", TS, "edited", idempotency_key="stable-key"
        ),
        "delete_message": lambda: s.delete_message(
            C, "C123", TS, idempotency_key="stable-key"
        ),
        "join_conversation": lambda: s.join_conversation(
            C, "C123", idempotency_key="stable-key"
        ),
        "leave_conversation": lambda: s.leave_conversation(
            C, "C123", idempotency_key="stable-key"
        ),
        "set_processing_status": lambda: s.set_processing_status(
            C, "C123", TS, "processing", idempotency_key="stable-key"
        ),
        "upload_file": lambda: s.upload_file(
            C,
            conversation_id="C123",
            filename="binary.dat",
            content_base64="AP8B",
            thread_ts=TS,
            idempotency_key="stable-key",
        ),
        "get_archive_settings": lambda: s.get_archive_settings(C),
        "update_archive_settings": lambda: s.update_archive_settings(
            C, capture_enabled=True, retention_days=None, conversation_ids=["C123"]
        ),
        "list_archived_messages": lambda: s.list_archived_messages(
            C,
            conversation_id="C123",
            thread_ts=TS,
            before_ts="1234567891.000000",
            after_ts="1234567889.000000",
            limit=2,
            cursor="opaque",
        ),
        "search_archived_messages": lambda: s.search_archived_messages(
            C,
            "retained message",
            conversation_id="C123",
            user_id="U123",
            before_ts="1234567891.000000",
            after_ts="1234567889.000000",
            limit=2,
            cursor="opaque",
        ),
        "search_messages": lambda: s.search_messages(
            "retained message",
            identity_id=UUID("33333333-3333-4333-8333-333333333333"),
            connection_id=UUID(C),
            conversation_id="C123",
            user_id="U123",
            before_ts="1234567891.000000",
            after_ts="1234567889.000000",
            limit=2,
            cursor="opaque",
        ),
        "search_messages_defaults": lambda: s.search_messages(
            "release + café & notes?",
            identity_id=None,
            connection_id=None,
            before_ts=None,
            after_ts=None,
        ),
        "search_messages_continuation": lambda: s.search_messages(
            "retained message", cursor="opaque+/="
        ),
        "archive_backfill": lambda: s.archive_backfill(
            C, "C123", thread_ts=TS, restart=True
        ),
        "list_archive_coverage": lambda: s.list_archive_coverage(
            C, limit=2, cursor=OP_ID
        ),
        "purge_archive": lambda: s.purge_archive(C),
    }


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["name"])
def test_all_operations_exact_wire_and_typed_results(wire, case):
    client, requests, replies = wire
    replies.append(case["response"])
    result = calls(client.slack)[case["name"]]()
    assert len(requests) == 1
    request = requests[0]
    assert request.method == case["method"]
    assert request.url.path == "/api/v1" + case["path"]
    assert dict(request.url.params) == case["query"]
    assert (json.loads(request.content) if request.content else None) == case["body"]
    assert request.headers.get("Idempotency-Key") == case["idempotency_key"]
    if case["idempotency_key"]:
        assert isinstance(result, SlackOperation)
        assert (
            result.id == UUID(OP_ID)
            and result.status == "unknown"
            and result.message_ts == TS
        )
    if case["name"] in {"list_archived_messages", "search_archived_messages"}:
        assert result.messages[0].captured_at.tzinfo is not None
        assert result.messages[0].message_ts == TS
    if case["name"].startswith("search_messages"):
        assert result.source == "archive"
        assert result.next_cursor == case["response"]["next_cursor"]
        assert [str(m.connection_id) for m in result.messages] == [
            m["connection_id"] for m in case["response"]["messages"]
        ]
        assert [m.message_ts for m in result.messages] == [
            m["message_ts"] for m in case["response"]["messages"]
        ]
        assert all(m.captured_at.tzinfo is not None for m in result.messages)
    if case["name"] == "purge_archive":
        assert isinstance(result, SlackArchivePurgeResponse)
        assert result.status == "pending" and result.capture_enabled is False
    if case["name"] == "capabilities":
        assert not result.capabilities["files_upload"].scopes_satisfied


@pytest.mark.parametrize(
    "name", [case["name"] for case in DATA["cases"] if case["idempotency_key"]]
)
def test_every_mutation_preserves_errors_without_retry(wire, name):
    client, requests, replies = wire
    replies.append((503, {"detail": {"code": "unavailable", "message": "Unavailable"}}))
    with pytest.raises(InkboxAPIError):
        calls(client.slack)[name]()
    assert len(requests) == 1


@pytest.mark.parametrize(
    "call",
    [
        lambda s: s.get_message(C, "C123", 1234567890.1),
        lambda s: s.add_pin(C, "C123", 1234567890.1, idempotency_key="stable-key"),
        lambda s: s.list_archived_messages(C, before_ts=1234567890.1),
        lambda s: s.search_messages("message", before_ts=1234567890.1),
        lambda s: s.search_messages("message", after_ts=1234567890.1),
        lambda s: s.archive_backfill(C, "C123", thread_ts=1234567890.1),
        lambda s: s.set_processing_status(
            C, "C123", 1234567890.1, "processing", idempotency_key="stable-key"
        ),
        lambda s: s.delete_message(C, "C123", TS, idempotency_key=""),
    ],
)
def test_invalid_timestamp_types_and_keys_fail_without_dispatch(wire, call):
    client, requests, _ = wire
    with pytest.raises(ValueError):
        call(client.slack)
    assert requests == []


@pytest.mark.parametrize("status", [403, 422, 429, 503])
def test_identity_search_preserves_errors(wire, status):
    client, requests, replies = wire
    replies.append(
        (status, {"detail": {"code": "search_failed", "message": "Search failed"}})
    )
    with pytest.raises(InkboxAPIError) as exc:
        client.slack.search_messages("message")
    assert exc.value.status_code == status
    assert len(requests) == 1

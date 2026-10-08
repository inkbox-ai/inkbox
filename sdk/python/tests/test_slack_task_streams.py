"""Public task-stream requests match shared wire fixtures without replay."""

import json
from pathlib import Path
from uuid import UUID

import pytest
import test_slack as fixtures

from inkbox import InkboxAPIError, SlackOperation, SlackPlanUpdate, SlackTaskChunk, SlackTaskUpdate

wire = fixtures.wire
DATA = json.loads((Path(__file__).parents[3] / "tests/fixtures/slack_task_streams.json").read_text())


@pytest.mark.parametrize("case", DATA["cases"], ids=lambda case: case["name"])
def test_exact_task_stream_wire(wire, case):
    client, requests, replies = wire
    replies.append(case["response"])
    connection, conversation, stream = DATA["connection_id"], DATA["conversation_id"], DATA["stream_id"]
    opts = {"idempotency_key": case["idempotency_key"]}
    body = case["body"]
    if case["name"].startswith("start"):
        args = dict(body)
        if case["name"] == "start_default":
            del args["task_display_mode"]
        result = client.slack.start_stream(connection, conversation, **args, **opts)
    elif case["name"] == "append":
        result = client.slack.append_stream(connection, conversation, UUID(stream), **body, **opts)
    elif case["name"].startswith("stop"):
        result = client.slack.stop_stream(connection, conversation, stream,
            **({} if case["name"] == "stop_empty" else body), **opts)
    else:
        result = client.slack.get_operation_by_key(connection, **opts)
    assert len(requests) == 1
    request = requests[0]
    assert request.method == case["method"]
    assert request.url.path == "/api/v1" + case["path"]
    assert not request.url.query
    assert request.headers["Idempotency-Key"] == case["idempotency_key"]
    assert (json.loads(request.content) if request.content else None) == body
    assert isinstance(result, SlackOperation)
    assert result.id == UUID(stream) and result.operation == case["response"]["operation"]
    assert result.status == case["response"]["status"]
    assert result.thread_ts == DATA["thread_ts"]
    assert result.retry_after == case["response"]["retry_after"]


def test_public_chunks_and_older_responses(wire):
    client, _, replies = wire
    task: SlackTaskUpdate = {"type": "task_update", "id": "check", "title": "Check", "status": "in_progress"}
    plan: SlackPlanUpdate = {"type": "plan_update", "title": "Review"}
    chunks: list[SlackTaskChunk] = [plan, task]
    assert len(chunks) == 2
    old = {k: v for k, v in DATA["cases"][0]["response"].items() if k != "thread_ts"}
    old["operation"] = "message_update"
    replies.append(old)
    assert client.slack.get_operation(DATA["connection_id"], DATA["stream_id"]).thread_ts is None
    for field in ({}, {"native_task_streaming": "missing_scope"}):
        replies.append({"connection_id": DATA["connection_id"], "scopes": [], "missing_scopes": [],
            "capabilities": {}, "native_processing_status": "unknown", "max_upload_bytes": 100, **field})
        assert client.slack.capabilities(DATA["connection_id"]).native_task_streaming == field.get("native_task_streaming", "unknown")


def test_key_lookup_rejects_invalid_keys_without_http(wire):
    client, requests, _ = wire
    with pytest.raises(ValueError, match="idempotency_key"):
        client.slack.get_operation_by_key(DATA["connection_id"], idempotency_key="bad key")
    assert not requests


def test_failed_stream_mutation_is_not_retried(wire):
    client, requests, replies = wire
    replies.append((503, {"detail": "Busy"}))
    with pytest.raises(InkboxAPIError):
        client.slack.stop_stream(DATA["connection_id"], DATA["conversation_id"], DATA["stream_id"],
            idempotency_key="stable-key")
    assert len(requests) == 1

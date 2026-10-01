"""Lifecycle acceptance is not completion; retained history keeps exact scope."""

import json
from datetime import datetime
from pathlib import Path
from uuid import UUID

from test_slack import wire  # noqa: F401

FIXTURE = json.loads((Path(__file__).parents[3] / "tests/fixtures/slack_lifecycle.json").read_text())
IDENTITY = FIXTURE["deletion"]["identity_id"]
APP = FIXTURE["deletion"]["application_id"]
JOB = FIXTURE["deletion"]["id"]


def test_app_and_cleanup_contracts_keep_pending_honest(wire):  # noqa: F811
    client, requests, replies = wire
    replies.extend([FIXTURE["application_state"], FIXTURE["deletion"], FIXTURE["deletions"], FIXTURE["deletion"]])
    state = client.slack.get_application(IDENTITY)
    assert state.application.id == UUID(APP)
    assert state.application.status == "deleting"
    assert state.deletion.status == "pending"
    assert isinstance(state.deletion.retry_at, datetime)
    assert requests[-1].url.params["identity_id"] == IDENTITY
    accepted = client.slack.delete_application(APP)
    assert accepted.status == "pending"
    assert requests[-1].method == "DELETE"
    assert requests[-1].url.path.endswith(f"/applications/{APP}")
    page = client.slack.list_application_deletions(cursor=JOB, limit=2, unresolved_only=True)
    assert page.next_cursor == UUID(JOB)
    assert dict(requests[-1].url.params) == {"cursor": JOB, "limit": "2", "unresolved_only": "true"}
    assert client.slack.retry_application_deletion(JOB).status == "pending"
    assert requests[-1].method == "POST"
    assert requests[-1].url.path.endswith(f"/application-deletions/{JOB}/retry")


def test_history_filters_empty_cursor_and_provenance_are_preserved(wire):  # noqa: F811
    client, requests, replies = wire
    replies.extend([FIXTURE["workspaces"], FIXTURE["history"], FIXTURE["sources"]])
    workspace = client.slack.list_history_workspaces(IDENTITY)[0]
    assert workspace.live_connection_id is None
    assert isinstance(workspace.reconnect_connection_id, UUID)
    result = client.slack.list_history_messages(IDENTITY, workspace_id="TEXAMPLE", conversation_id="CEXAMPLE",
        thread_ts="1700000000.000001", q="tea", user_id="UEXAMPLE", cursor="previous", limit=2,
        latest_per_conversation=True)
    assert result.messages == [] and result.next_cursor == "next-page"
    assert dict(requests[-1].url.params) == {"identity_id": IDENTITY, "workspace_id": "TEXAMPLE", "q": "tea",
        "conversation_id": "CEXAMPLE", "thread_ts": "1700000000.000001", "user_id": "UEXAMPLE",
        "cursor": "previous", "limit": "2", "latest_per_conversation": "true"}
    sources = client.slack.list_message_sources(IDENTITY, JOB)
    assert sources[0].application_id == UUID(APP)
    assert isinstance(sources[0].observed_at, datetime)
    assert requests[-1].url.path.endswith(f"/history/messages/{JOB}/sources")


def test_absent_current_app_is_a_valid_state(wire):  # noqa: F811
    client, _, replies = wire
    replies.append({"application": None, "deletion": None})
    state = client.slack.get_application(IDENTITY)
    assert state.application is None and state.deletion is None


def test_unknown_creation_manual_attestation_is_not_provider_deletion(wire):  # noqa: F811
    client, requests, replies = wire
    replies.append({**FIXTURE["deletion"], "app_id": None, "status": "manually_confirmed"})
    result = client.slack.confirm_manual_app_removal(
        JOB, confirmation="I removed the unknown Slack app",
    )
    assert result.status == "manually_confirmed"
    assert result.app_id is None
    assert requests[-1].url.path.endswith(f"/application-deletions/{JOB}/confirm-manual-removal")
    assert json.loads(requests[-1].content) == {"confirmation": "I removed the unknown Slack app"}

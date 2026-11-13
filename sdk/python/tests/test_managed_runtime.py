import asyncio
import json
import os
import subprocess
import sys
import time
from uuid import uuid4

import pytest

from inkbox.managed_chat import ChatRuntime, Journal
from inkbox.managed_inbox import InboxError, ManagedInbox


def event(activation, number=1):
    identifier = "evt_" + f"{number:064x}"
    return {"id": identifier, "event_type": "message.received", "data": {"body": "Example"},
            "hosted_delivery": {"version": 1, "activation_id": activation,
                                "event_id": identifier, "starts_agent": True}}


def spec(identifier="turn"):
    return {"run_id": identifier, "session_id": "conversation", "harness": "claude_code",
            "prompt": "Example", "deadline_unix_ms": int(time.time() * 1000) + 60000}


def test_inbox_acceptance_survives_process_exit_and_duplicate_projection_refresh(tmp_path):
    activation, path = str(uuid4()), tmp_path / "events" / "inbox.sqlite"
    code = """import json, os, sys
from pathlib import Path
from inkbox.managed_inbox import ManagedInbox
inbox = ManagedInbox(Path(sys.argv[1]), sys.argv[2])
inbox.accept(json.loads(sys.argv[3]))
os._exit(0)
"""
    subprocess.run([sys.executable, "-c", code, str(path), activation, json.dumps(event(activation))], check=True)
    inbox = ManagedInbox(path, activation)
    try:
        receipt = inbox.accept(event(activation))
        refreshed = event(activation) | {"data": {"body": "Refreshed"}}
        assert inbox.accept(refreshed) == receipt
        assert inbox.claim() == (refreshed["id"], refreshed)
        assert inbox.finish(refreshed["id"], completed=True)
        assert inbox.accept(refreshed) == receipt | {"state": "completed"}
        assert inbox.claim() is None
        with pytest.raises(InboxError):
            inbox.accept(event(str(uuid4())))
        assert os.stat(path).st_mode & 0o077 == 0
    finally:
        inbox.close()


def test_inbox_uncertain_execution_requires_owner_replacement_before_quarantine(tmp_path, monkeypatch):
    activation, path = str(uuid4()), tmp_path / "events" / "inbox.sqlite"
    monkeypatch.setenv("INKBOX_MANAGED_OWNER_ID", "owner-one")
    inbox = ManagedInbox(path, activation)
    receipt = inbox.accept(event(activation))
    inbox.claim()
    inbox.close()
    inbox = ManagedInbox(path, activation)
    try:
        assert inbox.accept(event(activation)) == receipt | {"state": "unknown"}
        assert inbox.claim() is None
        with pytest.raises(InboxError):
            inbox.quarantine(event(activation)["id"])
        monkeypatch.setenv("INKBOX_MANAGED_OWNER_ID", "owner-two")
        assert inbox.quarantine(event(activation)["id"])["quarantined"]
    finally:
        inbox.close()


def test_chat_journal_does_not_replay_after_restart(tmp_path):
    path = tmp_path / "chat.sqlite"
    original = spec()
    journal = Journal(path, "owner-one")
    assert journal.accept(original)
    journal.close()
    journal = Journal(path, "owner-one")
    try:
        assert journal.get("turn")["state"] == "outcome_unknown"
        assert not journal.get("turn")["children_complete"]
        assert not journal.accept(original)
        with pytest.raises(ValueError):
            journal.accept(spec("next-turn"))
    finally:
        journal.close()
    journal = Journal(path, "owner-two")
    try:
        assert journal.get("turn")["children_complete"]
        assert journal.accept(spec("next-turn"))
    finally:
        journal.close()


def test_chat_retries_execute_once_and_status_does_not_extend_activity(tmp_path):
    async def scenario():
        calls = []
        async def run(value, emit, ask):
            calls.append(value)
            emit("message.delta", {"text": "Example response"})
            return {"text": "Example response", "session_id": "native-one"}
        async def cancel(_):
            pass
        runtime = ChatRuntime(tmp_path / "chat.sqlite", "owner", run, cancel)
        command = {"action": "chat_start", "spec": spec()}
        try:
            await runtime.control(command)
            await runtime.control(command)
            await asyncio.gather(*list(runtime.tasks.values()))
            await runtime.control(command)
            result = await runtime.control({"action": "chat_events", "run_id": "turn", "after": 0})
            assert len(calls) == 1
            assert result["receipt"]["state"] == "succeeded"
            assert result["receipt"]["native_session_id"] == "native-one"
            completed = runtime.journal.last_completed_unix_ms()
            runtime.journal.activity()
            assert runtime.journal.last_completed_unix_ms() == completed > 0
            assert [e["sequence"] for e in result["events"]] == list(range(1, len(result["events"]) + 1))
        finally:
            await runtime.close()
    asyncio.run(scenario())


def test_late_approval_cannot_revive_uncertain_execution(tmp_path):
    async def scenario():
        callbacks = []
        async def run(value, emit, ask):
            callbacks.append(ask)
            raise RuntimeError("synthetic transport failure")
        async def cancel(_):
            pass
        runtime = ChatRuntime(tmp_path / "chat.sqlite", "owner", run, cancel)
        try:
            await runtime.control({"action": "chat_start", "spec": spec()})
            await asyncio.gather(*list(runtime.tasks.values()))
            before = runtime.journal.get("turn")
            assert before["state"] == "outcome_unknown"
            assert await callbacks[0]({"kind": "approval", "title": "Late request", "decisions": ["approve_once", "deny"]}) == {"cancelled": True}
            assert runtime.journal.get("turn") == before
        finally:
            await runtime.close()
    asyncio.run(scenario())

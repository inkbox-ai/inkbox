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
        if os.name == "posix":
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


@pytest.mark.parametrize('kind', ['chat', 'inbox'])
def test_journal_ownership_is_exclusive_and_released_on_close(tmp_path, kind):
    path = tmp_path / 'receipts' / 'journal.sqlite'
    owner = str(uuid4())
    factory = Journal if kind == 'chat' else ManagedInbox
    journal = factory(path, owner)
    code = '''import sys
from pathlib import Path
from inkbox.managed_chat import Journal
from inkbox.managed_inbox import ManagedInbox
factory = Journal if sys.argv[1] == "chat" else ManagedInbox
try:
    journal = factory(Path(sys.argv[2]), sys.argv[3])
except OSError:
    sys.exit(23)
journal.close()
'''
    try:
        assert subprocess.run([sys.executable, '-c', code, kind, str(path), owner]).returncode == 23
    finally:
        journal.close()
    subprocess.run([sys.executable, '-c', code, kind, str(path), owner], check=True)


def test_windows_lock_uses_nonblocking_byte_lock_and_closes_on_failure(monkeypatch):
    from types import SimpleNamespace
    from unittest.mock import Mock

    from inkbox import _file_lock

    platform = SimpleNamespace(name='nt', O_CREAT=1, O_RDWR=2,
                               open=Mock(return_value=42), close=Mock())
    native = SimpleNamespace(LK_NBLCK=2, locking=Mock())
    monkeypatch.setattr(_file_lock, 'os', platform)
    monkeypatch.setitem(sys.modules, 'msvcrt', native)
    path = Mock(is_symlink=Mock(return_value=False))
    assert _file_lock.lock_file(path) == 42
    native.locking.assert_called_once_with(42, 2, 1)
    platform.close.assert_not_called()
    native.locking.side_effect = OSError('busy')
    with pytest.raises(OSError, match='busy'):
        _file_lock.lock_file(path)
    platform.close.assert_called_once_with(42)

"""Durable, bounded control receipts for interactive agent turns."""

from __future__ import annotations

import ast
import asyncio
import fcntl
import hashlib
import json
import mimetypes
import os
import re
import sqlite3
import stat
import time
import uuid
from pathlib import Path

TERMINAL = {"succeeded", "failed", "cancelled", "interrupted", "outcome_unknown"}


def failure_code(value):
    allowed = {
        "model_key_invalid",
        "model_key_missing",
        "model_rate_limited",
        "model_upstream_failed",
        "included_credits_exhausted",
        "included_credits_unavailable",
        "model_capacity_reserved",
    }
    if isinstance(value, dict):
        for key in ("error_code", "code", "error", "message"):
            item = value.get(key)
            if isinstance(item, str) and item in allowed:
                return item
            if isinstance(item, dict) and (code := failure_code(item)):
                return code
            if isinstance(item, str) and len(item) <= 8192:
                match = re.fullmatch(
                    r"unexpected status [0-9]+ [^:]+: ([a-z_]+)(?:, url:.*)?", item
                )
                if match and match[1] in allowed:
                    return match[1]
                body = re.sub(r"^Error code: [0-9]+ - ", "", item)
                try:
                    parsed = json.loads(body)
                except ValueError:
                    try:
                        parsed = (
                            ast.literal_eval(body) if body.startswith("{") else None
                        )
                    except (ValueError, SyntaxError, RecursionError):
                        parsed = None
                if isinstance(parsed, dict) and (code := failure_code(parsed)):
                    return code
        info = value.get("codexErrorInfo")
        if isinstance(info, dict) and isinstance(
            info.get("httpConnectionFailed"), dict
        ):
            return {401: "model_key_invalid", 429: "model_rate_limited"}.get(
                info["httpConnectionFailed"].get("httpStatusCode")
            )
    return None


def milliseconds():
    return int(time.time() * 1000)


def encode(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def validate_answer(request, response):
    if not isinstance(response, dict) or response.get("kind") != request["kind"]:
        raise ValueError("Invalid response kind")
    if request["kind"] == "approval":
        if (
            set(response) != {"kind", "decision"}
            or response["decision"] not in request["decisions"]
        ):
            raise ValueError("Invalid approval decision")
        return
    if set(response) != {"kind", "answers"} or not isinstance(
        response["answers"], dict
    ):
        raise ValueError("Invalid answers")
    answers = response["answers"]
    fields = {field["id"]: field for field in request["fields"]}
    if answers.keys() - fields.keys():
        raise ValueError("Unknown field")
    for key, field in fields.items():
        answer = answers.get(key)
        if answer is None:
            if field["required"]:
                raise ValueError("Required answer missing")
            continue
        choices = {choice["id"] for choice in field.get("choices", [])}
        if field["type"] == "text":
            valid = isinstance(answer, str) and len(answer.encode()) <= 4096
        elif field["type"] == "single_select":
            valid = isinstance(answer, str) and (
                answer in choices
                or (
                    field.get("allow_free_text", False) and len(answer.encode()) <= 4096
                )
            )
        else:
            valid = (
                isinstance(answer, list)
                and len(answer) <= 32
                and all(isinstance(item, str) and item in choices for item in answer)
                and len(set(answer)) == len(answer)
            )
        if not valid:
            raise ValueError("Invalid answer")


class Journal:
    def __init__(self, path: Path, owner_id: str):
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if path.is_symlink():
            raise ValueError("Private chat storage required")
        self.lock = os.open(
            str(path) + ".lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600
        )
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BaseException:
            os.close(self.lock)
            raise
        self.db = sqlite3.connect(path)
        os.chmod(path, 0o600)
        self.db.row_factory = sqlite3.Row
        self.db.executescript("""
            PRAGMA journal_mode=WAL;
            PRAGMA synchronous=FULL;
            CREATE TABLE IF NOT EXISTS chat_turns (
                id TEXT PRIMARY KEY, spec TEXT NOT NULL, receipt TEXT NOT NULL,
                owner_id TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS chat_events (
                run_id TEXT NOT NULL, sequence INTEGER NOT NULL, event TEXT NOT NULL,
                PRIMARY KEY(run_id, sequence));
        """)
        self.owner_id = owner_id
        for row in self.db.execute(
            "SELECT id,receipt,owner_id FROM chat_turns"
        ).fetchall():
            receipt = json.loads(row["receipt"])
            if receipt["state"] not in TERMINAL:
                receipt.update(
                    state="outcome_unknown",
                    error_code="execution_interrupted",
                    finished_unix_ms=milliseconds(),
                    children_complete=row["owner_id"] != owner_id,
                )
                for request in receipt["requests"]:
                    request["payload"]["status"] = "cancelled"
                    self.save(
                        receipt,
                        {"type": "interaction.updated", "data": request["payload"]},
                    )
                self.save(
                    receipt,
                    {
                        "type": "turn.updated",
                        "data": {
                            "id": receipt["run_id"],
                            "status": "outcome_unknown",
                            "terminal": True,
                        },
                    },
                )
            elif receipt["state"] == "outcome_unknown" and row["owner_id"] != owner_id:
                receipt["children_complete"] = True
                self.save(receipt)

    def close(self):
        self.db.close()
        os.close(self.lock)

    def get(self, identifier):
        row = self.db.execute(
            "SELECT receipt FROM chat_turns WHERE id=?", (identifier,)
        ).fetchone()
        if row is None:
            raise ValueError("Unknown turn")
        return json.loads(row[0])

    def accept(self, spec):
        identifier = spec["run_id"]
        row = self.db.execute(
            "SELECT spec FROM chat_turns WHERE id=?", (identifier,)
        ).fetchone()
        if row:
            if row[0] != encode(spec):
                raise ValueError("Conflicting turn")
            return False
        if spec["deadline_unix_ms"] <= milliseconds():
            raise ValueError("Turn deadline expired")
        if any(
            json.loads(row[0])["state"] not in TERMINAL
            or (
                json.loads(row[0])["state"] == "outcome_unknown"
                and not json.loads(row[0])["children_complete"]
            )
            for row in self.db.execute(
                "SELECT receipt FROM chat_turns WHERE json_extract(spec,'$.session_id')=?",
                (spec["session_id"],),
            )
        ):
            raise ValueError("Conversation busy")
        active = self.db.execute(
            "SELECT count(*) FROM chat_turns WHERE json_extract(receipt,'$.state') NOT IN ('succeeded','failed','cancelled','interrupted','outcome_unknown')"
        ).fetchone()[0]
        if active >= 32:
            raise ValueError("Chat capacity reached")
        if len(spec["prompt"].encode()) > 32768:
            raise ValueError("Message too large")
        now = milliseconds()
        receipt = {
            "schema": 1,
            "run_id": identifier,
            "session_id": spec["session_id"],
            "harness": spec["harness"],
            "state": "accepted",
            "native_session_id": None,
            "native_turn_id": None,
            "created_unix_ms": now,
            "started_unix_ms": None,
            "finished_unix_ms": None,
            "last_sequence": 0,
            "acknowledged_sequence": 0,
            "requests": [],
            "usage": None,
            "error_code": None,
            "children_complete": False,
        }
        with self.db:
            self.db.execute(
                "INSERT INTO chat_turns VALUES (?,?,?,?)",
                (identifier, encode(spec), encode(receipt), self.owner_id),
            )
        return True

    def save(self, receipt, event=None):
        with self.db:
            if event is not None:
                receipt["last_sequence"] += 1
                sequence = receipt["last_sequence"]
                value = {
                    "sequence": sequence,
                    "timestamp_unix_ms": milliseconds(),
                    "kind": event["type"],
                    "payload": event["data"],
                }
                self.db.execute(
                    "INSERT INTO chat_events VALUES (?,?,?)",
                    (receipt["run_id"], sequence, encode(value)),
                )
            self.db.execute(
                "UPDATE chat_turns SET receipt=? WHERE id=?",
                (encode(receipt), receipt["run_id"]),
            )

    def events(self, identifier, after, limit=32):
        values, size = [], 0
        for row in self.db.execute(
            "SELECT event FROM chat_events WHERE run_id=? AND sequence>? ORDER BY sequence LIMIT ?",
            (identifier, after, min(64, max(1, limit))),
        ):
            size += len(row[0].encode())
            if size > 20000 and values:
                break
            values.append(json.loads(row[0]))
        return values

    def last_completed_unix_ms(self):
        return self.db.execute(
            "SELECT COALESCE(MAX(json_extract(receipt,'$.finished_unix_ms')),0) FROM chat_turns"
        ).fetchone()[0]

    def activity(self):
        receipts = [
            json.loads(row[0])
            for row in self.db.execute("SELECT receipt FROM chat_turns")
        ]
        return {
            "active": sum(row["state"] not in TERMINAL for row in receipts),
            "unknown": any(
                row["state"] == "outcome_unknown" and not row["children_complete"]
                for row in receipts
            ),
        }


class ChatRuntime:
    def __init__(self, path, owner_id, run, cancel, settled=None):
        self.journal = Journal(path, owner_id)
        self.run = run
        self.cancel = cancel
        self.settled = settled
        self.tasks = {}
        self.answers = {}
        self.draining = False

    async def control(self, data):
        action = data["action"]
        if action == "chat_start":
            spec = data["spec"]
            identifier = spec["run_id"]
            existing = self.journal.db.execute(
                "SELECT id FROM chat_turns WHERE id=?", (identifier,)
            ).fetchone()
            if not existing and self.draining:
                raise RuntimeError("Agent is draining")
            if self.journal.accept(spec):
                task = asyncio.create_task(self.execute(spec))
                self.tasks[identifier] = task
                task.add_done_callback(lambda done: self.tasks.pop(identifier, None))
            return {"type": "receipt", "receipt": self.journal.get(identifier)}
        identifier = data["run_id"]
        receipt = self.journal.get(identifier)
        if (
            receipt["state"] == "outcome_unknown"
            and not receipt["children_complete"]
            and self.settled
            and await self.settled(receipt["session_id"])
        ):
            receipt["children_complete"] = True
            self.journal.save(receipt)
        if action == "chat_events":
            result = {
                "type": "events", "receipt": receipt,
                "next_sequence": data["after"],
                "events": self.journal.events(identifier, data["after"], data.get("limit", 32)),
            }
            # Budget the whole UTF-8 response, including repeated request metadata.
            while result["events"] and len(encode(result).encode()) > 64000:
                result["events"].pop()
            if result["events"]:
                result["next_sequence"] = result["events"][-1]["sequence"]
            if len(encode(result).encode()) > 64000:
                raise RuntimeError("Chat receipt exceeds response capacity")
            return result
        if action == "chat_acknowledge":
            through = data["through"]
            if type(through) is not int or not 0 <= through <= receipt["last_sequence"]:
                raise ValueError("Invalid acknowledgement")
            receipt["acknowledged_sequence"] = max(
                through, receipt["acknowledged_sequence"]
            )
            self.journal.save(receipt)
            with self.journal.db:
                self.journal.db.execute(
                    "DELETE FROM chat_events WHERE run_id=? AND sequence<=?",
                    (identifier, through),
                )
        elif action == "chat_cancel":
            if receipt["state"] not in TERMINAL:
                receipt["state"] = "cancelling"
                self.journal.save(receipt)
                await self.cancel_turn(identifier)
        elif action == "chat_respond":
            request = next(
                (row for row in receipt["requests"] if row["id"] == data["request_id"]),
                None,
            )
            if request is None or request["version"] != data["version"]:
                raise ValueError("Stale interaction")
            dispatch_until = data.get(
                "dispatch_until_unix_ms", request["deadline_unix_ms"]
            )
            if dispatch_until <= milliseconds():
                raise ValueError("Response dispatch expired")
            response = data["response"]
            validate_answer(request["payload"], response)
            if len(encode(response).encode()) > 8192:
                raise ValueError("Response too large")
            if request["response"] is not None:
                if request["response"] != response:
                    raise ValueError("Interaction already answered")
            else:
                if (
                    receipt["state"] in TERMINAL | {"cancelling"}
                    or request["deadline_unix_ms"] <= milliseconds()
                ):
                    raise ValueError("Interaction expired")
                waiter = self.answers.get(request["id"])
                if waiter is None or waiter.done():
                    raise ValueError("Interaction unavailable")
                if (
                    len(encode(receipt).encode()) + len(encode(response).encode())
                    > 30000
                ):
                    raise ValueError("Interaction capacity reached")
                request.update(response=response, delivered=True)
                request["payload"]["status"] = "submitted"
                self.journal.save(
                    receipt, {"type": "interaction.updated", "data": request["payload"]}
                )
                waiter.set_result({**response, "_dispatch_until": dispatch_until})
        elif action != "chat_inspect":
            raise ValueError("Unknown action")
        return {"type": "receipt", "receipt": self.journal.get(identifier)}

    async def cancel_turn(self, identifier):
        receipt = self.journal.get(identifier)
        if receipt["state"] not in TERMINAL:
            receipt["state"] = "cancelling"
            self.journal.save(receipt)
        for request in receipt["requests"]:
            waiter = self.answers.get(request["id"])
            if waiter is not None and not waiter.done():
                waiter.set_result({"cancelled": True})
        await self.cancel(receipt["session_id"])

    async def execute(self, spec):
        identifier = spec["run_id"]
        receipt = self.journal.get(identifier)
        output_limited = False
        output_bytes = 0
        flush_handle = None
        messages = {}
        default_message_id = f"{identifier}:assistant"

        def save(kind, data):
            self.journal.save(self.journal.get(identifier), {"type": kind, "data": data})

        def flush():
            nonlocal flush_handle
            if flush_handle is not None:
                flush_handle.cancel()
                flush_handle = None
            for mid, message in messages.items():
                while message["pending"]:
                    chunk = message["pending"][:2048]
                    message["pending"] = message["pending"][len(chunk):]
                    save("message.delta", {"id": mid, "text": chunk})

        def ensure_message(mid, data):
            if mid not in messages:
                flush()
                messages[mid] = {"text": "", "pending": "", "redactor": StreamRedactor(), "completed": False}
                save("message.created", {
                    "id": mid, "role": "assistant", "content": [{"type": "text", "text": ""}],
                    **({"phase": data["phase"]} if data.get("phase") else {}),
                })
            return messages[mid]

        def append_text(message, delta):
            nonlocal output_bytes, output_limited
            remaining = max(0, 60000 - output_bytes)
            if len(delta.encode()) > remaining:
                output_limited = True
                delta = delta.encode()[:remaining].decode("utf-8", "ignore")
            output_bytes += len(delta.encode())
            message["text"] += delta
            message["pending"] += delta

        def complete(mid, data):
            message = ensure_message(mid, data)
            if message["completed"]:
                return
            append_text(message, message["redactor"].feed("", final=True))
            # A completed native item may include text that had no delta notification.
            content = data.get("content") or []
            final = safe_text(content[0].get("text", "")) if content else ""
            if final.startswith(message["text"]):
                append_text(message, final[len(message["text"]):])
            flush()
            save("message.completed", {
                "id": mid, "role": "assistant", "completed": True,
                **({"phase": data["phase"]} if data.get("phase") else {}),
            })
            message["completed"] = True

        def emit(kind, data):
            nonlocal flush_handle, output_limited
            if kind.startswith("message."):
                mid = data.get("id") or default_message_id
                message = ensure_message(mid, data)
                if kind == "message.delta" and not message["completed"]:
                    append_text(message, message["redactor"].feed(str(data.get("text", ""))))
                    if len(message["pending"].encode()) >= 2048:
                        flush()
                    elif flush_handle is None:
                        flush_handle = asyncio.get_running_loop().call_later(0.1, flush)
                elif kind == "message.completed":
                    complete(mid, data)
                return
            flush()
            if len(encode(data).encode()) > 16384:
                output_limited = True
                return
            save(kind, data)

        async def ask(payload):
            current = self.journal.get(identifier)
            if current["state"] in TERMINAL | {"cancelling"} or spec["deadline_unix_ms"] <= milliseconds():
                return {"cancelled": True}
            emit(
                "turn.updated",
                {"id": identifier, "status": "waiting_for_input", "terminal": False},
            )
            current = self.journal.get(identifier)
            if (
                sum(row["response"] is None for row in current["requests"]) >= 4
                or len(current["requests"]) >= 32
            ):
                raise ValueError("Too many interactions")
            request_id = str(uuid.uuid4())
            deadline = min(spec["deadline_unix_ms"], milliseconds() + 300000)
            payload = {
                **payload,
                "id": request_id,
                "version": 1,
                "status": "pending",
                "expires_at_unix_ms": deadline,
            }
            request = {
                "id": request_id,
                "native_id": request_id,
                "kind": payload["kind"],
                "version": 1,
                "payload": payload,
                "deadline_unix_ms": deadline,
                "response": None,
                "delivered": False,
            }
            if len(encode(current["requests"] + [request]).encode()) > 24000:
                raise ValueError("Interaction capacity reached")
            current["requests"].append(request)
            current["state"] = "waiting_for_input"
            waiter = asyncio.get_running_loop().create_future()
            self.answers[request_id] = waiter
            self.journal.save(current, {"type": "interaction.created", "data": payload})
            try:
                result = await asyncio.wait_for(
                    waiter, max(0, (deadline - milliseconds()) / 1000)
                )
                current = self.journal.get(identifier)
                expired = result.pop("_dispatch_until", deadline) <= milliseconds()
                if expired:
                    await self.cancel_turn(identifier)
                if (
                    expired
                    or current["state"] in TERMINAL | {"cancelling"}
                    or result.get("cancelled")
                ):
                    return {"cancelled": True}
                current["state"] = "running"
                self.journal.save(
                    current,
                    {
                        "type": "turn.updated",
                        "data": {
                            "id": identifier,
                            "status": "running",
                            "terminal": False,
                        },
                    },
                )
                return result
            except TimeoutError:
                current = self.journal.get(identifier)
                item = next(
                    row for row in current["requests"] if row["id"] == request_id
                )
                item["payload"]["status"] = "expired"
                self.journal.save(
                    current, {"type": "interaction.updated", "data": item["payload"]}
                )
                await self.cancel_turn(identifier)
                return {"cancelled": True}
            finally:
                self.answers.pop(request_id, None)

        try:
            if (
                receipt["state"] == "cancelling"
                or spec["deadline_unix_ms"] <= milliseconds()
            ):
                receipt.update(
                    state="cancelled",
                    children_complete=True,
                    finished_unix_ms=milliseconds(),
                )
                self.journal.save(
                    receipt,
                    {
                        "type": "turn.updated",
                        "data": {
                            "id": identifier,
                            "status": "cancelled",
                            "terminal": True,
                        },
                    },
                )
                return
            receipt.update(state="running", started_unix_ms=milliseconds())
            self.journal.save(
                receipt,
                {
                    "type": "turn.updated",
                    "data": {"id": identifier, "status": "running", "terminal": False},
                },
            )
            operation = asyncio.create_task(self.run(spec, emit, ask))
            try:
                result = await asyncio.wait_for(
                    asyncio.shield(operation),
                    max(0, (spec["deadline_unix_ms"] - milliseconds()) / 1000),
                )
            except (TimeoutError, asyncio.CancelledError):
                await self.cancel_turn(identifier)
                try:
                    result = await asyncio.wait_for(asyncio.shield(operation), 10)
                    result = {**result, "cancelled": True}
                except (TimeoutError, Exception):
                    operation.add_done_callback(
                        lambda done: done.exception() if not done.cancelled() else None
                    )
                    raise
            if not result.get("failed") and not result.get("cancelled"):
                publish_files(identifier, emit)
            for mid in list(messages):
                complete(mid, {})
            # Native item messages are authoritative. Legacy runners may only return
            # a final reply; put it after activity without replacing partial output.
            if not result.get("failed") and not result.get("cancelled") and not result.get("streamed_messages"):
                final_text = safe_text(result.get("text", ""))
                last_text = next(reversed(messages.values()))["text"] if messages else ""
                if final_text and final_text != last_text:
                    mid = f"{identifier}:final" if messages else default_message_id
                    emit("message.delta", {"id": mid, "text": final_text})
                    complete(mid, {})
            receipt = self.journal.get(identifier)
            receipt.update(
                error_code="output_limit" if output_limited else failure_code(result),
                state="cancelled"
                if result.get("cancelled") or receipt["state"] == "cancelling"
                else "failed"
                if result.get("failed") or output_limited
                else "succeeded",
                children_complete=True,
                native_session_id=result.get("session_id"),
                finished_unix_ms=milliseconds(),
            )
        except BaseException:  # noqa: BLE001 - Interruption must retain an uncertain receipt.
            try:
                await self.cancel(spec["session_id"])
            except Exception:  # noqa: BLE001, S110 - Keep the uncertain outcome when cancellation fails.
                pass
            receipt = self.journal.get(identifier)
            receipt.update(
                state="outcome_unknown",
                error_code="execution_interrupted",
                finished_unix_ms=milliseconds(),
                children_complete=False,
            )
            if self.settled:
                try:
                    receipt["children_complete"] = await self.settled(
                        spec["session_id"]
                    )
                except Exception:  # noqa: BLE001, S110 - Missing proof retains the uncertain outcome.
                    pass
        for mid in list(messages):
            complete(mid, {})
        for request in receipt["requests"]:
            if request["payload"]["status"] != "expired":
                request["payload"]["status"] = (
                    "resolved"
                    if request["response"] is not None and receipt["children_complete"]
                    else "cancelled"
                )
            emit("interaction.updated", request["payload"])
        receipt["last_sequence"] = self.journal.get(identifier)["last_sequence"]
        self.journal.save(
            receipt,
            {
                "type": "turn.updated",
                "data": {
                    "id": identifier,
                    "status": {"succeeded": "completed"}.get(
                        receipt["state"], receipt["state"]
                    ),
                    "terminal": True,
                    "blocker": {
                        "code": receipt.get("error_code") or "execution_failed",
                        "message": "The turn failed. Any partial response is preserved; completion was not confirmed.",
                        "scope": "turn",
                        "retryable": False,
                        "actions": ["manage_model_key", "refresh_status"]
                        if receipt.get("error_code")
                        in {
                            "model_key_invalid",
                            "model_key_missing",
                            "included_credits_exhausted",
                            "included_credits_unavailable",
                        }
                        else ["refresh_status"],
                    }
                    if receipt["state"] == "failed"
                    else None,
                },
            },
        )

    async def close(self):
        self.draining = True
        for identifier in list(self.tasks):
            await self.cancel(self.journal.get(identifier)["session_id"])
        for task in list(self.tasks.values()):
            task.cancel()
        if self.tasks:
            await asyncio.gather(*list(self.tasks.values()), return_exceptions=True)
        self.journal.close()


def file_instruction(identifier):
    uuid.UUID(identifier)
    return (
        "\nWhen creating a file for download, save it as "
        f"/home/agent/.inkbox-chat-{identifier}-<filename>. "
        "Only regular files up to 256 KiB can be attached; create at most 8 files."
    )


def publish_files(identifier, emit):
    try:
        uuid.UUID(identifier)
    except ValueError:
        return
    prefix = f".inkbox-chat-{identifier}-"
    for path in sorted(Path("/home/agent").glob(prefix + "*"))[:8]:
        try:
            descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            with os.fdopen(descriptor, "rb") as stream:
                info = os.fstat(stream.fileno())
                if not stat.S_ISREG(info.st_mode) or info.st_size > 262144:
                    continue
                data = stream.read(262145)
            if len(data) > 262144:
                continue
            name = path.name[len(prefix) :]
            if not name or len(name.encode()) > 255 or any(ord(c) < 32 for c in name):
                continue
            emit(
                "artifact.created",
                {
                    "id": str(uuid.uuid5(uuid.UUID(identifier), name)),
                    "guest_path": str(path),
                    "name": name,
                    "media_type": mimetypes.guess_type(name)[0]
                    or "application/octet-stream",
                    "size_bytes": len(data),
                    "sha256": hashlib.sha256(data).hexdigest(),
                },
            )
        except OSError:
            continue


def safe_text(value):
    text = str(value)
    for name, secret in os.environ.items():
        if (
            secret
            and len(secret) >= 8
            and any(
                word in name.upper()
                for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY")
            )
        ):
            text = text.replace(secret, "[redacted]")
    return re.sub(r"(?i)(bearer\s+)[a-z0-9._-]{16,}", r"\1[redacted]", text)


class StreamRedactor:
    def __init__(self):
        self.pending = ""
        self.secrets = tuple(
            secret
            for name, secret in os.environ.items()
            if len(secret) >= 8
            and any(
                word in name.upper()
                for word in ("TOKEN", "SECRET", "PASSWORD", "API_KEY")
            )
        )

    def feed(self, value, final=False):
        self.pending += value
        if final:
            result = safe_text(self.pending)
            self.pending = ""
            return result
        boundary = len(self.pending)
        for secret in self.secrets:
            start = self.pending.find(secret)
            while start >= 0:
                self.pending = (
                    self.pending[:start]
                    + "[redacted]"
                    + self.pending[start + len(secret) :]
                )
                start = self.pending.find(secret, start + 10)
            boundary = min(boundary, len(self.pending))
            for length in range(min(len(secret) - 1, len(self.pending)), 0, -1):
                if self.pending.endswith(secret[:length]):
                    boundary = min(boundary, len(self.pending) - length)
                    break
        match = re.search(
            r"(?i)(?:bearer\s+[a-z0-9._-]*|b(?:e(?:a(?:r(?:e(?:r)?)?)?)?)?)$",
            self.pending,
        )
        if match:
            boundary = min(boundary, match.start())
        result = safe_text(self.pending[:boundary])
        self.pending = self.pending[boundary:]
        return result

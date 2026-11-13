"""Bounded remote tool discovery and durable write continuations."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
from typing import Any
from urllib.parse import urlsplit
from uuid import uuid4

import httpx
from collections.abc import Callable
from jsonschema import Draft202012Validator, SchemaError

PROTOCOL_VERSION = "2026-07-28"
MAX_MESSAGE_BYTES = 1_000_000
MAX_CATALOG_BYTES = 4_000_000
MAX_TOOLS = 512
MAX_CALLS = 20_000
_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


class RemoteToolError(RuntimeError):
    pass


def _json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _bounded_json(value: Any) -> None:
    pending = [(value, 0)]
    count = 0
    while pending:
        item, depth = pending.pop()
        count += 1
        if depth > 64 or count > 50_000:
            raise RemoteToolError("Remote JSON exceeds its structural limits")
        if isinstance(item, dict):
            pending.extend((child, depth + 1) for child in item.values())
        elif isinstance(item, list):
            pending.extend((child, depth + 1) for child in item)


def _validate_schema(schema: Any) -> None:
    if not isinstance(schema, dict):
        raise RemoteToolError("Invalid remote tool schema")
    if (
        schema.get("$schema", "https://json-schema.org/draft/2020-12/schema")
        != "https://json-schema.org/draft/2020-12/schema"
    ):
        raise RemoteToolError("Unsupported remote tool schema dialect")
    try:
        Draft202012Validator.check_schema(schema)
    except SchemaError:
        raise RemoteToolError("Invalid remote tool schema") from None


class CallJournal:
    def __init__(self, path: Path, scope: str) -> None:
        self.path, self.scope = path, scope
        path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        descriptor = os.open(
            path, os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600
        )
        try:
            metadata = os.fstat(descriptor)
            if not stat.S_ISREG(metadata.st_mode) or (
                hasattr(os, "getuid") and metadata.st_uid != os.getuid()
            ):
                raise ValueError("Tool-call history must be an owned regular file")
            if hasattr(os, "fchmod"):
                os.fchmod(descriptor, 0o600)
        finally:
            os.close(descriptor)
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS calls (
                id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL,
                request_state TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )""")

    def _db(self) -> sqlite3.Connection:
        return sqlite3.connect(self.path, timeout=3)

    def begin(
        self, identity: str, name: str, arguments: dict
    ) -> tuple[str, str | None]:
        identifier = hashlib.sha256(_json([self.scope, identity]).encode()).hexdigest()
        fingerprint = hashlib.sha256(_json([name, arguments]).encode()).hexdigest()
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT fingerprint, request_state FROM calls WHERE id=?", (identifier,)
            ).fetchone()
            if row is None:
                if db.execute("SELECT count(*) FROM calls").fetchone()[0] >= MAX_CALLS:
                    raise RemoteToolError(
                        "Tool-call history is full; inspect it before continuing"
                    )
                db.execute(
                    "INSERT INTO calls(id, fingerprint) VALUES (?, ?)",
                    (identifier, fingerprint),
                )
                return identifier, None
            if row[0] != fingerprint:
                raise RemoteToolError(
                    "A tool-call identity cannot be reused with different arguments"
                )
            return identifier, row[1]

    def bind(self, identifier: str, state: str) -> str:
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            db.execute(
                "UPDATE calls SET request_state=? WHERE id=? AND request_state IS NULL",
                (state, identifier),
            )
            row = db.execute(
                "SELECT request_state FROM calls WHERE id=?", (identifier,)
            ).fetchone()
            if row is None or row[0] is None:
                raise RemoteToolError("The tool continuation could not be saved")
            return row[0]


class RemoteMcp:
    """Pull a validated catalog and reconcile calls using a caller-owned identity.

    Refresh only between native turns. Keep the journal until its native session
    is retired; deleting a live session's journal can discard retry protection.
    This client does not grant approval or infer call identities from arguments.
    """

    def __init__(
        self, *, api_key: str, base_url: str, identity: str, journal_path: Path
    ) -> None:
        url = urlsplit(base_url)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username
            or url.password
            or url.query
            or url.fragment
            or url.path not in {"", "/"}
            or url.scheme == "http"
            and url.hostname not in {"localhost", "127.0.0.1", "::1"}
        ):
            raise ValueError("Remote tools require an HTTPS API origin")
        self.url = base_url.rstrip("/") + "/mcp"
        self.api_key = api_key
        self.journal = CallJournal(journal_path, _json([self.url, identity]))
        self._catalog: tuple[dict, ...] = ()
        self.catalog_digest: str | None = None

    async def request(
        self, method: str, params: dict, *, limit: int = MAX_MESSAGE_BYTES
    ) -> dict:
        identifier = uuid4().hex
        payload = _json(
            {
                "jsonrpc": "2.0",
                "id": identifier,
                "method": method,
                "params": {
                    **params,
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
                        "io.modelcontextprotocol/clientCapabilities": {
                            "elicitation": {}
                        },
                    },
                },
            }
        ).encode()
        if len(payload) > MAX_MESSAGE_BYTES:
            raise RemoteToolError(
                "Tool request exceeds the size limit; stage files separately"
            )
        headers = {
            "X-Api-Key": self.api_key,
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
            "Mcp-Protocol-Version": PROTOCOL_VERSION,
            "Mcp-Method": method,
        }
        if method == "tools/call":
            headers["Mcp-Name"] = params["name"]
        try:
            async with httpx.AsyncClient(timeout=55, follow_redirects=False) as session:
                async with session.stream(
                    "POST", self.url, content=payload, headers=headers
                ) as response:
                    if response.status_code != 200:
                        raise RemoteToolError(
                            f"Remote tool request failed (HTTP {response.status_code})"
                        )
                    data = bytearray()
                    async for chunk in response.aiter_bytes(65536):
                        data.extend(chunk)
                        if len(data) > limit:
                            raise RemoteToolError(
                                "Remote tool response exceeds the size limit"
                            )
        except (httpx.HTTPError, TimeoutError):
            raise RemoteToolError(
                "Remote tool outcome is unavailable; retain the same call identity"
            ) from None
        try:
            body = json.loads(data)
        except (ValueError, UnicodeError, RecursionError):
            raise RemoteToolError("Invalid remote tool response") from None
        _bounded_json(body)
        if (
            not isinstance(body, dict)
            or body.get("jsonrpc") != "2.0"
            or body.get("id") != identifier
        ):
            raise RemoteToolError("Invalid remote tool response")
        if "error" in body:
            code = (
                body["error"].get("code") if isinstance(body["error"], dict) else None
            )
            raise RemoteToolError(
                f"Remote tool request failed (code {code if type(code) is int else 'unknown'})"
            )
        result = body.get("result")
        if not isinstance(result, dict):
            raise RemoteToolError("Invalid remote tool result")
        return result

    async def refresh(self) -> list[dict]:
        async with asyncio.timeout(15):
            discovery = await self.request("server/discover", {})
            if PROTOCOL_VERSION not in discovery.get("supportedVersions", []):
                raise RemoteToolError("The remote tool protocol is unsupported")
            catalog, names, cursors, total = [], set(), set(), 0
            params = {}
            for _ in range(16):
                result = await self.request(
                    "tools/list", params, limit=MAX_CATALOG_BYTES
                )
                _bounded_json(result)
                total += len(_json(result).encode())
                rows = result.get("tools")
                if (
                    not isinstance(rows, list)
                    or len(catalog) + len(rows) > MAX_TOOLS
                    or total > MAX_CATALOG_BYTES
                ):
                    raise RemoteToolError("Remote tool catalog exceeds its limits")
                for row in rows:
                    if (
                        not isinstance(row, dict)
                        or not isinstance(row.get("name"), str)
                        or not _NAME.fullmatch(row["name"])
                        or row["name"] in names
                        or not isinstance(row.get("inputSchema"), dict)
                        or not isinstance(row.get("description", ""), str)
                    ):
                        raise RemoteToolError("Invalid remote tool catalog")
                    names.add(row["name"])
                    _validate_schema(row["inputSchema"])
                    if "outputSchema" in row:
                        _validate_schema(row["outputSchema"])
                    if "annotations" in row and not isinstance(
                        row["annotations"], dict
                    ):
                        raise RemoteToolError("Invalid remote tool annotations")
                    catalog.append(row)
                cursor = result.get("nextCursor")
                if cursor is None:
                    break
                if (
                    not isinstance(cursor, str)
                    or not cursor
                    or len(cursor) > 4096
                    or cursor in cursors
                ):
                    raise RemoteToolError("Invalid remote catalog cursor")
                cursors.add(cursor)
                params = {"cursor": cursor}
            else:
                raise RemoteToolError("Remote tool catalog exceeds its page limit")
        encoded = _json(catalog)
        self.catalog_digest = hashlib.sha256(encoded.encode()).hexdigest()
        self._catalog = tuple(json.loads(encoded))
        return json.loads(encoded)

    async def call(
        self,
        name: str,
        arguments: dict,
        *,
        call_identity: str,
        before_execute: Callable[[], None] | None = None,
        before_submit: Callable[[], None] | None = None,
        journal_path: Path | None = None,
    ) -> dict:
        if not any(row["name"] == name for row in self._catalog):
            raise RemoteToolError("The tool is unavailable in this catalog generation")
        if not isinstance(call_identity, str) or not 1 <= len(call_identity) <= 1024:
            raise ValueError("A stable tool-call identity is required")
        if not isinstance(arguments, dict):
            raise ValueError("Tool arguments must be an object")
        _bounded_json(arguments)
        if len(_json(arguments).encode()) > MAX_MESSAGE_BYTES:
            raise RemoteToolError(
                "Tool arguments exceed the size limit; stage files separately"
            )
        journal = (
            self.journal
            if journal_path is None
            else CallJournal(journal_path, self.journal.scope)
        )
        identifier, state = journal.begin(call_identity, name, arguments)
        params = {"name": name, "arguments": arguments}
        if state is not None:
            params["requestState"] = state
        if before_execute is not None:
            before_execute()
        if state is not None and before_submit is not None:
            before_submit()
        result = await self.request("tools/call", params)
        if result.get("resultType") == "input_required":
            if set(result) != {"resultType", "requestState"}:
                raise RemoteToolError("The tool requires an unsupported interaction")
            next_state = result.get("requestState")
            if (
                state is not None
                or not isinstance(next_state, str)
                or not 1 <= len(next_state) <= 2048
            ):
                raise RemoteToolError(
                    "Invalid tool continuation; the operation was not repeated"
                )
            state = journal.bind(identifier, next_state)
            if before_execute is not None:
                before_execute()
            if before_submit is not None:
                before_submit()
            result = await self.request("tools/call", {**params, "requestState": state})
            if result.get("resultType") == "input_required":
                raise RemoteToolError("The tool requires an unsupported interaction")
        if not isinstance(result.get("content"), list):
            raise RemoteToolError("Invalid remote tool result")
        return result

    def terminal_replies(
        self, *, journal_path: Path | None = None
    ) -> TerminalReplyJournal:
        return TerminalReplyJournal(
            journal_path or self.journal.path, self.journal.scope
        )


class TerminalReplyJournal(CallJournal):
    """Source-bound terminal intent; contains hashes and receipts, never messages."""

    def __init__(self, path: Path, scope: str) -> None:
        super().__init__(path, scope)
        with self._db() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS terminal_replies (
                id TEXT PRIMARY KEY, operation_id TEXT NOT NULL,
                arguments_hash TEXT NOT NULL,
                state TEXT NOT NULL CHECK(state IN ('pending','accepted','rejected')),
                submitted INTEGER NOT NULL DEFAULT 0 CHECK(submitted IN (0,1)),
                accepted_id TEXT
            )""")

    def _source(self, source_hash: str) -> str:
        if not isinstance(source_hash, str) or not re.fullmatch(
            r"[0-9a-f]{64}", source_hash
        ):
            raise ValueError("A source hash is required")
        return hashlib.sha256(_json([self.scope, source_hash]).encode()).hexdigest()

    @staticmethod
    def _record(row: tuple) -> dict:
        return dict(
            zip(
                ("operation_id", "arguments_hash", "state", "submitted", "accepted_id"),
                row,
            )
        ) | {"submitted": bool(row[3])}

    def lookup(self, source_hash: str) -> dict | None:
        with self._db() as db:
            row = db.execute(
                "SELECT operation_id, arguments_hash, state, submitted, accepted_id FROM terminal_replies WHERE id=?",
                (self._source(source_hash),),
            ).fetchone()
            return self._record(row) if row else None

    def reserve(self, source_hash: str, operation_id: str, arguments_hash: str) -> dict:
        identifier = self._source(source_hash)
        if not isinstance(operation_id, str) or not 1 <= len(operation_id) <= 1024:
            raise ValueError("A stable reply operation identity is required")
        if not isinstance(arguments_hash, str) or not re.fullmatch(
            r"[0-9a-f]{64}", arguments_hash
        ):
            raise ValueError("A reply argument hash is required")
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            row = db.execute(
                "SELECT operation_id, arguments_hash, state, submitted, accepted_id FROM terminal_replies WHERE id=?",
                (identifier,),
            ).fetchone()
            if row and row[2] == "accepted":
                return self._record(row)
            if row and row[2] == "pending":
                if row[:2] != (operation_id, arguments_hash):
                    raise RemoteToolError(
                        "A terminal reply is pending; reconcile its original operation"
                    )
                return self._record(row)
            if (
                row is None
                and db.execute("SELECT count(*) FROM terminal_replies").fetchone()[0]
                >= MAX_CALLS
            ):
                raise RemoteToolError(
                    "Terminal reply history is full; inspect it before continuing"
                )
            db.execute(
                "INSERT INTO terminal_replies(id,operation_id,arguments_hash,state) VALUES (?,?,?,'pending') ON CONFLICT(id) DO UPDATE SET operation_id=excluded.operation_id,arguments_hash=excluded.arguments_hash,state='pending',submitted=0,accepted_id=NULL",
                (identifier, operation_id, arguments_hash),
            )
            return self._record((operation_id, arguments_hash, "pending", 0, None))

    def mark_submitted(self, source_hash: str, operation_id: str) -> None:
        with self._db() as db:
            updated = db.execute(
                "UPDATE terminal_replies SET submitted=1 WHERE id=? AND operation_id=? AND state='pending'",
                (self._source(source_hash), operation_id),
            )
            if updated.rowcount != 1:
                raise RemoteToolError("The terminal reply is no longer pending")

    def reject(self, source_hash: str, operation_id: str) -> None:
        with self._db() as db:
            updated = db.execute(
                "UPDATE terminal_replies SET state='rejected' WHERE id=? AND operation_id=? AND state IN ('pending','rejected') AND submitted=0",
                (self._source(source_hash), operation_id),
            )
            if updated.rowcount != 1:
                raise RemoteToolError(
                    "A submitted or accepted terminal reply cannot be discarded"
                )

    def accept(self, source_hash: str, operation_id: str, accepted_id: str) -> None:
        if not isinstance(accepted_id, str) or not 1 <= len(accepted_id) <= 512:
            raise ValueError("A reply acceptance receipt is required")
        with self._db() as db:
            updated = db.execute(
                "UPDATE terminal_replies SET state='accepted',accepted_id=? WHERE id=? AND operation_id=? AND submitted=1 AND (state='pending' OR (state='accepted' AND accepted_id=?))",
                (accepted_id, self._source(source_hash), operation_id, accepted_id),
            )
            if updated.rowcount != 1:
                raise RemoteToolError(
                    "The terminal reply receipt does not match its pending operation"
                )

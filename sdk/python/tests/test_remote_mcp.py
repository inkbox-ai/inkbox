import asyncio
import json
import sqlite3
import os

import httpx
import pytest

from inkbox import remote_mcp as module
from inkbox.remote_mcp import PROTOCOL_VERSION, RemoteMcp, RemoteToolError


def descriptor(name="example_read", **updates):
    return {
        "name": name,
        "description": "Example",
        "inputSchema": {"type": "object"},
        **updates,
    }


@pytest.fixture
def remote(tmp_path):
    return RemoteMcp(
        api_key="synthetic-key",
        base_url="https://example.test",
        identity="example",
        journal_path=tmp_path / "calls.sqlite",
    )


def serve_catalog(monkeypatch, remote, pages):
    remaining = iter(pages)

    async def request(method, params, **kwargs):
        if method == "server/discover":
            return {"supportedVersions": [PROTOCOL_VERSION]}
        assert method == "tools/list"
        return next(remaining)

    monkeypatch.setattr(remote, "request", request)


async def test_catalog_add_change_remove_and_atomic_failed_refresh(remote, monkeypatch):
    serve_catalog(
        monkeypatch,
        remote,
        [
            {"tools": [descriptor()], "nextCursor": "more"},
            {
                "tools": [
                    descriptor("example_write", annotations={"readOnlyHint": False})
                ]
            },
        ],
    )
    first = await remote.refresh()
    first_digest = remote.catalog_digest
    assert len(first) == 2
    first[0]["name"] = "mutated_by_caller"
    assert remote._catalog[0]["name"] == "example_read"
    serve_catalog(monkeypatch, remote, [{"tools": [descriptor(description="Changed")]}])
    assert (await remote.refresh())[0]["description"] == "Changed"
    assert remote.catalog_digest != first_digest
    valid_digest = remote.catalog_digest
    serve_catalog(
        monkeypatch,
        remote,
        [{"tools": [descriptor()], "nextCursor": "more"}, {"tools": [descriptor()]}],
    )
    with pytest.raises(RemoteToolError, match="Invalid remote tool catalog"):
        await remote.refresh()
    assert remote.catalog_digest == valid_digest
    assert remote._catalog[0]["description"] == "Changed"


@pytest.mark.parametrize(
    "page",
    [
        {"tools": None},
        {"tools": [descriptor(name="bad name")]},
        {"tools": [descriptor(inputSchema=[])]},
        {"tools": [descriptor(description=3)]},
        {"tools": [], "nextCursor": ""},
        {"tools": [], "nextCursor": 3},
    ],
)
async def test_invalid_catalog(remote, monkeypatch, page):
    serve_catalog(monkeypatch, remote, [page])
    with pytest.raises(RemoteToolError):
        await remote.refresh()
    assert remote.catalog_digest is None


async def test_catalog_page_tool_and_byte_bounds(remote, monkeypatch):
    serve_catalog(monkeypatch, remote, [{"tools": [], "nextCursor": "again"}] * 2)
    with pytest.raises(RemoteToolError, match="cursor"):
        await remote.refresh()
    monkeypatch.setattr(module, "MAX_TOOLS", 1)
    serve_catalog(
        monkeypatch, remote, [{"tools": [descriptor(), descriptor("second")]}]
    )
    with pytest.raises(RemoteToolError, match="limits"):
        await remote.refresh()


@pytest.mark.parametrize(
    "schema",
    [
        {"type": "not-a-json-type"},
        {"type": "object", "required": "wrong"},
        {"$schema": "https://example.test/untrusted-dialect"},
        {"type": "object", "properties": {"field": {"type": 3}}},
    ],
)
async def test_invalid_schema_is_not_published(remote, monkeypatch, schema):
    serve_catalog(monkeypatch, remote, [{"tools": [descriptor(inputSchema=schema)]}])
    with pytest.raises(RemoteToolError, match="schema"):
        await remote.refresh()
    assert remote.catalog_digest is None


async def test_nested_schema_bound_precedes_validation(remote, monkeypatch):
    schema = {}
    for _ in range(70):
        schema = {"properties": {"nested": schema}}
    serve_catalog(monkeypatch, remote, [{"tools": [descriptor(inputSchema=schema)]}])
    with pytest.raises(RemoteToolError, match="structural limits"):
        await remote.refresh()


async def test_external_schema_reference_is_not_fetched(remote, monkeypatch):
    serve_catalog(
        monkeypatch,
        remote,
        [
            {
                "tools": [
                    descriptor(
                        inputSchema={
                            "type": "object",
                            "$ref": "https://example.test/never-fetched",
                        }
                    )
                ]
            }
        ],
    )
    assert (await remote.refresh())[0]["inputSchema"][
        "$ref"
    ] == "https://example.test/never-fetched"
    monkeypatch.setattr(module, "MAX_CATALOG_BYTES", 2)
    serve_catalog(monkeypatch, remote, [{"tools": []}])
    with pytest.raises(RemoteToolError, match="limits"):
        await remote.refresh()


async def test_retries_reuse_continuation_across_client_restart(remote, monkeypatch):
    calls, external_writes = [], set()
    lose_reply = True

    async def request(method, params, **kwargs):
        nonlocal lose_reply
        calls.append(params.copy())
        if "requestState" not in params:
            return {
                "resultType": "input_required",
                "requestState": f"signed-{len(calls)}",
            }
        external_writes.add(params["requestState"])
        if lose_reply:
            lose_reply = False
            raise RemoteToolError("Reply lost")
        return {"content": [], "structuredContent": {"id": "message-example"}}

    remote._catalog = (descriptor("example_write"),)
    monkeypatch.setattr(remote, "request", request)
    with pytest.raises(RemoteToolError, match="Reply lost"):
        await remote.call(
            "example_write", {"text": "private body"}, call_identity="native-call-1"
        )
    replacement = RemoteMcp(
        api_key="rotated-key",
        base_url="https://example.test",
        identity="example",
        journal_path=remote.journal.path,
    )
    replacement._catalog = remote._catalog
    monkeypatch.setattr(replacement, "request", request)
    assert (
        await replacement.call(
            "example_write", {"text": "private body"}, call_identity="native-call-1"
        )
    )["structuredContent"]["id"] == "message-example"
    assert len(external_writes) == 1
    assert calls[1]["requestState"] == calls[2]["requestState"]
    await replacement.call(
        "example_write", {"text": "private body"}, call_identity="native-call-2"
    )
    assert len(external_writes) == 2
    assert b"private body" not in remote.journal.path.read_bytes()


async def test_expired_or_revoked_continuation_never_restarts_write(
    remote, monkeypatch
):
    remote._catalog = (descriptor(),)
    identifier, _ = remote.journal.begin("call", "example_read", {})
    remote.journal.bind(identifier, "expired-signed-state")
    calls = []

    async def request(method, params, **kwargs):
        calls.append(params)
        raise RemoteToolError("Continuation expired")

    monkeypatch.setattr(remote, "request", request)
    for _ in range(2):
        with pytest.raises(RemoteToolError, match="expired"):
            await remote.call("example_read", {}, call_identity="call")
    assert all(call["requestState"] == "expired-signed-state" for call in calls)


async def test_lifetime_rechecked_before_second_request(remote, monkeypatch):
    remote._catalog = (descriptor(),)
    checks = 0
    calls = []

    def validate():
        nonlocal checks
        checks += 1
        if checks == 2:
            raise ValueError("Turn ended")

    async def request(method, params, **kwargs):
        calls.append(params)
        return {"resultType": "input_required", "requestState": "signed-state"}

    monkeypatch.setattr(remote, "request", request)
    with pytest.raises(ValueError, match="Turn ended"):
        await remote.call(
            "example_read", {}, call_identity="call", before_execute=validate
        )
    assert len(calls) == 1
    assert remote.journal.begin("call", "example_read", {})[1] == "signed-state"


def test_journal_identity_argument_binding_and_capacity(remote, monkeypatch):
    identifier, state = remote.journal.begin("call", "example", {"x": 1})
    assert state is None
    assert remote.journal.bind(identifier, "first") == "first"
    assert remote.journal.bind(identifier, "second") == "first"
    with pytest.raises(RemoteToolError, match="different arguments"):
        remote.journal.begin("call", "example", {"x": 2})
    monkeypatch.setattr(module, "MAX_CALLS", 1)
    with pytest.raises(RemoteToolError, match="history is full"):
        remote.journal.begin("another", "example", {})
    if os.name != "nt":
        assert remote.journal.path.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "origin",
    [
        "http://example.test",
        "https://user:pass@example.test",
        "https://example.test/path",
        "https://example.test?key=secret",
        "https://example.test#fragment",
    ],
)
def test_unsafe_origins_refused(tmp_path, origin):
    with pytest.raises(ValueError, match="HTTPS API origin"):
        RemoteMcp(
            api_key="synthetic",
            base_url=origin,
            identity="example",
            journal_path=tmp_path / "calls.sqlite",
        )


async def test_protocol_headers_results_and_safe_errors(remote, monkeypatch):
    original_client = httpx.AsyncClient
    requests = []

    def handle(request):
        requests.append(request)
        payload = json.loads(request.content)
        assert request.url == "https://example.test/mcp"
        assert request.headers["x-api-key"] == "synthetic-key"
        assert request.headers["mcp-method"] == payload["method"]
        assert request.headers["mcp-protocol-version"] == PROTOCOL_VERSION
        assert payload["params"]["_meta"][
            "io.modelcontextprotocol/clientCapabilities"
        ] == {"elicitation": {}}
        return httpx.Response(
            200, json={"jsonrpc": "2.0", "id": payload["id"], "result": {"tools": []}}
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(handle), **kwargs
        ),
    )
    assert await remote.request("tools/list", {}) == {"tools": []}
    assert len(requests) == 1


@pytest.mark.parametrize("failure", ["status", "protocol", "json", "large", "timeout"])
async def test_transport_errors_are_bounded_and_do_not_leak(
    remote, monkeypatch, failure
):
    original_client = httpx.AsyncClient

    def handle(request):
        if failure == "timeout":
            raise httpx.ReadTimeout("private error", request=request)
        if failure == "status":
            return httpx.Response(403, text="private error")
        if failure == "json":
            return httpx.Response(200, text="private error")
        if failure == "large":
            return httpx.Response(200, content=b"x" * 100)
        return httpx.Response(
            200,
            json={
                "jsonrpc": "2.0",
                "id": json.loads(request.content)["id"],
                "error": {"code": -32000, "message": "private error"},
            },
        )

    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(handle), **kwargs
        ),
    )
    with pytest.raises(RemoteToolError) as error:
        await remote.request("tools/list", {}, limit=20 if failure == "large" else 1000)
    assert "private error" not in str(error.value)


async def test_removed_tool_never_dispatches(remote, monkeypatch):
    async def unexpected(*args, **kwargs):
        pytest.fail("Removed tool was dispatched")

    monkeypatch.setattr(remote, "request", unexpected)
    with pytest.raises(RemoteToolError, match="unavailable"):
        await remote.call("removed", {}, call_identity="call")


async def test_concurrent_preparations_converge_on_persisted_continuation(
    remote, monkeypatch
):
    remote._catalog = (descriptor(),)
    prepared, executions = [], []
    barrier = asyncio.Event()

    async def request(method, params, **kwargs):
        if "requestState" in params:
            executions.append(params["requestState"])
            return {"content": []}
        state = f"state-{len(prepared)}"
        prepared.append(state)
        if len(prepared) == 2:
            barrier.set()
        await barrier.wait()
        return {"resultType": "input_required", "requestState": state}

    monkeypatch.setattr(remote, "request", request)
    await asyncio.gather(
        *(remote.call("example_read", {}, call_identity="call") for _ in range(2))
    )
    assert len(set(executions)) == 1
    with sqlite3.connect(remote.journal.path) as db:
        assert db.execute("select count(*) from calls").fetchone()[0] == 1


async def test_real_interaction_is_never_automatically_approved(remote, monkeypatch):
    remote._catalog = (descriptor(),)
    calls = []

    async def request(method, params, **kwargs):
        calls.append(params)
        return {
            "resultType": "input_required",
            "requestState": "signed-state",
            "inputRequests": [{"method": "elicitation/create"}],
        }

    monkeypatch.setattr(remote, "request", request)
    with pytest.raises(RemoteToolError, match="unsupported interaction"):
        await remote.call("example_read", {}, call_identity="call")
    assert len(calls) == 1
    assert remote.journal.begin("call", "example_read", {})[1] is None


async def test_oversized_arguments_are_rejected_before_journaling(remote):
    remote._catalog = (descriptor(),)
    with pytest.raises(RemoteToolError, match="size limit"):
        await remote.call(
            "example_read",
            {"body": "a" * module.MAX_MESSAGE_BYTES},
            call_identity="call",
        )
    with sqlite3.connect(remote.journal.path) as db:
        assert db.execute("select count(*) from calls").fetchone()[0] == 0


@pytest.mark.skipif(os.name == "nt", reason="POSIX file modes")
def test_existing_journal_permissions_are_tightened(remote):
    remote.journal.path.chmod(0o644)
    module.CallJournal(remote.journal.path, "scope")
    assert remote.journal.path.stat().st_mode & 0o777 == 0o600


def test_journal_supports_platform_without_posix_file_apis(tmp_path, monkeypatch):
    monkeypatch.delattr(module.os, "getuid", raising=False)
    monkeypatch.delattr(module.os, "fchmod", raising=False)
    journal = module.CallJournal(tmp_path / "portable.sqlite", "scope")
    assert journal.begin("call", "example", {})[1] is None


async def test_session_journals_are_independent_and_keep_identity_scope(
    remote, monkeypatch, tmp_path
):
    remote._catalog = (descriptor(),)
    observed = []

    async def request(method, params, **kwargs):
        observed.append(params.copy())
        if "requestState" not in params:
            return {
                "resultType": "input_required",
                "requestState": f"state-{len(observed)}",
            }
        return {"content": []}

    monkeypatch.setattr(remote, "request", request)
    original_journal = remote.journal
    paths = [tmp_path / "first.sqlite", tmp_path / "second.sqlite"]
    await asyncio.gather(
        *(
            remote.call(
                "example_read", {}, call_identity="native-call", journal_path=path
            )
            for path in paths
        )
    )
    assert remote.journal is original_journal
    states = [
        module.CallJournal(path, remote.journal.scope).begin(
            "native-call", "example_read", {}
        )[1]
        for path in paths
    ]
    assert len(set(states)) == 2
    assert (
        module.CallJournal(paths[0], "another-identity").begin(
            "native-call", "example_read", {}
        )[1]
        is None
    )
    await remote.call(
        "example_read", {}, call_identity="native-call", journal_path=paths[0]
    )
    assert observed[-1]["requestState"] == states[0]
    with sqlite3.connect(original_journal.path) as db:
        assert db.execute("select count(*) from calls").fetchone()[0] == 0

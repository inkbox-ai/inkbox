"""Tests for CallableDispatch + invoke_asgi_streaming."""

from __future__ import annotations


from inkbox.tunnels.client._dispatch import (
    CallableDispatch,
    DispatchRequest,
    DispatchResponseHead,
)


class _CapturingSink:
    def __init__(self) -> None:
        self.head: DispatchResponseHead | None = None
        self.body = bytearray()
        self.ended = False
        self.reset_reason: str | None = None

    async def send_head(self, head):
        self.head = head

    async def send_body(self, chunk):
        self.body.extend(chunk)

    async def end_body(self):
        self.ended = True

    async def reset(self, reason):
        self.reset_reason = reason


async def _empty_body():
    if False:
        yield b""


async def test_callable_dispatch_basic_get():
    async def app(scope, receive, send):
        assert scope["type"] == "http"
        assert scope["method"] == "GET"
        assert scope["path"] == "/x"
        await send({"type": "http.response.start", "status": 200, "headers": [
            (b"content-type", b"text/plain"),
        ]})
        await send({"type": "http.response.body", "body": b"hello-callable"})

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    sink = _CapturingSink()
    request = DispatchRequest(
        method="GET", path="/x",
        headers=[("host", "agent.test")],
        body=_empty_body(),
        forwarded_for_ip="1.2.3.4",
        sni_host=None,
    )
    await dispatch.dispatch(request, sink)
    assert sink.head is not None
    assert sink.head.status == 200
    assert sink.body == b"hello-callable"
    assert sink.ended


async def test_callable_dispatch_streams_body_to_handler():
    received_body = bytearray()

    async def app(scope, receive, send):
        more = True
        while more:
            event = await receive()
            received_body.extend(event.get("body") or b"")
            more = event.get("more_body", False)
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"ok"})

    async def body():
        yield b"hello-"
        yield b"world"

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    sink = _CapturingSink()
    request = DispatchRequest(
        method="POST", path="/e",
        headers=[("host", "agent.test")],
        body=body(),
    )
    await dispatch.dispatch(request, sink)
    assert received_body == b"hello-world"
    assert sink.head.status == 200
    assert sink.body == b"ok"


async def test_callable_dispatch_websocket_returns_501_for_phase3b():
    async def app(scope, receive, send):
        raise AssertionError("should not be invoked for ws")

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=1_000_000,
    )
    sink = _CapturingSink()
    request = DispatchRequest(
        method="GET", path="/ws",
        headers=[],
        body=_empty_body(),
        is_websocket=True,
    )
    await dispatch.dispatch(request, sink)
    assert sink.head is not None
    assert sink.head.status == 501


async def test_callable_dispatch_outbound_body_cap_resets():
    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"X" * 100})

    dispatch = CallableDispatch(
        app=app, public_host="agent.test", max_outbound_body_bytes=8,
    )
    sink = _CapturingSink()
    request = DispatchRequest(
        method="GET", path="/x", headers=[], body=_empty_body(),
    )
    await dispatch.dispatch(request, sink)
    assert sink.reset_reason == "response-too-large"

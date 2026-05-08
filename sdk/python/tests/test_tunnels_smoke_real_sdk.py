"""
tests/test_tunnels_smoke_real_sdk.py

End-to-end smoke against the real deployed Inkbox tunnel service, not
against a fake h2 server. Covers what the server's FakeAgent-only
integration suite cannot:

- real h2 handshake against the live data plane,
- HTTP round-trip through the public ingress,
- duplicate Set-Cookie response headers (locks down P2-A),
- handler stall posts 504 (locks down P1-B parity).

Gated behind ``INKBOX_TUNNEL_SMOKE_API_KEY`` so CI doesn't burn quota
accidentally. Run locally via:

    INKBOX_TUNNEL_SMOKE_API_KEY=ApiKey_... \\
        .venv/bin/python -m pytest tests/test_tunnels_smoke_real_sdk.py -v

Optional ``INKBOX_BASE_URL`` overrides the control-plane endpoint
(staging / dev). The tunnel name is randomized per run; the test
deletes the tunnel on teardown.
"""

from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest


_API_KEY = os.environ.get("INKBOX_TUNNEL_SMOKE_API_KEY")
_BASE_URL = os.environ.get("INKBOX_BASE_URL")

pytestmark = pytest.mark.skipif(
    not _API_KEY,
    reason="INKBOX_TUNNEL_SMOKE_API_KEY not set; skipping deployed-tunnel smoke",
)


class _SmokeHandler(BaseHTTPRequestHandler):
    """Tiny stdlib HTTP server with the routes the smoke needs."""

    def log_message(self, fmt: str, *args: object) -> None:  # noqa: D401
        # Suppress default access-log noise during the test run.
        return

    def _send_json(self, payload: dict[str, object], status: int = 200) -> None:
        import json
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802 (BaseHTTPRequestHandler API)
        if self.path.startswith("/cookies"):
            # Multi-Set-Cookie path — locks down P2-A.
            body = b"ok"
            self.send_response(200)
            self.send_header("content-type", "text/plain")
            self.send_header("set-cookie", "sid=abc; Path=/")
            self.send_header("set-cookie", "theme=dark; Path=/")
            self.send_header("content-length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path.startswith("/slow"):
            # Sleep past any reasonable response deadline so the SDK's
            # _with_deadline trips. Keep bounded so the smoke can't
            # wedge a CI runner if something goes wrong.
            time.sleep(60.0)
            self.send_response(200)
            self.send_header("content-length", "2")
            self.end_headers()
            self.wfile.write(b"ok")
            return
        self._send_json({"method": "GET", "path": self.path, "body": ""})


def _start_local_upstream() -> tuple[HTTPServer, int, threading.Thread]:
    server = HTTPServer(("127.0.0.1", 0), _SmokeHandler)
    port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server, port, thread


def _stop_local_upstream(
    server: HTTPServer, thread: threading.Thread,
) -> None:
    server.shutdown()
    server.server_close()
    thread.join(timeout=2.0)


def _wait_for_dns(host: str, *, timeout: float = 30.0) -> None:
    """Wait for the public host to resolve. New tunnel CNAMEs can take
    a few seconds before the public ingress sees the binding."""
    deadline = time.monotonic() + timeout
    last_err: Exception | None = None
    while time.monotonic() < deadline:
        try:
            socket.getaddrinfo(host, 443)
            return
        except OSError as e:
            last_err = e
            time.sleep(0.5)
    raise RuntimeError(f"public host {host} did not resolve: {last_err}")


@pytest.fixture(scope="module")
def deployed_tunnel():
    """Bring up a real tunnel against the deployed service for the
    duration of this module. Cleans up the tunnel on teardown."""
    from inkbox import Inkbox

    upstream_server, upstream_port, upstream_thread = _start_local_upstream()
    name = f"smoke-{uuid.uuid4().hex[:8]}"
    inkbox_kwargs: dict[str, object] = {"api_key": _API_KEY}
    if _BASE_URL:
        inkbox_kwargs["base_url"] = _BASE_URL
    with Inkbox(**inkbox_kwargs) as inkbox:
        listener = inkbox.tunnels.connect(
            name=name,
            forward_to=f"http://127.0.0.1:{upstream_port}",
            tls_mode="edge",
            print_secret_to_stderr=False,
        )
        # listener.wait() would block; the sync API runs the runtime in
        # a background thread already, so we just give it a moment to
        # park its intake pool before the first request.
        time.sleep(2.0)
        public_host = listener.public_url.removeprefix("https://")
        _wait_for_dns(public_host, timeout=30.0)
        try:
            yield {
                "public_url": listener.public_url,
                "tunnel_id": listener.tunnel.id,
            }
        finally:
            listener.close()
            try:
                inkbox.tunnels.delete(str(listener.tunnel.id))
            except Exception:
                # best-effort cleanup
                pass
            _stop_local_upstream(upstream_server, upstream_thread)


def test_http_get_round_trips(deployed_tunnel: dict[str, object]) -> None:
    public_url = deployed_tunnel["public_url"]
    resp = httpx.get(f"{public_url}/echo", timeout=20.0)
    assert resp.status_code == 200
    body = resp.json()
    assert body["method"] == "GET"
    assert body["path"].startswith("/echo")


def test_duplicate_set_cookie_headers_round_trip(
    deployed_tunnel: dict[str, object],
) -> None:
    """P2-A regression: response with two Set-Cookie headers must reach
    the public caller as two distinct values, not collapsed."""
    public_url = deployed_tunnel["public_url"]
    resp = httpx.get(f"{public_url}/cookies", timeout=20.0)
    assert resp.status_code == 200
    cookies = resp.headers.get_list("set-cookie")
    assert len(cookies) == 2, f"expected 2 set-cookies, got {cookies!r}"
    assert any(c.startswith("sid=abc") for c in cookies)
    assert any(c.startswith("theme=dark") for c in cookies)


def test_slow_handler_eventually_504s(
    deployed_tunnel: dict[str, object],
) -> None:
    """P1-B parity regression: a stalled upstream must produce a 5xx in
    bounded time, not hang. The exact origin of the 504 (SDK
    response-deadline-exceeded vs. server-side wait_reply timeout) is
    deployment-specific — we just assert correctness of the bound."""
    public_url = deployed_tunnel["public_url"]
    t0 = time.monotonic()
    resp = httpx.get(f"{public_url}/slow", timeout=90.0)
    elapsed = time.monotonic() - t0
    assert resp.status_code >= 500
    assert elapsed < 60.0

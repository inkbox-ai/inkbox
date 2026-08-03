"""Live tunnel-runtime coverage for the installed Python SDK."""

from __future__ import annotations

import os
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from uuid import uuid4

import httpx
import pytest
from conftest import SdkIntegrationContext
from inkbox import Inkbox


pytestmark = [
    pytest.mark.sdk_integration,
    pytest.mark.skipif(
        os.environ.get("SDK_INTEGRATION_TUNNEL_SMOKE") != "1",
        reason="live tunnel smoke is not enabled for this target",
    ),
]


class _CookieHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args: object) -> None:  # noqa: D401
        return

    def do_GET(self) -> None:  # noqa: N802
        body = b"ok"
        self.send_response(200)
        self.send_header("content-type", "text/plain")
        self.send_header("set-cookie", "sid=abc; Path=/")
        self.send_header("set-cookie", "theme=dark; Path=/")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def test_duplicate_response_headers_cross_live_tunnel(
    sdk_context: SdkIntegrationContext,
) -> None:
    """Distinct response cookies survive the complete deployed tunnel path."""
    cfg = sdk_context.config
    name = f"py-cookie-{uuid4().hex[:8]}"
    upstream = HTTPServer(("127.0.0.1", 0), _CookieHandler)
    upstream_port = upstream.server_address[1]
    upstream_thread = threading.Thread(target=upstream.serve_forever, daemon=True)
    upstream_thread.start()

    with Inkbox(
        api_key=sdk_context.bootstrap.api_key,
        base_url=cfg.base_url,
        timeout=cfg.http_timeout,
    ) as inkbox:
        listener = None
        listener_thread = None
        listener_errors: list[BaseException] = []
        identity_created = False
        try:
            inkbox.create_identity(name)
            identity_created = True
            listener = inkbox.tunnels.connect(
                name=name,
                forward_to=f"http://127.0.0.1:{upstream_port}",
            )

            def run_listener() -> None:
                try:
                    listener.wait()
                except BaseException as exc:
                    listener_errors.append(exc)

            listener_thread = threading.Thread(target=run_listener, daemon=True)
            listener_thread.start()

            deadline = time.monotonic() + 15.0
            while time.monotonic() < deadline:
                if listener_errors:
                    raise listener_errors[0]
                if inkbox.tunnels.get(listener.tunnel.id).currently_connected:
                    break
                time.sleep(0.1)
            else:
                raise RuntimeError("tunnel listener did not become connected")

            response = httpx.get(f"{listener.public_url}/cookies", timeout=20.0)
            response.raise_for_status()
            assert response.headers.get_list("set-cookie") == [
                "sid=abc; Path=/",
                "theme=dark; Path=/",
            ]
        finally:
            if listener is not None:
                listener.close()
            if listener_thread is not None:
                listener_thread.join(timeout=5.0)
            if identity_created:
                try:
                    inkbox.get_identity(name).delete()
                except Exception:
                    pass
            upstream.shutdown()
            upstream.server_close()
            upstream_thread.join(timeout=2.0)

        if listener_thread is not None and listener_thread.is_alive():
            raise RuntimeError("tunnel listener did not stop")
        if listener_errors:
            raise listener_errors[0]

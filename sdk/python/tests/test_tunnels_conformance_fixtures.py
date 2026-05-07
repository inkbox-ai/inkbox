"""Cross-language conformance fixtures.

Same JSON fixtures are consumed by the TS SDK in
``tests/tunnels/conformance_fixtures.test.ts``. Both SDKs must produce
the same parsed shape from the same wire input.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path

import h2.config
import h2.connection
import pytest

from inkbox.tunnels.client._dispatch import (
    DispatchRequest,
    DispatchResponseHead,
    DispatchResponseSink,
)
from inkbox.tunnels.client._h1_server import InProcH1ParserPlaintext
from inkbox.tunnels.client._h2_transcode import H2TranscoderPlaintext


REPO_ROOT = Path(__file__).resolve().parents[3]
FIXTURES_DIR = REPO_ROOT / "tests" / "fixtures"


def _load_fixture(rel_path: str) -> dict:
    with open(FIXTURES_DIR / rel_path) as f:
        return json.load(f)


class _CapturingDispatch:
    """Captures the DispatchRequest the parser/transcoder produces."""

    def __init__(self) -> None:
        self.captured: DispatchRequest | None = None
        self.body = bytearray()

    async def dispatch(
        self, request: DispatchRequest, response: DispatchResponseSink,
    ) -> None:
        self.captured = request
        async for chunk in request.body:
            self.body.extend(chunk)
        await response.send_head(
            DispatchResponseHead(status=200, headers=[]),
        )
        await response.end_body()

    async def aclose(self) -> None:
        pass


@pytest.mark.parametrize("fixture_path", [
    "h1_envelope_reference/basic_get.json",
    "h1_envelope_reference/post_with_chunked_body.json",
])
async def test_h1_envelope_fixture(fixture_path: str):
    fixture = _load_fixture(fixture_path)
    raw = fixture["input_raw_h1"].encode("ascii")
    expected = fixture["expected_dispatch_request"]

    dispatch = _CapturingDispatch()
    parser = InProcH1ParserPlaintext(
        dispatch=dispatch,
        max_inbound_body_bytes=1_000_000,
        forwarded_for_ip=None,
        sni_host=None,
    )

    out = bytearray()
    pump = asyncio.create_task(
        parser.pump_outbound(lambda c: _async_extend(out, c)),
    )
    await parser.feed(raw)
    # Let the dispatcher run and consume the body.
    for _ in range(50):
        if dispatch.captured is not None:
            break
        await asyncio.sleep(0.01)
    await asyncio.sleep(0.05)
    await parser.aclose()
    try:
        await asyncio.wait_for(pump, timeout=2.0)
    except asyncio.TimeoutError:
        pump.cancel()

    assert dispatch.captured is not None
    captured = dispatch.captured
    assert captured.method == expected["method"]
    assert captured.path == expected["path"]
    assert captured.is_websocket == expected["is_websocket"]
    # Headers should match (after lower-casing). The fixture's headers
    # are the canonical lower-cased order; the parser preserves order
    # but lowers names.
    actual_headers = [(k.lower(), v) for k, v in captured.headers]
    assert actual_headers == [
        (k, v) for k, v in expected["headers"]
    ]
    if "body_bytes_b64" in expected:
        expected_body = base64.b64decode(expected["body_bytes_b64"])
        assert bytes(dispatch.body) == expected_body


async def _async_extend(buf: bytearray, chunk: bytes) -> None:
    buf.extend(chunk)


async def test_h2_transcode_fixture_basic_get():
    fixture = _load_fixture("h2_transcode_reference/basic_get.json")
    pseudo = fixture["input_h2_pseudo_headers"]
    regular = fixture["input_h2_regular_headers"]
    expected = fixture["expected_dispatch_request"]

    dispatch = _CapturingDispatch()
    transcoder = H2TranscoderPlaintext(
        dispatch=dispatch, max_inbound_body_bytes=1_000_000,
    )
    out = bytearray()
    pump = asyncio.create_task(
        transcoder.pump_outbound(lambda c: _async_extend(out, c)),
    )
    await asyncio.sleep(0)

    client = h2.connection.H2Connection(
        config=h2.config.H2Configuration(
            client_side=True, header_encoding="utf-8",
        ),
    )
    client.initiate_connection()
    await transcoder.feed(client.data_to_send())
    await asyncio.sleep(0.05)
    if out:
        client.receive_data(bytes(out))
        out.clear()
    await transcoder.feed(client.data_to_send())
    await asyncio.sleep(0.05)
    if out:
        client.receive_data(bytes(out))
        out.clear()

    headers = [tuple(h) for h in pseudo + regular]
    sid = client.get_next_available_stream_id()
    client.send_headers(sid, headers, end_stream=True)
    await transcoder.feed(client.data_to_send())

    for _ in range(50):
        if dispatch.captured is not None:
            break
        await asyncio.sleep(0.02)
    await asyncio.sleep(0.05)

    await transcoder.aclose()
    try:
        await asyncio.wait_for(pump, timeout=2.0)
    except asyncio.TimeoutError:
        pump.cancel()

    assert dispatch.captured is not None
    captured = dispatch.captured
    assert captured.method == expected["method"]
    assert captured.path == expected["path"]
    assert captured.transport == expected["transport"]
    actual = {(k, v) for k, v in captured.headers}
    for k, v in expected["headers_must_contain"]:
        assert (k, v) in actual, f"missing header {(k, v)}"


# Also expose the fixtures directory path for the TS test to share, via
# a sentinel test that ensures the path is stable.
def test_fixtures_directory_exists():
    assert FIXTURES_DIR.is_dir()
    assert (FIXTURES_DIR / "h1_envelope_reference" / "basic_get.json").is_file()


_ = os  # keep `import os` non-warning for ruff

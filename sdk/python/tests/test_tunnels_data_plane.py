"""Tests for the data-plane data-only modules (envelope, validation, state)."""

from __future__ import annotations

import os
import stat as _stat
from pathlib import Path

import pytest

from inkbox.tunnels.client._envelope import parse_envelope
from inkbox.tunnels.client._state import (
    StateEntry,
    ensure_private_state_dir,
    load_state,
    save_state,
    write_private_file,
)
from inkbox.tunnels.client._url_forward import (
    ForwardTargetRefused,
    join_forward_path,
    validate_envelope_path,
    validate_forward_target,
)
from inkbox.tunnels.client._wsframe import (
    WS_OPCODE_BINARY,
    WS_OPCODE_TEXT,
    decode_ws_frames,
    encode_ws_frame,
)


# --- Envelope parsing ----------------------------------------------------


def test_parse_envelope_basic():
    headers = [
        ("inkbox-request-id", "req-1"),
        ("inkbox-method", "POST"),
        ("inkbox-path", "/webhook?x=1"),
        ("inkbox-route-kind", "webhook"),
        ("inkbox-h-content-type", "application/json"),
        ("inkbox-forwarded-for", "1.2.3.4"),
    ]
    env = parse_envelope(headers, b'{"hello":1}')
    assert env is not None
    assert env.request_id == "req-1"
    assert env.method == "POST"
    assert env.path == "/webhook?x=1"
    assert env.route_kind == "webhook"
    assert env.forwarded_headers == [("content-type", "application/json")]
    assert env.forwarded_for_ip == "1.2.3.4"
    assert env.body == b'{"hello":1}'
    assert env.body_uri is None


def test_parse_envelope_with_body_uri():
    headers = [
        ("inkbox-request-id", "req-2"),
        ("inkbox-method", "POST"),
        ("inkbox-path", "/upload"),
        ("inkbox-route-kind", "webhook"),
        ("inkbox-body-uri", "https://body.example/bigblob?token=xyz"),
    ]
    env = parse_envelope(headers, b"")
    assert env is not None
    assert env.body_uri == "https://body.example/bigblob?token=xyz"
    assert env.body == b""


def test_parse_envelope_missing_request_id_returns_none():
    env = parse_envelope([("inkbox-method", "GET")], b"")
    assert env is None


# --- Path validation -----------------------------------------------------


@pytest.mark.parametrize("path,reason", [
    ("/foo/../bar", "invalid-path"),
    ("/foo/./bar", "invalid-path"),
    ("/foo/%2e%2e/bar", "invalid-path"),
    ("/foo/%2E%2E/bar", "invalid-path"),
    ("/foo/%252e%252e/bar", "invalid-path"),  # double-encoded
    ("/foo/%2f/bar", "invalid-path"),  # encoded slash
    ("/foo/%5cbar", "invalid-path"),  # encoded backslash
    # Raw backslash: some upstream frameworks (IIS, Tomcat, a few Node
    # static-file libs) treat `\` as a path separator. Accepting it
    # would let `/static\..\secret` slip past the split-on-/ check.
    ("/foo\\..\\bar", "invalid-path"),
    ("/static\\secret", "invalid-path"),
    ("/\\evil", "invalid-path"),
])
def test_path_validation_rejects_traversal(path: str, reason: str):
    assert validate_envelope_path(path) == reason


@pytest.mark.parametrize("path", [
    "/webhook",
    "/api/v1/users",
    "/path/with%20space",
    "/with-query?x=1&y=2",
])
def test_path_validation_accepts_legitimate_paths(path: str):
    assert validate_envelope_path(path) is None


# --- Forward target validation -------------------------------------------


@pytest.mark.parametrize("target", [
    "http://localhost:8080",
    "http://127.0.0.1:8080",
    "http://127.0.0.5:9000",
    "http://[::1]:8080",
])
def test_forward_target_accepts_loopback(target: str):
    validate_forward_target(target, allow_remote_forwarding=False)


@pytest.mark.parametrize("target", [
    "http://example.com",
    "http://10.0.0.5",
    "http://192.168.1.1",
    "http://internal.example.com",
    "http://1.2.3.4",
])
def test_forward_target_refuses_non_loopback(target: str):
    with pytest.raises(ForwardTargetRefused):
        validate_forward_target(target, allow_remote_forwarding=False)


def test_forward_target_allow_remote_bypass():
    validate_forward_target(
        "http://example.com", allow_remote_forwarding=True,
    )


def test_forward_target_rejects_bad_scheme():
    with pytest.raises(ForwardTargetRefused):
        validate_forward_target("ftp://localhost", allow_remote_forwarding=False)


# --- Path joining ---------------------------------------------------------


def test_join_forward_path_simple():
    assert (
        join_forward_path("http://localhost:8080", "/webhook?x=1")
        == "http://localhost:8080/webhook?x=1"
    )


def test_join_forward_path_with_base():
    assert (
        join_forward_path("http://localhost:8080/base", "/webhook?x=1")
        == "http://localhost:8080/base/webhook?x=1"
    )


def test_join_forward_path_strips_trailing_slash_on_base():
    assert (
        join_forward_path("http://localhost:8080/base/", "/webhook")
        == "http://localhost:8080/base/webhook"
    )


# --- WS framing -----------------------------------------------------------


def test_ws_frame_roundtrip_binary():
    wire = encode_ws_frame(WS_OPCODE_BINARY, b"hello world", mask=False)
    buf = bytearray(wire)
    frames = decode_ws_frames(buf)
    assert len(frames) == 1
    op, payload, fin = frames[0]
    assert op == WS_OPCODE_BINARY
    assert payload == b"hello world"
    assert fin is True


def test_ws_frame_roundtrip_text():
    wire = encode_ws_frame(WS_OPCODE_TEXT, b"hi", mask=False)
    buf = bytearray(wire)
    frames = decode_ws_frames(buf)
    assert frames[0][0] == WS_OPCODE_TEXT
    assert frames[0][1] == b"hi"


def test_ws_frame_partial_buffer_keeps_remainder():
    wire = encode_ws_frame(WS_OPCODE_BINARY, b"abcdef", mask=False)
    buf = bytearray(wire[:3])  # incomplete
    frames = decode_ws_frames(buf)
    assert frames == []
    buf.extend(wire[3:])
    frames = decode_ws_frames(buf)
    assert len(frames) == 1


def test_ws_frame_masked_decodes_correctly():
    wire = encode_ws_frame(WS_OPCODE_BINARY, b"secret", mask=True)
    buf = bytearray(wire)
    frames = decode_ws_frames(buf)
    assert frames[0][1] == b"secret"


def test_ws_frame_preserves_fin_false_for_fragmentation():
    """encode_ws_frame must honor ``fin=False`` so a multi-frame TEXT or
    BINARY message can be re-encoded as fragments instead of being
    silently coalesced into a single FIN=1 frame on the bridge."""
    part1 = encode_ws_frame(
        WS_OPCODE_TEXT, b"ab", mask=False, fin=False,
    )
    part2 = encode_ws_frame(0x0, b"cd", mask=False, fin=True)
    buf = bytearray(part1 + part2)
    frames = decode_ws_frames(buf)
    assert len(frames) == 2
    assert frames[0] == (WS_OPCODE_TEXT, b"ab", False)
    assert frames[1] == (0x0, b"cd", True)


# --- State persistence ---------------------------------------------------


def test_save_and_load_state_roundtrip(tmp_path: Path):
    entry = StateEntry(
        tunnel_id="11111111-1111-1111-1111-111111111111",
        name="my-agent",
        mode="edge",
        zone="inkboxwire.com",
        public_host="my-agent.inkboxwire.com",
    )
    state_dir = tmp_path / "tunnel"
    save_state(state_dir, entry)
    loaded = load_state(state_dir)
    assert loaded == entry


def test_state_file_is_chmod_0600(tmp_path: Path):
    entry = StateEntry(
        tunnel_id="abc", name="my-agent",
        mode="edge", zone=None, public_host=None,
    )
    state_dir = tmp_path / "tunnel"
    save_state(state_dir, entry)
    save_state(state_dir, entry)  # second write
    state_path = state_dir / "state.json"
    mode = _stat.S_IMODE(state_path.stat().st_mode)
    assert mode == 0o600


def test_state_dir_mode_0700(tmp_path: Path):
    state_dir = tmp_path / "tunnel"
    ensure_private_state_dir(state_dir)
    mode = _stat.S_IMODE(state_dir.stat().st_mode)
    assert mode == 0o700


def test_load_state_returns_none_for_missing(tmp_path: Path):
    assert load_state(tmp_path / "missing") is None


def test_load_state_returns_none_for_corrupt(tmp_path: Path):
    state_dir = tmp_path / "tunnel"
    state_dir.mkdir()
    (state_dir / "state.json").write_text("not json{{{")
    assert load_state(state_dir) is None


def test_symlinked_state_dir_is_refused(tmp_path: Path):
    real = tmp_path / "real"
    real.mkdir()
    link = tmp_path / "link"
    os.symlink(real, link)
    from inkbox.tunnels.client._state import TunnelStateError
    with pytest.raises(TunnelStateError):
        ensure_private_state_dir(link)


def test_write_private_file_creates_with_0600(tmp_path: Path):
    target = tmp_path / "private.pem"
    write_private_file(target, b"secret bytes")
    mode = _stat.S_IMODE(target.stat().st_mode)
    assert mode == 0o600
    assert target.read_bytes() == b"secret bytes"


# --- Pool size validation ------------------------------------------------


def test_pool_size_validation():
    from inkbox.tunnels.client._bootstrap import validate_pool_size

    validate_pool_size(None)
    validate_pool_size(1)
    validate_pool_size(32)
    with pytest.raises(ValueError):
        validate_pool_size(0)
    with pytest.raises(ValueError):
        validate_pool_size(-1)
    with pytest.raises(ValueError):
        validate_pool_size(33)

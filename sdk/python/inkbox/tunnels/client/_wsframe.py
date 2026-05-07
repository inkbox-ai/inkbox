"""
inkbox/tunnels/client/_wsframe.py

RFC 6455 WebSocket frame codec. Used by the WS upgrade bridge and the
passthrough TCP bridge (which tunnels raw bytes inside WS BINARY frames
on an extended-CONNECT stream).

Pure-Python; no I/O; no h2 imports.
"""

from __future__ import annotations

import base64
import json
import os
import struct
from typing import Any

WS_OPCODE_TEXT = 0x1
WS_OPCODE_BINARY = 0x2
WS_OPCODE_CLOSE = 0x8
WS_OPCODE_PING = 0x9
WS_OPCODE_PONG = 0xA


def decode_ws_frames(buf: bytearray) -> list[tuple[int, bytes, bool]]:
    """Drain as many complete WS frames as possible from ``buf``.

    Mutates ``buf`` in place; trailing partial frames stay for the next
    call. Returns ``(opcode, payload, fin)`` tuples in arrival order.
    """
    frames: list[tuple[int, bytes, bool]] = []
    while True:
        if len(buf) < 2:
            return frames
        b0 = buf[0]
        b1 = buf[1]
        fin = bool(b0 & 0x80)
        opcode = b0 & 0x0F
        masked = bool(b1 & 0x80)
        plen = b1 & 0x7F
        offset = 2
        if plen == 126:
            if len(buf) < 4:
                return frames
            plen = int.from_bytes(bytes(buf[2:4]), "big")
            offset = 4
        elif plen == 127:
            if len(buf) < 10:
                return frames
            plen = int.from_bytes(bytes(buf[2:10]), "big")
            offset = 10
        mask_key = b""
        if masked:
            if len(buf) < offset + 4:
                return frames
            mask_key = bytes(buf[offset:offset + 4])
            offset += 4
        if len(buf) < offset + plen:
            return frames
        payload = bytes(buf[offset:offset + plen])
        if masked and mask_key:
            payload = bytes(p ^ mask_key[i % 4] for i, p in enumerate(payload))
        del buf[:offset + plen]
        frames.append((opcode, payload, fin))


def encode_ws_frame(
    opcode: int, payload: bytes, *, mask: bool = True, fin: bool = True,
) -> bytes:
    """Encode a single WS frame.

    ``mask=True`` is required for client→server frames per RFC 6455.
    ``fin=False`` produces a fragment frame (continuation expected); the
    URL passthrough bridge needs this so multi-frame messages from the
    third party are not silently coalesced.
    """
    out = bytearray()
    fin_bit = 0x80 if fin else 0x00
    out.append(fin_bit | (opcode & 0x0F))
    plen = len(payload)
    mask_bit = 0x80 if mask else 0x00
    if plen < 126:
        out.append(mask_bit | plen)
    elif plen < 65536:
        out.append(mask_bit | 126)
        out += plen.to_bytes(2, "big")
    else:
        out.append(mask_bit | 127)
        out += plen.to_bytes(8, "big")
    if mask:
        mask_key = os.urandom(4)
        out += mask_key
        out += bytes(p ^ mask_key[i % 4] for i, p in enumerate(payload))
    else:
        out += payload
    return bytes(out)


def encode_ws_envelope(msg: dict[str, Any]) -> bytes:
    """Encode an outbound websocket message as the wire envelope (length-prefixed JSON).

    Binary payloads are base64-encoded to match the server-side bridge
    wire contract (the server base64-decodes the ``data`` field).
    """
    if msg["type"] == "websocket.send":
        if msg.get("text") is not None:
            wire = {"type": "text", "data": msg["text"]}
        elif msg.get("bytes") is not None:
            wire = {
                "type": "binary",
                "data": base64.b64encode(msg["bytes"]).decode("ascii"),
            }
        else:
            wire = {"type": "text", "data": ""}
    elif msg["type"] == "websocket.close":
        wire = {
            "type": "close",
            "code": msg.get("code", 1000),
            "reason": msg.get("reason", "") or "",
        }
    else:
        wire = {"type": "text", "data": ""}
    payload = json.dumps(wire, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(payload)) + payload

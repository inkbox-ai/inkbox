"""
inkbox.phone.realtime — observe + intervene frames for platform-hosted calls.

These ride the one existing per-call WebSocket (the same connection the
platform opens to your app): decode inbound frames with :func:`parse_event`,
and build the outbound intervene frames with the helpers in
:mod:`inkbox.phone.realtime.intervene`.
"""

from inkbox.phone.realtime.events import (
    BargeIn,
    CallAnswered,
    CallEnded,
    CallStarted,
    ConsultRequested,
    PostCallAction,
    RealtimeEvent,
    Transcript,
    TranscriptTurn,
    UnknownEvent,
    parse_event,
)
from inkbox.phone.realtime.intervene import (
    consult_answer,
    hang_up,
    inject_context,
    say,
    update_instructions,
)

__all__ = [
    # observe
    "RealtimeEvent",
    "CallStarted",
    "CallAnswered",
    "Transcript",
    "BargeIn",
    "ConsultRequested",
    "CallEnded",
    "UnknownEvent",
    "TranscriptTurn",
    "PostCallAction",
    "parse_event",
    # intervene
    "consult_answer",
    "say",
    "inject_context",
    "update_instructions",
    "hang_up",
]

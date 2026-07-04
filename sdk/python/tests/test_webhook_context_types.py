"""
tests/test_webhook_context_types.py

Runtime round-trip of the conversation-context wire shapes
(``data.context``) added to received-event payloads. Optional keys are
absent (not null), and the asserts below check key presence/absence
accordingly.
"""

from __future__ import annotations

import json
from typing import cast

from inkbox import (
    MailWebhookPayload,
    WebhookContextBlockWire,
    WebhookContextWire,
)


def _message_received_with_context() -> dict:
    return {
        "id": "evt_abc123",
        "event_type": "message.received",
        "timestamp": "2026-07-04T00:00:00Z",
        "data": {
            "message": {
                "id": "m1",
                "mailbox_id": "mb1",
                "thread_id": "t1",
                "message_id": "<x@e>",
                "from_address": "a@b.c",
                "to_addresses": ["d@e.f"],
                "cc_addresses": None,
                "bcc_addresses": None,
                "subject": "hi",
                "snippet": "yo",
                "direction": "inbound",
                "status": "received",
                "has_attachments": False,
                "created_at": "2026-07-04T00:00:00Z",
            },
            "contacts": [],
            "agent_identities": [],
            "context": {
                "email": {
                    "scope": "thread",
                    "mode": "count",
                    "requested": 2,
                    "truncated": False,
                    "items": [
                        {
                            "id": "e1",
                            "direction": "inbound",
                            "from_address": "a@b.c",
                            "to_addresses": ["d@e.f"],
                            "created_at": "2026-07-01T00:00:00Z",
                        },
                        {
                            "id": "e2",
                            "direction": "outbound",
                            "from_address": "d@e.f",
                            "to_addresses": ["a@b.c"],
                            "subject": "re",
                            "snippet": "sn",
                            "created_at": "2026-07-02T00:00:00Z",
                        },
                    ],
                },
                "texts": {
                    "scope": "contact",
                    "mode": "window",
                    "hours": 24,
                    "truncated": False,
                    "items": [
                        {
                            "id": "x1",
                            "channel": "sms",
                            "direction": "inbound",
                            "text": "hello",
                            "text_truncated": False,
                            "created_at": "2026-07-03T00:00:00Z",
                        },
                    ],
                },
                "calls": {
                    "scope": "contact",
                    "mode": "count",
                    "requested": 1,
                    "truncated": False,
                    "items": [
                        {
                            "call_id": "c1",
                            "abridged": True,
                            "transcript": [
                                {"party": "caller", "text": "hi", "ts_ms": 0},
                                {"marker": "abridged", "omitted_turns": 3, "omitted_ms": 5000},
                                {"party": "agent", "text": "bye", "ts_ms": 9000, "truncated": True},
                            ],
                        },
                    ],
                },
            },
        },
    }


def test_full_context_round_trips_all_three_classes():
    payload = cast(
        MailWebhookPayload, json.loads(json.dumps(_message_received_with_context()))
    )
    ctx: WebhookContextWire = payload["data"]["context"]
    assert set(ctx.keys()) == {"email", "texts", "calls"}
    assert ctx["email"]["mode"] == "count"
    assert ctx["email"]["requested"] == 2
    assert ctx["email"]["items"][0]["from_address"] == "a@b.c"
    # An item without subject/snippet simply omits the keys.
    assert "subject" not in ctx["email"]["items"][0]
    assert ctx["email"]["items"][1]["subject"] == "re"
    assert ctx["texts"]["items"][0]["channel"] == "sms"
    # window block carries hours, not requested.
    assert ctx["texts"]["hours"] == 24
    assert "requested" not in ctx["texts"]


def test_skipped_class_ships_empty_items_and_reason():
    raw = _message_received_with_context()
    raw["data"]["context"] = {
        "texts": {
            "scope": "contact",
            "items": [],
            "truncated": False,
            "skipped": "no_contact",
        },
    }
    payload = cast(MailWebhookPayload, raw)
    block: WebhookContextBlockWire = payload["data"]["context"]["texts"]
    assert block["items"] == []
    assert block["skipped"] == "no_contact"
    assert "mode" not in block


def test_transcript_marker_discriminates_on_marker_key():
    payload = cast(MailWebhookPayload, _message_received_with_context())
    transcript = payload["data"]["context"]["calls"]["items"][0]["transcript"]
    turns = [e for e in transcript if "marker" not in e]
    markers = [e for e in transcript if "marker" in e]
    assert len(turns) == 2
    assert len(markers) == 1
    assert markers[0]["omitted_turns"] == 3
    assert turns[1]["truncated"] is True


def test_payload_without_context_key():
    raw = _message_received_with_context()
    del raw["data"]["context"]
    payload = cast(MailWebhookPayload, raw)
    assert "context" not in payload["data"]

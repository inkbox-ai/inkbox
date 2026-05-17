"""
tests/test_webhook_types.py

Parse the canonical server example payloads (copied verbatim from
``~/servers/src/apps/api_server/webhook_specs_router.py``) and exercise
the wire-shape ``TypedDict``s in ``inkbox/webhooks.py``.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import cast

import pytest

from inkbox import (
    MailWebhookPayload,
    PhoneIncomingCallWebhookPayload,
    TextWebhookPayload,
    WebhookContact,
)

# Repo layout: sdk/python/tests/test_webhook_types.py -> sdk/python/tests
#                                                    -> sdk/python
#                                                    -> sdk
#                                                    -> repo root
# So fixtures live three levels up.
FIXTURES_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "webhook_payloads"

# Drift-loud canonical event set. Adding a new server event without
# copying the fixture (or vice versa) fails the inventory test below.
EXPECTED_FIXTURES = sorted([
    "message_received.json",
    "message_sent.json",
    "message_forwarded.json",
    "message_delivered.json",
    "message_bounced.json",
    "message_failed.json",
    "text_received.json",
    "text_sent.json",
    "text_delivered.json",
    "text_delivery_failed.json",
    "text_delivery_unconfirmed.json",
    "phone_incoming_call.json",
])

MAIL_FIXTURES = [
    "message_received.json",
    "message_sent.json",
    "message_forwarded.json",
    "message_delivered.json",
    "message_bounced.json",
    "message_failed.json",
]

TEXT_FIXTURES = [
    "text_received.json",
    "text_sent.json",
    "text_delivered.json",
    "text_delivery_failed.json",
    "text_delivery_unconfirmed.json",
]


def _load(name: str) -> dict:
    with (FIXTURES_DIR / name).open("rb") as fh:
        return json.load(fh)


# ---- Inventory (drift-loud) ____________________________________________

def test_fixture_inventory_matches_canonical_event_set():
    present = sorted(p.name for p in FIXTURES_DIR.glob("*.json"))
    assert present == EXPECTED_FIXTURES


# ---- Mail ______________________________________________________________

@pytest.mark.parametrize("fixture", MAIL_FIXTURES)
def test_mail_payload_parses(fixture: str):
    payload = cast(MailWebhookPayload, _load(fixture))
    assert payload["event_type"].startswith("message.")
    assert isinstance(payload["timestamp"], str)
    message = payload["data"]["message"]
    assert isinstance(message["id"], str)
    assert isinstance(message["mailbox_id"], str)
    assert message["direction"] in ("inbound", "outbound")


def test_mail_contact_discriminates_null_vs_object():
    received = cast(MailWebhookPayload, _load("message_received.json"))
    contact = received["data"]["contact"]
    assert contact is not None
    matched: WebhookContact = contact
    assert isinstance(matched["id"], str)
    assert isinstance(matched["name"], str)

    sent = cast(MailWebhookPayload, _load("message_sent.json"))
    assert sent["data"]["contact"] is None


def test_mail_required_fields_present_on_every_event():
    required = {
        "id", "mailbox_id", "thread_id", "message_id",
        "from_address", "to_addresses", "cc_addresses",
        "subject", "snippet", "direction", "status",
        "has_attachments", "created_at",
    }
    for fixture in MAIL_FIXTURES:
        payload = cast(MailWebhookPayload, _load(fixture))
        assert set(payload["data"]["message"].keys()) == required, fixture


# ---- Text ______________________________________________________________

@pytest.mark.parametrize("fixture", TEXT_FIXTURES)
def test_text_payload_parses(fixture: str):
    payload = cast(TextWebhookPayload, _load(fixture))
    assert payload["event_type"].startswith("text.")
    text = payload["data"]["text_message"]
    assert isinstance(text["id"], str)
    assert text["origin"] == "user_initiated"


def test_text_delivery_failed_carries_full_lifecycle_block():
    payload = cast(TextWebhookPayload, _load("text_delivery_failed.json"))
    text = payload["data"]["text_message"]
    assert text["delivery_status"] == "delivery_failed"
    assert text["error_code"] == "30007"
    assert text["error_detail"] == "Message filtered by carrier"
    assert isinstance(text["sent_at"], str)
    assert isinstance(text["failed_at"], str)
    assert text["delivered_at"] is None


def test_text_received_has_no_lifecycle_timestamps():
    payload = cast(TextWebhookPayload, _load("text_received.json"))
    text = payload["data"]["text_message"]
    assert text["delivery_status"] is None
    assert text["sent_at"] is None
    assert text["delivered_at"] is None
    assert text["failed_at"] is None
    assert payload["data"]["contact"] is not None


def test_text_required_fields_present_on_every_event():
    required = {
        "id", "direction", "local_phone_number", "remote_phone_number",
        "text", "type", "media", "is_read",
        "delivery_status", "origin", "error_code", "error_detail",
        "sent_at", "delivered_at", "failed_at",
        "created_at", "updated_at",
    }
    for fixture in TEXT_FIXTURES:
        payload = cast(TextWebhookPayload, _load(fixture))
        assert set(payload["data"]["text_message"].keys()) == required, fixture


@pytest.mark.parametrize("fixture", TEXT_FIXTURES)
def test_text_omits_is_blocked(fixture: str):
    payload = cast(TextWebhookPayload, _load(fixture))
    assert "is_blocked" not in payload["data"]["text_message"]


# ---- Inbound call ______________________________________________________

def test_phone_incoming_call_payload_is_flat():
    payload = cast(
        PhoneIncomingCallWebhookPayload, _load("phone_incoming_call.json"),
    )
    # No envelope - event_type/timestamp/data don't exist on this payload.
    assert "event_type" not in payload
    assert "data" not in payload
    assert payload["direction"] == "inbound"
    assert payload["status"] == "initiated"
    assert payload["contact"] is None


def test_phone_incoming_call_omits_is_blocked():
    payload = _load("phone_incoming_call.json")
    assert "is_blocked" not in payload


def test_phone_incoming_call_rate_limit_is_snake_case_wire_shape():
    payload = cast(
        PhoneIncomingCallWebhookPayload, _load("phone_incoming_call.json"),
    )
    rate_limit = payload["rate_limit"]
    assert rate_limit is not None
    assert rate_limit["calls_used"] == 4
    assert rate_limit["minutes_remaining"] == 287.5

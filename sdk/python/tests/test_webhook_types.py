"""
tests/test_webhook_types.py

Parse the canonical webhook example payloads and exercise the
wire-shape ``TypedDict``s in ``inkbox/webhooks.py``. Runtime
key-presence assertions only; missing-key drift is caught by the
per-field assertions below, not by the Python type system (mypy is
not configured for this package).
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
    WebhookMailAgentIdentity,
    WebhookMailContact,
)

# Repo layout: sdk/python/tests/test_webhook_types.py -> sdk/python/tests
#                                                    -> sdk/python
#                                                    -> sdk
#                                                    -> repo root
# So fixtures live three levels up.
FIXTURES_DIR = Path(__file__).resolve().parents[3] / "tests" / "fixtures" / "webhook_payloads"

# Drift-loud canonical event set. Adding a new fixture without listing
# it here (or vice versa) fails the inventory test below.
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
    "text_group_delivered.json",
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
    "text_group_delivered.json",
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


def test_mail_contacts_and_agent_identities_always_present_as_lists():
    for fixture in MAIL_FIXTURES:
        payload = cast(MailWebhookPayload, _load(fixture))
        assert isinstance(payload["data"]["contacts"], list), fixture
        assert isinstance(payload["data"]["agent_identities"], list), fixture


def test_inbound_carries_from_plus_cc_contact_matches():
    received = cast(MailWebhookPayload, _load("message_received.json"))
    contacts: list[WebhookMailContact] = received["data"]["contacts"]
    assert [c["bucket"] for c in contacts] == ["from", "cc"]
    assert contacts[0]["address"] == received["data"]["message"]["from_address"]
    assert isinstance(contacts[0]["id"], str)
    assert isinstance(contacts[0]["name"], str)
    cc_addresses = received["data"]["message"]["cc_addresses"]
    assert cc_addresses is not None
    assert contacts[1]["address"] in cc_addresses


def test_inbound_carries_agent_identity_with_bucket_address_keys():
    received = cast(MailWebhookPayload, _load("message_received.json"))
    agents: list[WebhookMailAgentIdentity] = received["data"]["agent_identities"]
    assert len(agents) == 1
    entry = agents[0]
    assert entry["bucket"] == "cc"
    assert isinstance(entry["id"], str)
    assert isinstance(entry["agent_handle"], str)
    assert entry["display_name"] is None or isinstance(entry["display_name"], str)
    cc_addresses = received["data"]["message"]["cc_addresses"]
    assert cc_addresses is not None
    assert entry["address"] in cc_addresses


def test_outbound_carries_to_cc_bcc_contact_matches():
    sent = cast(MailWebhookPayload, _load("message_sent.json"))
    buckets = [c["bucket"] for c in sent["data"]["contacts"]]
    assert buckets == ["to", "cc", "bcc"]
    bcc_entry = next(c for c in sent["data"]["contacts"] if c["bucket"] == "bcc")
    assert bcc_entry["address"] == "audit@inkboxmail.com"
    bcc_addresses = sent["data"]["message"]["bcc_addresses"]
    assert bcc_addresses is not None
    assert "audit@inkboxmail.com" in bcc_addresses


def test_unmatched_send_is_empty_lists():
    forwarded = cast(MailWebhookPayload, _load("message_forwarded.json"))
    assert forwarded["data"]["contacts"] == []
    assert forwarded["data"]["agent_identities"] == []


def test_agent_identity_allows_display_name_null():
    sent = cast(MailWebhookPayload, _load("message_sent.json"))
    agents = sent["data"]["agent_identities"]
    assert len(agents) == 1
    assert agents[0]["display_name"] is None


def test_bcc_addresses_null_on_inbound_populated_on_outbound():
    inbound = cast(MailWebhookPayload, _load("message_received.json"))
    assert inbound["data"]["message"]["bcc_addresses"] is None
    outbound = cast(MailWebhookPayload, _load("message_sent.json"))
    bcc = outbound["data"]["message"]["bcc_addresses"]
    assert bcc is not None
    assert "audit@inkboxmail.com" in bcc


def test_mail_required_fields_present_on_every_event():
    required = {
        "id", "mailbox_id", "thread_id", "message_id",
        "from_address", "to_addresses", "cc_addresses", "bcc_addresses",
        "subject", "snippet", "direction", "status",
        "has_attachments", "created_at",
        # Present-with-null on every live event; populated on received.
        "email_address", "body", "body_state", "body_truncated",
        "body_total_chars", "body_included_chars",
    }
    for fixture in MAIL_FIXTURES:
        payload = cast(MailWebhookPayload, _load(fixture))
        assert set(payload["data"]["message"].keys()) == required, fixture


def test_received_carries_body_fields_populated():
    received = cast(MailWebhookPayload, _load("message_received.json"))
    message = received["data"]["message"]
    assert message["email_address"] == "support@inkboxmail.com"
    assert isinstance(message["body"], str)
    assert message["body_state"] == "complete"
    assert message["body_truncated"] is False
    assert message["body_total_chars"] == message["body_included_chars"]


def test_body_fields_null_on_outbound_events():
    for fixture in ("message_sent.json", "message_delivered.json"):
        message = cast(MailWebhookPayload, _load(fixture))["data"]["message"]
        assert message["body"] is None
        assert message["body_state"] is None
        assert message["body_truncated"] is None


def test_old_payload_without_body_fields_still_parses():
    # Backwards compat: a replayed payload predating the body feature has
    # none of the new keys. It must remain a valid MailWebhookMessage.
    old = cast(MailWebhookPayload, _load("message_received.json"))
    for key in (
        "email_address", "body", "body_state", "body_truncated",
        "body_total_chars", "body_included_chars",
    ):
        old["data"]["message"].pop(key, None)  # type: ignore[misc]
    # No KeyError accessing the always-present fields; new keys just absent.
    assert old["data"]["message"]["id"]
    assert "body" not in old["data"]["message"]


def test_mail_contact_entries_have_required_keys():
    required = {"bucket", "address", "id", "name"}
    for fixture in MAIL_FIXTURES:
        payload = cast(MailWebhookPayload, _load(fixture))
        for entry in payload["data"]["contacts"]:
            assert set(entry.keys()) == required, (fixture, entry)
            assert entry["bucket"] in ("from", "to", "cc", "bcc")


def test_mail_agent_identity_entries_have_required_keys():
    required = {"bucket", "address", "id", "agent_handle", "display_name"}
    for fixture in MAIL_FIXTURES:
        payload = cast(MailWebhookPayload, _load(fixture))
        for entry in payload["data"]["agent_identities"]:
            assert set(entry.keys()) == required, (fixture, entry)
            assert entry["bucket"] in ("from", "to", "cc", "bcc")


# ---- Text ______________________________________________________________

@pytest.mark.parametrize("fixture", TEXT_FIXTURES)
def test_text_payload_parses(fixture: str):
    payload = cast(TextWebhookPayload, _load(fixture))
    assert payload["event_type"].startswith("text.")
    text = payload["data"]["text_message"]
    assert isinstance(text["id"], str)
    assert text["origin"] == "user_initiated"


@pytest.mark.parametrize("fixture", TEXT_FIXTURES)
def test_text_data_has_plural_lists_and_no_singular_contact(fixture: str):
    payload = cast(TextWebhookPayload, _load(fixture))
    assert isinstance(payload["data"]["contacts"], list)
    assert isinstance(payload["data"]["agent_identities"], list)
    assert "contact" not in payload["data"]


def test_text_delivery_failed_carries_full_lifecycle_block():
    payload = cast(TextWebhookPayload, _load("text_delivery_failed.json"))
    text = payload["data"]["text_message"]
    assert text["delivery_status"] == "delivery_failed"
    assert text["error_code"] == "30007"
    assert text["error_detail"] == "Message filtered by carrier"
    assert isinstance(text["sent_at"], str)
    assert isinstance(text["failed_at"], str)
    assert text["delivered_at"] is None
    assert text["conversation_id"] is not None
    assert text["recipients"] is not None
    assert text["recipients"][0]["recipient_phone_number"] == text["remote_phone_number"]


def test_text_received_has_no_lifecycle_timestamps():
    payload = cast(TextWebhookPayload, _load("text_received.json"))
    text = payload["data"]["text_message"]
    assert text["delivery_status"] is None
    assert text["sent_at"] is None
    assert text["delivered_at"] is None
    assert text["failed_at"] is None
    assert text["recipients"] is None
    assert isinstance(text["remote_phone_number"], str)
    assert payload["data"]["recipient_phone_number"] is None
    assert len(payload["data"]["contacts"]) == 1
    assert isinstance(payload["data"]["contacts"][0]["id"], str)


def test_text_sent_1on1_has_single_entry_recipients():
    payload = cast(TextWebhookPayload, _load("text_sent.json"))
    text = payload["data"]["text_message"]
    assert text["recipients"] is not None
    assert len(text["recipients"]) == 1
    entry = text["recipients"][0]
    assert entry["recipient_phone_number"] == text["remote_phone_number"]
    assert payload["data"]["recipient_phone_number"] is None


def test_text_group_lifecycle_identifies_recipient_that_changed_state():
    payload = cast(TextWebhookPayload, _load("text_group_delivered.json"))
    text = payload["data"]["text_message"]
    assert text["remote_phone_number"] is None
    assert text["type"] == "mms"
    assert text["media"] is not None
    assert len(text["media"]) == 1
    assert isinstance(text["conversation_id"], str)
    # Outbound rows carry sender_phone_number=null; the implicit sender is
    # local_phone_number. Inbound rows are the only ones with a non-null sender.
    assert text["sender_phone_number"] is None
    recipients = text["recipients"]
    assert isinstance(recipients, list)
    assert len(recipients) >= 2
    required = {
        "recipient_phone_number",
        "delivery_status",
        "carrier",
        "line_type",
        "error_code",
        "error_detail",
        "sent_at",
        "delivered_at",
        "failed_at",
    }
    for entry in recipients:
        assert set(entry.keys()) == required, entry
    top_level = payload["data"]["recipient_phone_number"]
    assert top_level == "+14155550999"
    assert top_level in {e["recipient_phone_number"] for e in recipients}


def test_text_required_fields_present_on_every_event():
    required = {
        "id", "direction", "local_phone_number", "remote_phone_number",
        "text", "type", "media", "is_read",
        "delivery_status", "origin", "error_code", "error_detail",
        "sent_at", "delivered_at", "failed_at",
        "conversation_id", "sender_phone_number", "recipients",
        "created_at", "updated_at",
    }
    for fixture in TEXT_FIXTURES:
        payload = cast(TextWebhookPayload, _load(fixture))
        assert set(payload["data"]["text_message"].keys()) == required, fixture
        assert "recipient_phone_number" in payload["data"]


@pytest.mark.parametrize("fixture", TEXT_FIXTURES)
def test_text_omits_is_blocked(fixture: str):
    payload = cast(TextWebhookPayload, _load(fixture))
    assert "is_blocked" not in payload["data"]["text_message"]


# ---- Inbound call ______________________________________________________

def test_phone_incoming_call_payload_is_flat_and_plural():
    payload = cast(
        PhoneIncomingCallWebhookPayload, _load("phone_incoming_call.json"),
    )
    assert "event_type" not in payload
    assert "data" not in payload
    assert payload["direction"] == "inbound"
    assert payload["status"] == "initiated"
    assert isinstance(payload["contacts"], list)
    assert isinstance(payload["agent_identities"], list)
    assert "contact" not in payload


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


def test_phone_incoming_call_agent_identity_entry_keys():
    payload = cast(
        PhoneIncomingCallWebhookPayload, _load("phone_incoming_call.json"),
    )
    assert len(payload["agent_identities"]) == 1
    entry = payload["agent_identities"][0]
    assert set(entry.keys()) == {"id", "agent_handle", "display_name"}
    assert isinstance(entry["id"], str)
    assert isinstance(entry["agent_handle"], str)
    assert entry["display_name"] is None or isinstance(entry["display_name"], str)

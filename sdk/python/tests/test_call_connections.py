"""Call history contract and legacy compatibility."""

import json
from datetime import datetime
from pathlib import Path
from typing import get_type_hints

from inkbox import (
    CallConnectionKind,
    CallConnectionStatus,
    CallConnectionTrigger,
    PhoneCall,
    PhoneCallConnection,
    WebhookPhoneCallConnection,
)
from inkbox.webhooks import WebhookPhoneCall


def fixture():
    return json.loads(
        (Path(__file__).parents[3] / "tests/fixtures/phone_call_connections.json").read_text()
    )


def test_connection_kinds_triggers_statuses_and_timestamps():
    call = PhoneCall._from_dict(fixture())
    assert call.connections is not None
    assert all(isinstance(c, PhoneCallConnection) for c in call.connections)
    assert [c.kind for c in call.connections[:3]] == [
        CallConnectionKind.HANDOFF,
        CallConnectionKind.HANDOFF,
        CallConnectionKind.CONFERENCE,
    ]
    assert call.connections[0].trigger is CallConnectionTrigger.INCOMING_ACTION
    assert call.connections[2].trigger is CallConnectionTrigger.AGENT_TOOL
    assert call.connections[2].status is CallConnectionStatus.CONNECTED
    assert isinstance(call.connections[2].connected_at, datetime)
    assert call.connections[2].ended_at > call.connections[2].connected_at
    assert call.connections[1].status is CallConnectionStatus.FAILED
    assert call.connections[1].failure_code == "destination_rejected"
    assert call.connections[3].status is CallConnectionStatus.REQUESTED
    assert call.connections[3].dialing_at is None
    assert call.connections[4].status is CallConnectionStatus.DIALING
    assert call.connections[4].connected_at is None
    assert len(call.forwardings) == 1
    assert call.forwardings[0].trigger == "incoming_action"


def test_missing_connections_is_distinct_from_authoritative_empty_list():
    wire = fixture()
    wire.pop("connections")
    assert PhoneCall._from_dict(wire).connections is None
    wire["connections"] = []
    parsed = PhoneCall._from_dict(wire)
    assert parsed.connections == []
    assert len(parsed.forwardings) == 1


def test_webhook_connection_types_are_exported_and_resolve():
    assert "connections" in get_type_hints(WebhookPhoneCall)
    assert "kind" in get_type_hints(WebhookPhoneCallConnection)
    assert "connected_at" in get_type_hints(WebhookPhoneCallConnection)
    assert "forwarded_at" not in get_type_hints(WebhookPhoneCallConnection)


def test_correspondence_uses_same_connections_and_tolerates_older_responses():
    from inkbox.contacts.types import CallCorrespondenceItem, _parse_correspondence_item

    wire = fixture()
    item = {
        "channel": "calls", "source_id": wire["id"], "identity_id": "55555555-5555-4555-8555-555555555555",
        "direction": "inbound", "occurred_at": wire["created_at"],
        "remote_phone_number": wire["remote_phone_number"], "connections": wire["connections"],
    }
    parsed = _parse_correspondence_item(item)
    assert isinstance(parsed, CallCorrespondenceItem)
    assert parsed.connections == PhoneCall._from_dict(wire).connections
    item["connections"] = []
    assert _parse_correspondence_item(item).connections == []
    item.pop("connections")
    assert _parse_correspondence_item(item).connections is None


def test_correspondence_connection_annotation_resolves_at_runtime():
    from inkbox.contacts import CallCorrespondenceItem
    from inkbox.phone.types import PhoneCallConnection as PhoneConnection

    assert PhoneConnection is PhoneCallConnection
    assert get_type_hints(CallCorrespondenceItem)["connections"] == list[PhoneCallConnection] | None


def test_future_connection_values_preserve_the_raw_strings():
    wire = fixture()
    wire["connections"][0].update(kind="future_kind", trigger="future_trigger", status="future_status")
    connection = PhoneCall._from_dict(wire).connections[0]
    assert connection.kind.value == "future_kind"
    assert connection.trigger.value == "future_trigger"
    assert connection.status.value == "future_status"
    assert connection.kind != CallConnectionKind.HANDOFF
    assert connection.status != CallConnectionStatus.CONNECTED
    assert json.loads(json.dumps([connection.kind, connection.trigger, connection.status])) == [
        "future_kind", "future_trigger", "future_status"
    ]
    from inkbox.contacts.types import _parse_correspondence_item
    item = {"channel": "calls", "source_id": wire["id"],
            "identity_id": "55555555-5555-4555-8555-555555555555", "direction": "inbound",
            "occurred_at": wire["created_at"], "remote_phone_number": wire["remote_phone_number"],
            "connections": wire["connections"]}
    assert _parse_correspondence_item(item).connections[0] == connection


def test_connection_enums_still_reject_non_string_values():
    import pytest
    for enum in (CallConnectionKind, CallConnectionTrigger, CallConnectionStatus):
        with pytest.raises(ValueError):
            enum(123)

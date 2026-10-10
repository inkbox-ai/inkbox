"""Call history contract and legacy compatibility."""

import json
from datetime import datetime
from pathlib import Path
from typing import get_type_hints

from inkbox import (
    CallConnectionKind,
    CallConnectionStatus,
    CallConnectionTrigger,
    CallForwardingTrigger,
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
    assert call.forwardings[1].trigger is CallForwardingTrigger.LIVE_TRANSFER
    assert call.forwardings[2].trigger is CallForwardingTrigger.LIVE_CONFERENCE


def test_missing_connections_is_distinct_from_authoritative_empty_list():
    wire = fixture()
    wire.pop("connections")
    assert PhoneCall._from_dict(wire).connections is None
    wire["connections"] = []
    parsed = PhoneCall._from_dict(wire)
    assert parsed.connections == []
    assert len(parsed.forwardings) == 5


def test_webhook_connection_types_are_exported_and_resolve():
    assert "connections" in get_type_hints(WebhookPhoneCall)
    assert "kind" in get_type_hints(WebhookPhoneCallConnection)
    assert "connected_at" in get_type_hints(WebhookPhoneCallConnection)
    assert "forwarded_at" not in get_type_hints(WebhookPhoneCallConnection)

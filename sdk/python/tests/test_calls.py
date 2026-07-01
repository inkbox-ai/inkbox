"""
sdk/python/tests/test_calls.py

Tests for CallsResource (identity-centered).
"""

from uuid import UUID

from inkbox.phone.types import CallOrigin
from sample_data import (
    PHONE_CALL_BLOCKED_DICT,
    PHONE_CALL_DICT,
    PHONE_TRANSCRIPT_DICT,
)


IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"
CALL_ID = "bbbb2222-0000-0000-0000-000000000001"


class TestCallsList:
    def test_returns_calls(self, client, transport):
        transport.get.return_value = [PHONE_CALL_DICT]

        calls = client._calls.list(limit=5)

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 5, "offset": 0},
        )
        assert len(calls) == 1
        assert calls[0].direction == "outbound"
        assert calls[0].remote_phone_number == "+15551234567"

    def test_default_limit_and_offset(self, client, transport):
        transport.get.return_value = []

        client._calls.list()

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 50, "offset": 0},
        )

    def test_agent_identity_id_passed_through(self, client, transport):
        transport.get.return_value = []

        client._calls.list(agent_identity_id=IDENTITY_ID, limit=10, offset=20)

        transport.get.assert_called_once_with(
            "/calls",
            params={
                "limit": 10,
                "offset": 20,
                "agent_identity_id": IDENTITY_ID,
            },
        )

    def test_is_blocked_omitted_by_default(self, client, transport):
        """When the caller doesn't pass is_blocked, it doesn't appear in the params."""
        transport.get.return_value = []

        client._calls.list()

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 50, "offset": 0},
        )

    def test_is_blocked_true_passes_through(self, client, transport):
        """is_blocked=True surfaces the admin-side blocked-only listing."""
        transport.get.return_value = [PHONE_CALL_BLOCKED_DICT]

        calls = client._calls.list(is_blocked=True)

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 50, "offset": 0, "is_blocked": True},
        )
        assert len(calls) == 1
        assert calls[0].is_blocked is True

    def test_is_blocked_false_passes_through(self, client, transport):
        """is_blocked=False narrows admin/JWT view to only non-blocked rows."""
        transport.get.return_value = [PHONE_CALL_DICT]

        calls = client._calls.list(is_blocked=False)

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 50, "offset": 0, "is_blocked": False},
        )
        assert calls[0].is_blocked is False

    def test_is_blocked_default_when_field_missing(self, client, transport):
        """Older server responses without is_blocked deserialize to False (back-compat)."""
        old_payload = {k: v for k, v in PHONE_CALL_DICT.items() if k != "is_blocked"}
        transport.get.return_value = [old_payload]

        calls = client._calls.list()

        assert calls[0].is_blocked is False


class TestCallsGet:
    def test_returns_call(self, client, transport):
        transport.get.return_value = PHONE_CALL_DICT

        call = client._calls.get(CALL_ID)

        transport.get.assert_called_once_with(f"/calls/{CALL_ID}")
        assert call.id == UUID(CALL_ID)
        assert call.status == "completed"
        assert call.client_websocket_url == "wss://agent.example.com/ws"
        assert call.started_at is not None
        assert call.ended_at is not None


class TestCallsTranscripts:
    def test_returns_transcripts(self, client, transport):
        second = {
            **PHONE_TRANSCRIPT_DICT,
            "id": "cccc3333-0000-0000-0000-000000000002",
            "seq": 1,
            "ts_ms": 3000,
            "party": "remote",
            "text": "I need help with my account.",
        }
        transport.get.return_value = [PHONE_TRANSCRIPT_DICT, second]

        transcripts = client._calls.transcripts(CALL_ID)

        transport.get.assert_called_once_with(f"/calls/{CALL_ID}/transcripts")
        assert len(transcripts) == 2
        assert transcripts[0].seq == 0
        assert transcripts[0].party == "local"
        assert transcripts[0].text == "Hello, how can I help you?"
        assert transcripts[0].ts_ms == 1500
        assert transcripts[0].call_id == UUID(CALL_ID)
        assert transcripts[1].seq == 1
        assert transcripts[1].party == "remote"

    def test_empty_transcripts(self, client, transport):
        transport.get.return_value = []

        transcripts = client._calls.transcripts(CALL_ID)

        assert transcripts == []


class TestCallsPlace:
    def test_place_dedicated_call(self, client, transport):
        transport.post.return_value = {
            **PHONE_CALL_DICT,
            "status": "ringing",
            "started_at": None,
            "ended_at": None,
        }

        call = client._calls.place(
            to_number="+15551234567",
            from_number="+18335794607",
            client_websocket_url="wss://agent.example.com/ws",
        )

        transport.post.assert_called_once_with(
            "/place-call",
            json={
                "to_number": "+15551234567",
                "origination": "dedicated_number",
                "from_number": "+18335794607",
                "client_websocket_url": "wss://agent.example.com/ws",
            },
        )
        assert call.status == "ringing"

    def test_place_shared_call(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            agent_identity_id=IDENTITY_ID,
        )

        transport.post.assert_called_once_with(
            "/place-call",
            json={
                "to_number": "+15551234567",
                "origination": "shared_imessage_number",
                "agent_identity_id": IDENTITY_ID,
            },
        )

    def test_optional_fields_omitted_when_none(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(to_number="+15551234567")

        _, kwargs = transport.post.call_args
        assert kwargs["json"] == {
            "to_number": "+15551234567",
            "origination": "dedicated_number",
        }

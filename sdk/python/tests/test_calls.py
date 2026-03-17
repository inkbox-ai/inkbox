"""Tests for CallsResource."""

from uuid import UUID

from sample_data import PHONE_CALL_DICT


NUM_ID = "aaaa1111-0000-0000-0000-000000000001"
CALL_ID = "bbbb2222-0000-0000-0000-000000000001"


class TestCallsList:
    def test_returns_calls(self, client, transport):
        transport.get.return_value = [PHONE_CALL_DICT]

        calls = client._calls.list(NUM_ID, limit=5)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/calls",
            params={"limit": 5, "offset": 0},
        )
        assert len(calls) == 1
        assert calls[0].direction == "outbound"
        assert calls[0].remote_phone_number == "+15167251294"

    def test_default_limit_and_offset(self, client, transport):
        transport.get.return_value = []

        client._calls.list(NUM_ID)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/calls",
            params={"limit": 50, "offset": 0},
        )

    def test_custom_offset(self, client, transport):
        transport.get.return_value = []

        client._calls.list(NUM_ID, limit=10, offset=20)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/calls",
            params={"limit": 10, "offset": 20},
        )


class TestCallsGet:
    def test_returns_call(self, client, transport):
        transport.get.return_value = PHONE_CALL_DICT

        call = client._calls.get(NUM_ID, CALL_ID)

        transport.get.assert_called_once_with(f"/numbers/{NUM_ID}/calls/{CALL_ID}")
        assert call.id == UUID(CALL_ID)
        assert call.status == "completed"
        assert call.client_websocket_url == "wss://agent.example.com/ws"
        assert call.started_at is not None
        assert call.ended_at is not None


class TestCallsPlace:
    def test_place_outbound_call(self, client, transport):
        transport.post.return_value = {
            **PHONE_CALL_DICT,
            "status": "ringing",
            "started_at": None,
            "ended_at": None,
        }

        call = client._calls.place(
            from_number="+18335794607",
            to_number="+15167251294",
            client_websocket_url="wss://agent.example.com/ws",
        )

        transport.post.assert_called_once_with(
            "/place-call",
            json={
                "from_number": "+18335794607",
                "to_number": "+15167251294",
                "client_websocket_url": "wss://agent.example.com/ws",
            },
        )
        assert call.status == "ringing"

    def test_optional_fields_omitted_when_none(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            from_number="+18335794607",
            to_number="+15167251294",
        )

        _, kwargs = transport.post.call_args
        assert "client_websocket_url" not in kwargs["json"]

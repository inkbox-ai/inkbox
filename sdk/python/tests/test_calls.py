"""
sdk/python/tests/test_calls.py

Tests for CallsResource (identity-centered).
"""

import inspect
from uuid import UUID

import httpx
import pytest

from inkbox._http import HttpTransport
from inkbox.exceptions import InkboxAPIError
from inkbox.phone.resources.calls import CallsResource
from inkbox.phone.types import CallMode, CallOrigin, PhoneCall
from sample_data import (
    PHONE_CALL_BLOCKED_DICT,
    PHONE_CALL_DICT,
    PHONE_TRANSCRIPT_DICT,
    POST_CALL_ACTION_ITEM_2_DICT,
    POST_CALL_ACTION_ITEM_DICT,
    RATE_LIMIT_INFO_DICT,
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

    def test_agent_identity_id_accepts_uuid(self, client, transport):
        """UUID objects are stringified before hitting the wire."""
        transport.get.return_value = []

        client._calls.list(agent_identity_id=UUID(IDENTITY_ID))

        transport.get.assert_called_once_with(
            "/calls",
            params={"limit": 50, "offset": 0, "agent_identity_id": IDENTITY_ID},
        )

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


class TestCallsHangup:
    def test_posts_hangup_and_returns_call(self, client, transport):
        # Teardown is async at the carrier: the row can come back still live.
        transport.post.return_value = {
            **PHONE_CALL_DICT,
            "status": "answered",
            "hangup_reason": "local",
            "ended_at": None,
        }

        call = client._calls.hangup(CALL_ID)

        transport.post.assert_called_once_with(f"/calls/{CALL_ID}/hangup")
        assert call.id == UUID(CALL_ID)
        assert call.status == "answered"
        assert call.hangup_reason == "local"
        assert call.ended_at is None

    def test_accepts_uuid(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.hangup(UUID(CALL_ID))

        transport.post.assert_called_once_with(f"/calls/{CALL_ID}/hangup")


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
                "mode": "client_websocket",
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
                "mode": "client_websocket",
                "agent_identity_id": IDENTITY_ID,
            },
        )

    def test_optional_fields_omitted_when_none(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(to_number="+15551234567")

        _, kwargs = transport.post.call_args
        # mode is always sent (server-side default mirrored on the wire);
        # reason only rides hosted placements.
        assert kwargs["json"] == {
            "to_number": "+15551234567",
            "origination": "dedicated_number",
            "mode": "client_websocket",
        }

    def test_string_origination_passed_verbatim(self, client, transport):
        """A raw string origination is forwarded as-is (no enum coercion)."""
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            to_number="+15551234567",
            origination="shared_imessage_number",
            agent_identity_id=IDENTITY_ID,
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["origination"] == "shared_imessage_number"

    def test_agent_identity_id_accepts_uuid(self, client, transport):
        """UUID objects are stringified in the request body."""
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            agent_identity_id=UUID(IDENTITY_ID),
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["agent_identity_id"] == IDENTITY_ID

    def test_response_parses_rate_limit_and_origin(self, client, transport):
        """The place-call response carries rate-limit info and the call origin."""
        transport.post.return_value = {
            **PHONE_CALL_DICT,
            "local_phone_number": None,
            "origin": "shared_imessage_number",
            "rate_limit": RATE_LIMIT_INFO_DICT,
        }

        call = client._calls.place(
            to_number="+15551234567",
            origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
            agent_identity_id=IDENTITY_ID,
        )

        assert call.origin is CallOrigin.SHARED_IMESSAGE_NUMBER
        assert call.local_phone_number is None
        assert call.rate_limit.calls_used == 3
        assert call.rate_limit.calls_remaining == 7
        assert call.rate_limit.calls_limit == 10
        assert call.rate_limit.minutes_used == 12.5
        assert call.rate_limit.minutes_remaining == 47.5
        assert call.rate_limit.minutes_limit == 60

    def test_response_without_rate_limit_parses_to_none(self, client, transport):
        """Older responses without rate_limit deserialize with rate_limit=None."""
        transport.post.return_value = PHONE_CALL_DICT

        call = client._calls.place(to_number="+15551234567")

        assert call.rate_limit is None
        assert call.origin is CallOrigin.DEDICATED_NUMBER


class TestCallsPlaceHosted:
    def test_hosted_mode_and_reason_forwarded(self, client, transport):
        transport.post.return_value = {
            **PHONE_CALL_DICT,
            "mode": "hosted_agent",
            "reason": "Book a cleaning next week, mornings preferred",
        }

        call = client._calls.place(
            to_number="+15551234567",
            from_number="+18335794607",
            mode=CallMode.HOSTED_AGENT,
            reason="Book a cleaning next week, mornings preferred",
        )

        transport.post.assert_called_once_with(
            "/place-call",
            json={
                "to_number": "+15551234567",
                "origination": "dedicated_number",
                "mode": "hosted_agent",
                "from_number": "+18335794607",
                "reason": "Book a cleaning next week, mornings preferred",
            },
        )
        assert call.mode == "hosted_agent"
        assert call.reason == "Book a cleaning next week, mornings preferred"

    def test_string_mode_passed_verbatim(self, client, transport):
        """A raw string mode is forwarded as-is (no enum coercion)."""
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            to_number="+15551234567",
            mode="hosted_agent",
            reason="Ask about opening hours",
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["mode"] == "hosted_agent"

    def test_reason_omitted_when_none(self, client, transport):
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(to_number="+15551234567", mode=CallMode.HOSTED_AGENT)

        _, kwargs = transport.post.call_args
        assert "reason" not in kwargs["json"]

    def test_hosted_with_ws_url_is_forwarded_not_gated(self, client, transport):
        """The SDK never client-gates the hosted/ws-url conflict — the server 422s."""
        transport.post.return_value = PHONE_CALL_DICT

        client._calls.place(
            to_number="+15551234567",
            client_websocket_url="wss://agent.example.com/ws",
            mode=CallMode.HOSTED_AGENT,
            reason="Confirm the appointment",
        )

        _, kwargs = transport.post.call_args
        assert kwargs["json"]["client_websocket_url"] == "wss://agent.example.com/ws"
        assert kwargs["json"]["mode"] == "hosted_agent"

    def test_mode_defaults_when_missing_from_response(self, client, transport):
        """Older responses without mode/reason parse to the client_websocket default."""
        old_payload = {
            k: v for k, v in PHONE_CALL_DICT.items() if k not in ("mode", "reason")
        }
        transport.post.return_value = old_payload

        call = client._calls.place(to_number="+15551234567")

        assert call.mode == "client_websocket"
        assert call.reason is None


class TestPostCallActionItems:
    """Post-call action items are surfaced inline on the parsed call resource."""

    def test_inline_actions_parse_in_seq_order(self):
        # A hosted call carries its open action items inline, seq-ascending.
        call = PhoneCall._from_dict(
            {
                **PHONE_CALL_DICT,
                "post_call_action_items": [
                    POST_CALL_ACTION_ITEM_DICT,
                    POST_CALL_ACTION_ITEM_2_DICT,
                ],
            }
        )

        assert len(call.post_call_action_items) == 2
        assert call.post_call_action_items[0].seq == 1
        assert call.post_call_action_items[0].action == "Book cleaning Tue 9:30am"
        assert (
            call.post_call_action_items[0].details
            == "Dr. Chen's office confirmed availability."
        )
        # Only open items reach the wire.
        assert all(a.status == "open" for a in call.post_call_action_items)
        assert call.post_call_action_items[1].details is None

    def test_missing_key_yields_empty_list(self):
        # Client-websocket calls (and hosted calls with no open items) omit it.
        call = PhoneCall._from_dict(PHONE_CALL_DICT)

        assert call.post_call_action_items == []


def _calls_resource_returning(status_code: int, body: dict | list) -> CallsResource:
    """Build a CallsResource over a real HttpTransport backed by a canned response."""
    http = HttpTransport(api_key="sk-test", base_url="https://phone.test")
    # Swap in a mock wire so the real _raise_for_status path runs.
    http._client = httpx.Client(
        base_url="https://phone.test",
        transport=httpx.MockTransport(
            lambda request: httpx.Response(status_code, json=body)
        ),
    )
    return CallsResource(http)


class TestCallsPlaceErrors:
    def test_409_no_shared_connection_surfaces(self):
        calls = _calls_resource_returning(
            409,
            {"detail": {"error": "no_shared_connection", "message": "no active shared line"}},
        )

        with pytest.raises(InkboxAPIError) as info:
            calls.place(
                to_number="+15551234567",
                origination=CallOrigin.SHARED_IMESSAGE_NUMBER,
                agent_identity_id=IDENTITY_ID,
            )

        err = info.value
        assert type(err) is InkboxAPIError
        assert err.status_code == 409
        assert err.detail["error"] == "no_shared_connection"

    def test_422_validation_error_surfaces(self):
        detail = [
            {
                "loc": ["body", "from_number"],
                "msg": "from_number is required for dedicated_number origination",
                "type": "value_error",
            },
        ]
        calls = _calls_resource_returning(422, {"detail": detail})

        with pytest.raises(InkboxAPIError) as info:
            calls.place(to_number="+15551234567")

        err = info.value
        assert err.status_code == 422
        assert err.detail == detail

    def test_422_hosted_reason_required_surfaces(self):
        """Server-side hosted validation (reason required) surfaces verbatim."""
        detail = [
            {
                "loc": ["body", "reason"],
                "msg": "reason is required with mode=hosted_agent",
                "type": "value_error",
            },
        ]
        calls = _calls_resource_returning(422, {"detail": detail})

        with pytest.raises(InkboxAPIError) as info:
            calls.place(
                to_number="+15551234567",
                from_number="+18335794607",
                mode=CallMode.HOSTED_AGENT,
            )

        err = info.value
        assert err.status_code == 422
        assert err.detail == detail

    def test_503_hosted_agent_at_capacity_surfaces(self):
        """The hosted concurrency guard's 503 is surfaced verbatim."""
        calls = _calls_resource_returning(
            503, {"detail": {"error": "hosted_agent_at_capacity"}}
        )

        with pytest.raises(InkboxAPIError) as info:
            calls.place(
                to_number="+15551234567",
                from_number="+18335794607",
                mode=CallMode.HOSTED_AGENT,
                reason="Confirm the appointment",
            )

        err = info.value
        assert err.status_code == 503
        assert err.detail["error"] == "hosted_agent_at_capacity"


class TestRemovedNumberScopedSurface:
    """Cheap regression guards: the number-scoped call surface is gone."""

    def test_client_has_no_transcripts_accessor(self, client):
        assert not hasattr(client, "transcripts")

    def test_list_is_not_number_scoped(self):
        params = inspect.signature(CallsResource.list).parameters
        assert "phone_number_id" not in params
        assert "number_id" not in params
        # Keyword-only surface: no positional number slot.
        assert list(params) == [
            "self", "agent_identity_id", "limit", "offset", "is_blocked",
            "start_datetime", "end_datetime", "tz",
        ]

    def test_get_takes_only_call_id(self):
        params = inspect.signature(CallsResource.get).parameters
        assert list(params) == ["self", "call_id"]

    def test_transcripts_takes_only_call_id(self):
        params = inspect.signature(CallsResource.transcripts).parameters
        assert list(params) == ["self", "call_id"]

    def test_place_is_not_number_scoped(self):
        params = inspect.signature(CallsResource.place).parameters
        assert "phone_number_id" not in params

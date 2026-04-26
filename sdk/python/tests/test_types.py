"""
sdk/python/tests/test_types.py

Tests for type parsing.
"""

from datetime import datetime
from uuid import UUID

from sample_data import (
    PHONE_NUMBER_DICT,
    PHONE_CALL_DICT,
    PHONE_TRANSCRIPT_DICT,
)
from inkbox.phone.types import (
    PhoneNumber,
    PhoneCall,
    PhoneTranscript,
    SmsStatus,
)


class TestPhoneNumberParsing:
    def test_from_dict(self):
        n = PhoneNumber._from_dict(PHONE_NUMBER_DICT)

        assert isinstance(n.id, UUID)
        assert n.number == "+18335794607"
        assert n.type == "toll_free"
        assert n.status == "active"
        assert n.incoming_call_action == "auto_reject"
        assert n.client_websocket_url is None
        assert n.incoming_call_webhook_url is None
        assert n.agent_identity_id == UUID("eeee5555-0000-0000-0000-000000000001")
        assert isinstance(n.created_at, datetime)
        assert isinstance(n.updated_at, datetime)

    def test_agent_identity_id_nullable(self):
        n = PhoneNumber._from_dict({**PHONE_NUMBER_DICT, "agent_identity_id": None})
        assert n.agent_identity_id is None

    def test_sms_readiness_fields(self):
        n = PhoneNumber._from_dict(PHONE_NUMBER_DICT)
        assert n.sms_status is SmsStatus.READY
        assert n.sms_error_code is None
        assert n.sms_error_detail is None
        assert isinstance(n.sms_ready_at, datetime)

    def test_sms_pending_with_error(self):
        n = PhoneNumber._from_dict({
            **PHONE_NUMBER_DICT,
            "sms_status": "assignment_failed",
            "sms_error_code": "tcr_campaign_rejected",
            "sms_error_detail": "Campaign brand mismatch",
            "sms_ready_at": None,
        })
        assert n.sms_status is SmsStatus.ASSIGNMENT_FAILED
        assert n.sms_error_code == "tcr_campaign_rejected"
        assert n.sms_error_detail == "Campaign brand mismatch"
        assert n.sms_ready_at is None

    def test_sms_status_defaults_to_ready_when_missing(self):
        # Backwards-compat with older server responses pre-sms_status.
        legacy = {k: v for k, v in PHONE_NUMBER_DICT.items() if not k.startswith("sms_")}
        n = PhoneNumber._from_dict(legacy)
        assert n.sms_status is SmsStatus.READY


class TestPhoneCallParsing:
    def test_from_dict(self):
        c = PhoneCall._from_dict(PHONE_CALL_DICT)

        assert isinstance(c.id, UUID)
        assert c.local_phone_number == "+18335794607"
        assert c.remote_phone_number == "+15167251294"
        assert c.direction == "outbound"
        assert c.status == "completed"
        assert c.client_websocket_url == "wss://agent.example.com/ws"
        assert c.use_inkbox_tts is None
        assert c.use_inkbox_stt is None
        assert isinstance(c.started_at, datetime)
        assert isinstance(c.ended_at, datetime)

    def test_nullable_timestamps(self):
        d = {**PHONE_CALL_DICT, "started_at": None, "ended_at": None}

        c = PhoneCall._from_dict(d)

        assert c.started_at is None
        assert c.ended_at is None


class TestPhoneTranscriptParsing:
    def test_from_dict(self):
        t = PhoneTranscript._from_dict(PHONE_TRANSCRIPT_DICT)

        assert isinstance(t.id, UUID)
        assert isinstance(t.call_id, UUID)
        assert t.seq == 0
        assert t.ts_ms == 1500
        assert t.party == "local"
        assert t.text == "Hello, how can I help you?"
        assert isinstance(t.created_at, datetime)

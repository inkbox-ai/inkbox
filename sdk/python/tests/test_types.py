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
        assert isinstance(n.created_at, datetime)
        assert isinstance(n.updated_at, datetime)


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

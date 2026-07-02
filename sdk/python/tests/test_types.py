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
    RATE_LIMIT_INFO_DICT,
)
from inkbox.phone.types import (
    CallOrigin,
    IncomingCallAction,
    IncomingCallActionConfig,
    PhoneNumber,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneTranscript,
    SmsStatus,
)


class TestPhoneNumberParsing:
    def test_from_dict(self):
        n = PhoneNumber._from_dict(PHONE_NUMBER_DICT)

        assert isinstance(n.id, UUID)
        assert n.number == "+18335794607"
        assert n.type == "local"
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
        assert c.remote_phone_number == "+15551234567"
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

    def test_origin_defaults_to_dedicated_when_missing(self):
        # Older responses predate shared-iMessage calls.
        c = PhoneCall._from_dict(PHONE_CALL_DICT)
        assert c.origin is CallOrigin.DEDICATED_NUMBER

    def test_origin_null_coerces_to_dedicated(self):
        c = PhoneCall._from_dict({**PHONE_CALL_DICT, "origin": None})
        assert c.origin is CallOrigin.DEDICATED_NUMBER

    def test_shared_origin_has_null_local_number(self):
        d = {
            **PHONE_CALL_DICT,
            "origin": "shared_imessage_number",
            "local_phone_number": None,
        }
        c = PhoneCall._from_dict(d)
        assert c.origin is CallOrigin.SHARED_IMESSAGE_NUMBER
        assert c.local_phone_number is None

    def test_origin_dedicated_explicit(self):
        c = PhoneCall._from_dict({**PHONE_CALL_DICT, "origin": "dedicated_number"})
        assert c.origin is CallOrigin.DEDICATED_NUMBER
        assert c.local_phone_number == "+18335794607"

    def test_unknown_extra_fields_ignored(self):
        # A newer server can grow fields without breaking older SDKs.
        c = PhoneCall._from_dict({**PHONE_CALL_DICT, "brand_new_field": "surprise"})
        assert c.id == UUID(PHONE_CALL_DICT["id"])
        assert not hasattr(c, "brand_new_field")


class TestPhoneCallWithRateLimitParsing:
    def test_from_dict_with_rate_limit(self):
        c = PhoneCallWithRateLimit._from_dict(
            {**PHONE_CALL_DICT, "rate_limit": RATE_LIMIT_INFO_DICT}
        )

        # Base PhoneCall fields survive the subclass hop.
        assert isinstance(c, PhoneCall)
        assert c.id == UUID(PHONE_CALL_DICT["id"])
        assert c.remote_phone_number == "+15551234567"
        assert c.origin is CallOrigin.DEDICATED_NUMBER
        assert c.rate_limit.calls_used == 3
        assert c.rate_limit.calls_remaining == 7
        assert c.rate_limit.calls_limit == 10
        assert c.rate_limit.minutes_used == 12.5
        assert c.rate_limit.minutes_remaining == 47.5
        assert c.rate_limit.minutes_limit == 60

    def test_rate_limit_missing_is_none(self):
        c = PhoneCallWithRateLimit._from_dict(PHONE_CALL_DICT)
        assert c.rate_limit is None

    def test_shared_origin_parses(self):
        c = PhoneCallWithRateLimit._from_dict(
            {
                **PHONE_CALL_DICT,
                "local_phone_number": None,
                "origin": "shared_imessage_number",
                "rate_limit": RATE_LIMIT_INFO_DICT,
            }
        )
        assert c.origin is CallOrigin.SHARED_IMESSAGE_NUMBER
        assert c.local_phone_number is None


class TestIncomingCallActionConfigParsing:
    def test_from_dict(self):
        cfg = IncomingCallActionConfig._from_dict(
            {
                "agent_identity_id": "eeee5555-0000-0000-0000-000000000001",
                "incoming_call_action": "webhook",
                "client_websocket_url": None,
                "incoming_call_webhook_url": "https://hooks.example.com/x",
            }
        )
        assert isinstance(cfg.agent_identity_id, UUID)
        assert cfg.incoming_call_action is IncomingCallAction.WEBHOOK
        assert cfg.client_websocket_url is None
        assert cfg.incoming_call_webhook_url == "https://hooks.example.com/x"


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

    def test_unknown_extra_fields_ignored(self):
        t = PhoneTranscript._from_dict(
            {**PHONE_TRANSCRIPT_DICT, "brand_new_field": "surprise"}
        )
        assert t.seq == 0
        assert not hasattr(t, "brand_new_field")

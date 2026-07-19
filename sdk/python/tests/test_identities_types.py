"""
sdk/python/tests/test_identities_types.py

Tests for identities type parsing.
"""

from datetime import datetime, timezone
from uuid import UUID

from sample_data_identities import (
    IDENTITY_DICT,
    IDENTITY_DETAIL_DICT,
    IDENTITY_IMESSAGE_NUMBER_DICT,
    IDENTITY_MAILBOX_DICT,
    IDENTITY_PHONE_DICT,
)
from inkbox.identities.types import (
    AgentIdentitySummary,
    _AgentIdentityData,
    IdentityMailbox,
    IdentityMailboxCreateOptions,
    IdentityIMessageNumber,
    IdentityPhoneNumber,
)
from inkbox.imessage.types import IMessageNumberType


class TestAgentIdentitySummaryParsing:
    def test_from_dict(self):
        i = AgentIdentitySummary._from_dict(IDENTITY_DICT)

        assert isinstance(i.id, UUID)
        assert i.organization_id == "org-abc123"
        assert i.agent_handle == "sales-agent"
        assert isinstance(i.created_at, datetime)
        assert isinstance(i.updated_at, datetime)


class TestAgentIdentityDataParsing:
    def test_with_channels(self):
        d = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)

        assert isinstance(d.id, UUID)
        assert d.agent_handle == "sales-agent"
        assert isinstance(d.mailbox, IdentityMailbox)
        assert d.mailbox.email_address == "sales-agent@inkbox.ai"
        assert isinstance(d.phone_number, IdentityPhoneNumber)
        assert d.phone_number.number == "+18335794607"
        assert isinstance(d.imessage_number, IdentityIMessageNumber)
        assert d.imessage_number.type is IMessageNumberType.DEDICATED_OUTBOUND
        assert d.imessage_number.can_start_conversations is True

    def test_no_channels(self):
        d = _AgentIdentityData._from_dict(IDENTITY_DICT)

        assert d.mailbox is None
        assert d.phone_number is None
        assert d.imessage_number is None


class TestIdentityIMessageNumberParsing:
    def test_parses_embedded_number(self):
        number = IdentityIMessageNumber._from_dict(IDENTITY_IMESSAGE_NUMBER_DICT)

        assert isinstance(number.id, UUID)
        assert number.number == "+15551230001"
        assert number.type is IMessageNumberType.DEDICATED_OUTBOUND
        assert number.can_start_conversations is True

    def test_inbound_capability_is_derived_from_type(self):
        number = IdentityIMessageNumber._from_dict(
            {
                **IDENTITY_IMESSAGE_NUMBER_DICT,
                "type": "dedicated_inbound",
            }
        )

        assert number.can_start_conversations is False


class TestIdentityMailboxParsing:
    def test_from_dict(self):
        m = IdentityMailbox._from_dict(IDENTITY_MAILBOX_DICT)

        assert isinstance(m.id, UUID)
        assert m.email_address == "sales-agent@inkbox.ai"
        assert m.agent_identity_id == UUID("eeee5555-0000-0000-0000-000000000001")
        assert isinstance(m.created_at, datetime)
        assert isinstance(m.updated_at, datetime)

    def test_reads_sending_domain(self):
        m = IdentityMailbox._from_dict(
            {**IDENTITY_MAILBOX_DICT, "sending_domain": "mail.acme.com"}
        )
        assert m.sending_domain == "mail.acme.com"

    def test_falls_back_to_email_address_split(self):
        m = IdentityMailbox._from_dict(IDENTITY_MAILBOX_DICT)
        assert m.sending_domain == "inkbox.ai"

class TestIdentityMailboxCreateOptionsToWire:
    def test_empty_when_unset(self):
        opts = IdentityMailboxCreateOptions()
        assert opts.to_wire() == {}

    def test_email_local_part_when_set(self):
        opts = IdentityMailboxCreateOptions(email_local_part="alice")
        assert opts.to_wire() == {"email_local_part": "alice"}

    def test_includes_null_when_explicit(self):
        opts = IdentityMailboxCreateOptions(sending_domain=None)
        assert opts.to_wire() == {"sending_domain": None}

    def test_includes_string_when_set(self):
        opts = IdentityMailboxCreateOptions(sending_domain="mail.acme.com")
        assert opts.to_wire() == {"sending_domain": "mail.acme.com"}


class TestIdentityPhoneNumberParsing:
    def test_from_dict(self):
        p = IdentityPhoneNumber._from_dict(IDENTITY_PHONE_DICT)

        assert isinstance(p.id, UUID)
        assert p.number == "+18335794607"
        assert p.type == "local"
        assert p.status == "active"
        assert p.incoming_call_action == "auto_reject"
        assert p.client_websocket_url is None
        assert p.incoming_call_webhook_url is None
        assert p.state is None
        assert p.agent_identity_id == UUID("eeee5555-0000-0000-0000-000000000001")

    def test_parses_incoming_call_webhook_url(self):
        p = IdentityPhoneNumber._from_dict(
            {
                **IDENTITY_PHONE_DICT,
                "incoming_call_webhook_url": "https://example.com/calls",
            }
        )

        assert p.incoming_call_webhook_url == "https://example.com/calls"

    def test_parses_state_for_local_numbers(self):
        p = IdentityPhoneNumber._from_dict(
            {**IDENTITY_PHONE_DICT, "type": "local", "state": "NY"}
        )

        assert p.state == "NY"


class TestIdentityIMessageFields:
    def test_summary_parses_imessage_fields(self):
        from inkbox.identities.types import AgentIdentitySummary
        from inkbox.mail.types import FilterMode

        d = {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_x",
            "agent_handle": "support-bot",
            "display_name": None,
            "description": None,
            "email_address": None,
            "imessage_enabled": True,
            "imessage_filter_mode": "whitelist",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
        }
        summary = AgentIdentitySummary._from_dict(d)
        assert summary.imessage_enabled is True
        assert summary.imessage_filter_mode is FilterMode.WHITELIST

    def test_summary_defaults_imessage_fields_when_absent(self):
        from inkbox.identities.types import AgentIdentitySummary
        from inkbox.mail.types import FilterMode

        d = {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_x",
            "agent_handle": "support-bot",
            "display_name": None,
            "description": None,
            "email_address": None,
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
        }
        summary = AgentIdentitySummary._from_dict(d)
        assert summary.imessage_enabled is False
        assert summary.imessage_filter_mode is FilterMode.BLACKLIST


class TestIdentitySigningKeyStatusFields:
    def test_summary_parses_signing_key_status(self):
        d = {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_x",
            "agent_handle": "support-bot",
            "display_name": None,
            "description": None,
            "email_address": None,
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
            "signing_key_configured": True,
            "signing_key_created_at": "2026-06-02T03:04:05+00:00",
        }
        summary = AgentIdentitySummary._from_dict(d)
        assert summary.signing_key_configured is True
        assert summary.signing_key_created_at == datetime(
            2026, 6, 2, 3, 4, 5, tzinfo=timezone.utc,
        )

    def test_summary_defaults_signing_key_status_when_absent(self):
        d = {
            "id": "11111111-1111-1111-1111-111111111111",
            "organization_id": "org_x",
            "agent_handle": "support-bot",
            "display_name": None,
            "description": None,
            "email_address": None,
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-01T00:00:00+00:00",
        }
        summary = AgentIdentitySummary._from_dict(d)
        assert summary.signing_key_configured is False
        assert summary.signing_key_created_at is None

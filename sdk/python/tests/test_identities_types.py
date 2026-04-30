"""
sdk/python/tests/test_identities_types.py

Tests for identities type parsing.
"""

from datetime import datetime
from uuid import UUID

from sample_data_identities import (
    IDENTITY_DICT,
    IDENTITY_DETAIL_DICT,
    IDENTITY_MAILBOX_DICT,
    IDENTITY_PHONE_DICT,
)
from inkbox.identities.types import (
    AgentIdentitySummary,
    _AgentIdentityData,
    IdentityMailbox,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumber,
)


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

    def test_no_channels(self):
        d = _AgentIdentityData._from_dict(IDENTITY_DICT)

        assert d.mailbox is None
        assert d.phone_number is None


class TestIdentityMailboxParsing:
    def test_from_dict(self):
        m = IdentityMailbox._from_dict(IDENTITY_MAILBOX_DICT)

        assert isinstance(m.id, UUID)
        assert m.email_address == "sales-agent@inkbox.ai"
        assert m.display_name == "Sales Agent"
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
    def test_omits_sending_domain_when_unset(self):
        opts = IdentityMailboxCreateOptions(display_name="x")
        assert opts.to_wire() == {"display_name": "x"}

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
        assert p.type == "toll_free"
        assert p.status == "active"
        assert p.incoming_call_action == "auto_reject"
        assert p.client_websocket_url is None
        assert p.incoming_text_webhook_url is None
        assert p.agent_identity_id == UUID("eeee5555-0000-0000-0000-000000000001")

    def test_parses_incoming_text_webhook_url(self):
        p = IdentityPhoneNumber._from_dict(
            {
                **IDENTITY_PHONE_DICT,
                "incoming_text_webhook_url": "https://example.com/texts",
            }
        )

        assert p.incoming_text_webhook_url == "https://example.com/texts"

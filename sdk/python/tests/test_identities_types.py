"""Tests for identities type parsing."""

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
    IdentityPhoneNumber,
)


class TestAgentIdentitySummaryParsing:
    def test_from_dict(self):
        i = AgentIdentitySummary._from_dict(IDENTITY_DICT)

        assert isinstance(i.id, UUID)
        assert i.organization_id == "org-abc123"
        assert i.agent_handle == "sales-agent"
        assert i.status == "active"
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
        assert m.status == "active"
        assert isinstance(m.created_at, datetime)
        assert isinstance(m.updated_at, datetime)


class TestIdentityPhoneNumberParsing:
    def test_from_dict(self):
        p = IdentityPhoneNumber._from_dict(IDENTITY_PHONE_DICT)

        assert isinstance(p.id, UUID)
        assert p.number == "+18335794607"
        assert p.type == "toll_free"
        assert p.status == "active"
        assert p.incoming_call_action == "auto_reject"
        assert p.client_websocket_url is None

"""
sdk/python/tests/test_contact_rules.py

Tests for MailContactRulesResource / PhoneContactRulesResource.
"""

from uuid import UUID
from unittest.mock import MagicMock

import pytest

from inkbox.mail.resources.contact_rules import MailContactRulesResource
from inkbox.mail.types import MailRuleAction, MailRuleMatchType
from inkbox.phone.resources.contact_rules import PhoneContactRulesResource
from inkbox.phone.types import PhoneRuleAction


MAIL_RULE_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000011",
    "mailbox_id": "bbbb2222-0000-0000-0000-000000000001",
    "action": "block",
    "match_type": "domain",
    "match_target": "spam.example",
    "status": "active",
    "created_at": "2026-04-20T00:00:00Z",
    "updated_at": "2026-04-20T00:00:00Z",
}

PHONE_RULE_DICT = {
    "id": "aaaa1111-0000-0000-0000-000000000012",
    "phone_number_id": "cccc3333-0000-0000-0000-000000000001",
    "action": "block",
    "match_type": "exact_number",
    "match_target": "+15551234567",
    "status": "active",
    "created_at": "2026-04-20T00:00:00Z",
    "updated_at": "2026-04-20T00:00:00Z",
}


@pytest.fixture
def transport():
    t = MagicMock()
    t.get = MagicMock()
    t.post = MagicMock()
    t.patch = MagicMock()
    t.delete = MagicMock()
    return t


class TestMailContactRules:
    def test_list_with_filters(self, transport):
        transport.get.return_value = [MAIL_RULE_DICT]
        resource = MailContactRulesResource(transport)

        rows = resource.list(
            "box@inkbox.ai",
            action=MailRuleAction.BLOCK,
            match_type=MailRuleMatchType.DOMAIN,
            limit=10,
        )

        transport.get.assert_called_once_with(
            "/mailboxes/box@inkbox.ai/contact-rules",
            params={"action": "block", "match_type": "domain", "limit": 10},
        )
        assert rows[0].action == MailRuleAction.BLOCK
        assert rows[0].match_type == MailRuleMatchType.DOMAIN

    def test_create_sends_enum_values(self, transport):
        transport.post.return_value = MAIL_RULE_DICT
        resource = MailContactRulesResource(transport)

        rule = resource.create(
            "box@inkbox.ai",
            action=MailRuleAction.BLOCK,
            match_type=MailRuleMatchType.DOMAIN,
            match_target="spam.example",
        )

        transport.post.assert_called_once_with(
            "/mailboxes/box@inkbox.ai/contact-rules",
            json={
                "action": "block",
                "match_type": "domain",
                "match_target": "spam.example",
            },
        )
        assert isinstance(rule.id, UUID)

    def test_update_only_sends_supplied_fields(self, transport):
        transport.patch.return_value = {**MAIL_RULE_DICT, "status": "paused"}
        resource = MailContactRulesResource(transport)

        rid = "aaaa1111-0000-0000-0000-000000000011"
        resource.update("box@inkbox.ai", rid, status="paused")

        transport.patch.assert_called_once_with(
            f"/mailboxes/box@inkbox.ai/contact-rules/{rid}",
            json={"status": "paused"},
        )

    def test_list_all_org_wide(self, transport):
        transport.get.return_value = [MAIL_RULE_DICT]
        resource = MailContactRulesResource(transport)

        rows = resource.list_all(mailbox_id="bbbb2222-0000-0000-0000-000000000001")

        transport.get.assert_called_once_with(
            "/contact-rules",
            params={"mailbox_id": "bbbb2222-0000-0000-0000-000000000001"},
        )
        assert len(rows) == 1

    def test_list_all_with_action_and_match_type(self, transport):
        transport.get.return_value = [MAIL_RULE_DICT]
        resource = MailContactRulesResource(transport)

        resource.list_all(
            action=MailRuleAction.BLOCK,
            match_type=MailRuleMatchType.DOMAIN,
        )

        transport.get.assert_called_once_with(
            "/contact-rules",
            params={"action": "block", "match_type": "domain"},
        )


class TestPhoneContactRules:
    def test_create_defaults_match_type(self, transport):
        transport.post.return_value = PHONE_RULE_DICT
        resource = PhoneContactRulesResource(transport)

        pid = "cccc3333-0000-0000-0000-000000000001"
        resource.create(
            pid,
            action=PhoneRuleAction.BLOCK,
            match_target="+15551234567",
        )

        transport.post.assert_called_once_with(
            f"/numbers/{pid}/contact-rules",
            json={
                "action": "block",
                "match_type": "exact_number",
                "match_target": "+15551234567",
            },
        )

    def test_delete_hits_rule_path(self, transport):
        resource = PhoneContactRulesResource(transport)
        pid = "cccc3333-0000-0000-0000-000000000001"
        rid = "aaaa1111-0000-0000-0000-000000000012"

        resource.delete(pid, rid)

        transport.delete.assert_called_once_with(
            f"/numbers/{pid}/contact-rules/{rid}",
        )

    def test_list_all_with_phone_number_id(self, transport):
        transport.get.return_value = [PHONE_RULE_DICT]
        resource = PhoneContactRulesResource(transport)

        resource.list_all(phone_number_id="cccc3333-0000-0000-0000-000000000001")

        transport.get.assert_called_once_with(
            "/contact-rules",
            params={"phone_number_id": "cccc3333-0000-0000-0000-000000000001"},
        )

    def test_list_all_with_action_filter(self, transport):
        transport.get.return_value = [PHONE_RULE_DICT]
        resource = PhoneContactRulesResource(transport)

        resource.list_all(action=PhoneRuleAction.BLOCK)

        transport.get.assert_called_once_with(
            "/contact-rules",
            params={"action": "block"},
        )

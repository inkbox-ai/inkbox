"""
sdk/python/tests/test_mail_mailboxes.py

Tests for MailboxesResource.
"""

from unittest.mock import MagicMock
from uuid import UUID

from sample_data_mail import MAILBOX_DICT, CURSOR_PAGE_SEARCH
from inkbox.mail.resources.mailboxes import MailboxesResource


def _resource():
    http = MagicMock()
    return MailboxesResource(http), http


class TestMailboxesList:
    def test_returns_mailboxes(self):
        res, http = _resource()
        http.get.return_value = [MAILBOX_DICT]

        mailboxes = res.list()

        http.get.assert_called_once_with("/mailboxes")
        assert len(mailboxes) == 1
        assert mailboxes[0].email_address == "agent01@inkbox.ai"

    def test_empty_list(self):
        res, http = _resource()
        http.get.return_value = []

        assert res.list() == []


class TestMailboxesGet:
    def test_returns_mailbox(self):
        res, http = _resource()
        http.get.return_value = MAILBOX_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        mailbox = res.get(uid)

        http.get.assert_called_once_with(f"/mailboxes/{uid}")
        assert mailbox.id == UUID(uid)
        assert mailbox.display_name == "Agent 01"


class TestMailboxesCreate:
    def test_create_mailbox(self):
        res, http = _resource()
        http.post.return_value = MAILBOX_DICT

        mailbox = res.create(
            agent_handle="sales-agent",
            display_name="Sales Team",
            email_local_part="sales.team",
        )

        http.post.assert_called_once_with(
            "/mailboxes",
            json={
                "agent_handle": "sales-agent",
                "display_name": "Sales Team",
                "email_local_part": "sales.team",
            },
        )
        assert mailbox.email_address == "agent01@inkbox.ai"


class TestMailboxesUpdate:
    def test_update_display_name(self):
        res, http = _resource()
        http.patch.return_value = {**MAILBOX_DICT, "display_name": "New Name"}
        uid = "aaaa1111-0000-0000-0000-000000000001"

        mailbox = res.update(uid, display_name="New Name")

        http.patch.assert_called_once_with(
            f"/mailboxes/{uid}", json={"display_name": "New Name"}
        )
        assert mailbox.display_name == "New Name"

    def test_update_omits_none_fields(self):
        res, http = _resource()
        http.patch.return_value = MAILBOX_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        res.update(uid)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {}


class TestMailboxesDelete:
    def test_deletes_mailbox(self):
        res, http = _resource()
        uid = "aaaa1111-0000-0000-0000-000000000001"

        res.delete(uid)

        http.delete.assert_called_once_with(f"/mailboxes/{uid}")


class TestMailboxesSearch:
    def test_search_returns_messages(self):
        res, http = _resource()
        http.get.return_value = CURSOR_PAGE_SEARCH
        uid = "aaaa1111-0000-0000-0000-000000000001"

        results = res.search(uid, q="invoice")

        http.get.assert_called_once_with(
            f"/mailboxes/{uid}/search",
            params={"q": "invoice", "limit": 50},
        )
        assert len(results) == 1
        assert results[0].subject == "Hello from test"

    def test_search_with_custom_limit(self):
        res, http = _resource()
        http.get.return_value = {"items": [], "next_cursor": None, "has_more": False}
        uid = "aaaa1111-0000-0000-0000-000000000001"

        results = res.search(uid, q="test", limit=10)

        http.get.assert_called_once_with(
            f"/mailboxes/{uid}/search",
            params={"q": "test", "limit": 10},
        )
        assert results == []

"""
sdk/python/tests/test_mail_mailboxes.py

Tests for MailboxesResource. Mailbox create/delete are gone (cascade
via identity), and PATCH no longer accepts display_name.
"""

from unittest.mock import MagicMock
from uuid import UUID

from sample_data_mail import MAILBOX_DICT, CURSOR_PAGE_SEARCH
from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.types import FilterMode


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
        assert mailbox.agent_identity_id is not None


class TestMailboxParseSendingDomain:
    def test_reads_sending_domain(self):
        res, http = _resource()
        http.get.return_value = {**MAILBOX_DICT, "sending_domain": "mail.acme.com"}

        mailbox = res.get("agent01@inkbox.ai")

        assert mailbox.sending_domain == "mail.acme.com"

    def test_falls_back_to_email_address_split(self):
        res, http = _resource()
        d = {**MAILBOX_DICT}
        d.pop("sending_domain")
        http.get.return_value = d

        mailbox = res.get("agent01@inkbox.ai")

        assert mailbox.sending_domain == "inkbox.ai"


class TestMailboxesUpdate:
    def test_update_filter_mode(self):
        res, http = _resource()
        http.patch.return_value = MAILBOX_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        res.update(uid, filter_mode=FilterMode.WHITELIST)

        http.patch.assert_called_once_with(
            f"/mailboxes/{uid}",
            json={"filter_mode": "whitelist"},
        )

    def test_update_omits_none_fields(self):
        res, http = _resource()
        http.patch.return_value = MAILBOX_DICT
        uid = "aaaa1111-0000-0000-0000-000000000001"

        res.update(uid)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {}


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

"""
sdk/python/tests/test_filter_mode_and_threads.py

Tests for FilterMode wiring on mailboxes/numbers and new thread methods.
"""

from unittest.mock import MagicMock

import pytest

from inkbox.mail.resources.mailboxes import MailboxesResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.mail.types import (
    FilterMode,
    FilterModeChangeNotice,
    Mailbox,
    Thread,
    ThreadFolder,
)
from inkbox.phone.resources.numbers import PhoneNumbersResource
from inkbox.phone.types import PhoneNumber
from sample_data import PHONE_NUMBER_DICT
from sample_data_mail import MAILBOX_DICT, THREAD_DICT


CHANGE_NOTICE = {
    "new_filter_mode": "whitelist",
    "redundant_rule_action": "block",
    "redundant_rule_count": 3,
}


@pytest.fixture
def transport():
    t = MagicMock()
    t.get = MagicMock()
    t.post = MagicMock()
    t.patch = MagicMock()
    t.delete = MagicMock()
    return t


class TestMailboxFilterMode:
    def test_parse_defaults_to_blacklist_when_missing(self):
        mb = Mailbox._from_dict(MAILBOX_DICT)
        assert mb.filter_mode == FilterMode.BLACKLIST
        assert mb.filter_mode_change_notice is None

    def test_parse_honors_server_value(self):
        mb = Mailbox._from_dict({**MAILBOX_DICT, "filter_mode": "whitelist"})
        assert mb.filter_mode == FilterMode.WHITELIST

    def test_parse_change_notice(self):
        mb = Mailbox._from_dict(
            {
                **MAILBOX_DICT,
                "filter_mode": "whitelist",
                "filter_mode_change_notice": CHANGE_NOTICE,
            },
        )
        assert isinstance(mb.filter_mode_change_notice, FilterModeChangeNotice)
        assert mb.filter_mode_change_notice.new_filter_mode == FilterMode.WHITELIST
        assert mb.filter_mode_change_notice.redundant_rule_action == "block"
        assert mb.filter_mode_change_notice.redundant_rule_count == 3

    def test_update_sends_filter_mode_enum(self, transport):
        transport.patch.return_value = {**MAILBOX_DICT, "filter_mode": "whitelist"}
        resource = MailboxesResource(transport)

        resource.update("box@inkbox.ai", filter_mode=FilterMode.WHITELIST)

        transport.patch.assert_called_once_with(
            "/mailboxes/box@inkbox.ai",
            json={"filter_mode": "whitelist"},
        )

    def test_update_without_filter_mode_omits_field(self, transport):
        transport.patch.return_value = MAILBOX_DICT
        resource = MailboxesResource(transport)

        resource.update("box@inkbox.ai", display_name="New")

        _, kwargs = transport.patch.call_args
        assert "filter_mode" not in kwargs["json"]


class TestPhoneNumberFilterMode:
    def test_parse_defaults_to_blacklist(self):
        pn = PhoneNumber._from_dict(PHONE_NUMBER_DICT)
        assert pn.filter_mode == FilterMode.BLACKLIST

    def test_update_sends_filter_mode(self, transport):
        transport.patch.return_value = {**PHONE_NUMBER_DICT, "filter_mode": "whitelist"}
        resource = PhoneNumbersResource(transport)

        pid = "aaaa1111-0000-0000-0000-000000000001"
        resource.update(pid, filter_mode="whitelist")

        transport.patch.assert_called_once_with(
            f"/numbers/{pid}",
            json={"filter_mode": "whitelist"},
        )


class TestThreadsList:
    def test_list_without_folder_does_not_send_folder_param(self, transport):
        transport.get.return_value = {
            "items": [THREAD_DICT],
            "next_cursor": None,
            "has_more": False,
        }
        resource = ThreadsResource(transport)

        list(resource.list("box@inkbox.ai"))

        _, kwargs = transport.get.call_args
        assert "folder" not in kwargs["params"]

    def test_list_with_folder_enum(self, transport):
        transport.get.return_value = {
            "items": [],
            "next_cursor": None,
            "has_more": False,
        }
        resource = ThreadsResource(transport)

        list(resource.list("box@inkbox.ai", folder=ThreadFolder.BLOCKED))

        _, kwargs = transport.get.call_args
        assert kwargs["params"]["folder"] == "blocked"


class TestThreadsListFolders:
    def test_list_folders_returns_folder_enum_list(self, transport):
        transport.get.return_value = ["inbox", "spam", "blocked"]
        resource = ThreadsResource(transport)

        result = resource.list_folders("box@inkbox.ai")

        transport.get.assert_called_once_with(
            "/mailboxes/box@inkbox.ai/threads/folders",
        )
        assert result == [ThreadFolder.INBOX, ThreadFolder.SPAM, ThreadFolder.BLOCKED]

    def test_list_folders_empty(self, transport):
        transport.get.return_value = []
        resource = ThreadsResource(transport)

        assert resource.list_folders("box@inkbox.ai") == []


class TestThreadsUpdate:
    def test_update_folder_returns_bare_thread(self, transport):
        # Server returns ThreadResponse (no `messages`), so update() must
        # parse as `Thread`, not `ThreadDetail`.
        transport.patch.return_value = {**THREAD_DICT, "folder": "archive"}
        resource = ThreadsResource(transport)
        tid = "eeee5555-0000-0000-0000-000000000001"

        result = resource.update("box@inkbox.ai", tid, folder=ThreadFolder.ARCHIVE)

        transport.patch.assert_called_once_with(
            f"/mailboxes/box@inkbox.ai/threads/{tid}",
            json={"folder": "archive"},
        )
        assert type(result) is Thread
        assert result.folder == ThreadFolder.ARCHIVE
        # Bare Thread has no `messages` attr — this guards against regression
        # where the SDK falsely reports every update zeroing the thread.
        assert not hasattr(result, "messages")

    def test_update_blocked_rejects_client_side(self, transport):
        resource = ThreadsResource(transport)
        tid = "eeee5555-0000-0000-0000-000000000001"

        with pytest.raises(ValueError):
            resource.update("box@inkbox.ai", tid, folder=ThreadFolder.BLOCKED)

        transport.patch.assert_not_called()

"""Tests for AgentIdentity convenience methods."""

import pytest
from unittest.mock import MagicMock

from sample_data_identities import IDENTITY_DETAIL_DICT
from sample_data_mail import MESSAGE_DETAIL_DICT, THREAD_DETAIL_DICT

from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import _AgentIdentityData
from inkbox.mail.exceptions import InkboxError
from inkbox.mail.types import MessageDetail, ThreadDetail


def _identity_with_mailbox():
    """Return an AgentIdentity backed by a mock Inkbox client."""
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_mailbox():
    """Return an AgentIdentity with no mailbox assigned."""
    detail = {**IDENTITY_DETAIL_DICT, "mailbox": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityGetMessage:
    def test_get_message_returns_message_detail(self):
        identity, inkbox = _identity_with_mailbox()
        message_id = MESSAGE_DETAIL_DICT["id"]
        inkbox._messages.get.return_value = MessageDetail._from_dict(MESSAGE_DETAIL_DICT)

        result = identity.get_message(message_id)

        inkbox._messages.get.assert_called_once_with("sales-agent@inkbox.ai", message_id)
        assert isinstance(result, MessageDetail)
        assert str(result.id) == message_id
        assert result.body_text == "Hi there, this is a test message body."

    def test_get_message_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="no mailbox assigned"):
            identity.get_message("bbbb2222-0000-0000-0000-000000000001")


class TestAgentIdentityGetThread:
    def test_get_thread_returns_thread_detail(self):
        identity, inkbox = _identity_with_mailbox()
        thread_id = THREAD_DETAIL_DICT["id"]
        inkbox._threads.get.return_value = ThreadDetail._from_dict(THREAD_DETAIL_DICT)

        result = identity.get_thread(thread_id)

        inkbox._threads.get.assert_called_once_with("sales-agent@inkbox.ai", thread_id)
        assert isinstance(result, ThreadDetail)
        assert str(result.id) == thread_id
        assert len(result.messages) == 1

    def test_get_thread_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="no mailbox assigned"):
            identity.get_thread("eeee5555-0000-0000-0000-000000000001")

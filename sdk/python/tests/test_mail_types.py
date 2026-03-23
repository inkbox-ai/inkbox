"""
sdk/python/tests/test_mail_types.py

Tests for mail type parsing.
"""

from datetime import datetime
from uuid import UUID

from sample_data_mail import (
    MAILBOX_DICT,
    MESSAGE_DICT,
    MESSAGE_DETAIL_DICT,
    THREAD_DICT,
    THREAD_DETAIL_DICT,
)
from inkbox.mail.types import (
    Mailbox,
    Message,
    MessageDetail,
    Thread,
    ThreadDetail,
)


class TestMailboxParsing:
    def test_from_dict(self):
        m = Mailbox._from_dict(MAILBOX_DICT)

        assert isinstance(m.id, UUID)
        assert m.email_address == "agent01@inkbox.ai"
        assert m.display_name == "Agent 01"
        assert m.status == "active"
        assert isinstance(m.created_at, datetime)
        assert isinstance(m.updated_at, datetime)


class TestMessageParsing:
    def test_from_dict(self):
        m = Message._from_dict(MESSAGE_DICT)

        assert isinstance(m.id, UUID)
        assert isinstance(m.mailbox_id, UUID)
        assert m.thread_id == UUID("eeee5555-0000-0000-0000-000000000001")
        assert m.message_id == "<abc123@mail.gmail.com>"
        assert m.from_address == "user@example.com"
        assert m.to_addresses == ["agent01@inkbox.ai"]
        assert m.cc_addresses is None
        assert m.subject == "Hello from test"
        assert m.direction == "inbound"
        assert m.is_read is False
        assert m.is_starred is False
        assert m.has_attachments is False
        assert isinstance(m.created_at, datetime)

    def test_null_thread_id(self):
        d = {**MESSAGE_DICT, "thread_id": None}
        m = Message._from_dict(d)
        assert m.thread_id is None


class TestMessageDetailParsing:
    def test_from_dict(self):
        m = MessageDetail._from_dict(MESSAGE_DETAIL_DICT)

        assert m.body_text == "Hi there, this is a test message body."
        assert m.body_html == "<p>Hi there, this is a test message body.</p>"
        assert m.bcc_addresses is None
        assert m.in_reply_to is None
        assert m.references is None
        assert m.attachment_metadata is None
        assert m.ses_message_id == "ses-abc123"
        assert isinstance(m.updated_at, datetime)
        # inherits base fields
        assert m.from_address == "user@example.com"
        assert m.subject == "Hello from test"


class TestThreadParsing:
    def test_from_dict(self):
        t = Thread._from_dict(THREAD_DICT)

        assert isinstance(t.id, UUID)
        assert isinstance(t.mailbox_id, UUID)
        assert t.subject == "Hello from test"
        assert t.status == "active"
        assert t.message_count == 2
        assert isinstance(t.last_message_at, datetime)
        assert isinstance(t.created_at, datetime)


class TestThreadDetailParsing:
    def test_from_dict(self):
        t = ThreadDetail._from_dict(THREAD_DETAIL_DICT)

        assert t.subject == "Hello from test"
        assert len(t.messages) == 1
        assert isinstance(t.messages[0], Message)
        assert t.messages[0].from_address == "user@example.com"

    def test_empty_messages(self):
        d = {**THREAD_DICT, "messages": []}
        t = ThreadDetail._from_dict(d)
        assert t.messages == []



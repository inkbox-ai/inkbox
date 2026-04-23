"""
sdk/python/tests/test_mail_messages.py

Tests for MessagesResource.
"""

from unittest.mock import MagicMock

from sample_data_mail import (
    MESSAGE_DICT,
    MESSAGE_DETAIL_DICT,
    CURSOR_PAGE_MESSAGES,
    CURSOR_PAGE_MESSAGES_MULTI,
)
from inkbox.mail.resources.messages import MessagesResource
from inkbox.mail.types import ForwardMode


MBOX = "aaaa1111-0000-0000-0000-000000000001"
MSG = "bbbb2222-0000-0000-0000-000000000001"


def _resource():
    http = MagicMock()
    return MessagesResource(http), http


class TestMessagesList:
    def test_iterates_single_page(self):
        res, http = _resource()
        http.get.return_value = CURSOR_PAGE_MESSAGES

        messages = list(res.list(MBOX))

        assert len(messages) == 1
        assert messages[0].subject == "Hello from test"

    def test_iterates_multiple_pages(self):
        res, http = _resource()
        page2 = {"items": [MESSAGE_DICT], "next_cursor": None, "has_more": False}
        http.get.side_effect = [CURSOR_PAGE_MESSAGES_MULTI, page2]

        messages = list(res.list(MBOX))

        assert len(messages) == 2
        assert http.get.call_count == 2

    def test_empty_page(self):
        res, http = _resource()
        http.get.return_value = {"items": [], "next_cursor": None, "has_more": False}

        messages = list(res.list(MBOX))

        assert messages == []


class TestMessagesGet:
    def test_returns_message_detail(self):
        res, http = _resource()
        http.get.return_value = MESSAGE_DETAIL_DICT

        detail = res.get(MBOX, MSG)

        http.get.assert_called_once_with(f"/mailboxes/{MBOX}/messages/{MSG}")
        assert detail.body_text == "Hi there, this is a test message body."
        assert detail.ses_message_id == "ses-abc123"


class TestMessagesSend:
    def test_send_basic(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        msg = res.send(MBOX, to=["user@example.com"], subject="Test")

        http.post.assert_called_once_with(
            f"/mailboxes/{MBOX}/messages",
            json={
                "recipients": {"to": ["user@example.com"]},
                "subject": "Test",
            },
        )
        assert msg.subject == "Hello from test"

    def test_send_with_all_options(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        res.send(
            MBOX,
            to=["a@b.com"],
            subject="Re: test",
            body_text="reply text",
            body_html="<p>reply</p>",
            cc=["cc@b.com"],
            bcc=["bcc@b.com"],
            in_reply_to_message_id="<orig@mail.com>",
            attachments=[{"filename": "f.txt", "content_type": "text/plain", "content_base64": "aGk="}],
        )

        _, kwargs = http.post.call_args
        body = kwargs["json"]
        assert body["recipients"] == {"to": ["a@b.com"], "cc": ["cc@b.com"], "bcc": ["bcc@b.com"]}
        assert body["body_text"] == "reply text"
        assert body["body_html"] == "<p>reply</p>"
        assert body["in_reply_to_message_id"] == "<orig@mail.com>"
        assert body["attachments"] == [{"filename": "f.txt", "content_type": "text/plain", "content_base64": "aGk="}]

    def test_optional_fields_omitted(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        res.send(MBOX, to=["a@b.com"], subject="Test")

        _, kwargs = http.post.call_args
        body = kwargs["json"]
        assert "body_text" not in body
        assert "body_html" not in body
        assert "cc" not in body["recipients"]
        assert "bcc" not in body["recipients"]
        assert "in_reply_to_message_id" not in body
        assert "attachments" not in body


class TestMessagesForward:
    def test_forward_basic(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        msg = res.forward(MBOX, MSG, to=["fwd@example.com"])

        http.post.assert_called_once_with(
            f"/mailboxes/{MBOX}/messages/{MSG}/forward",
            json={
                "recipients": {"to": ["fwd@example.com"]},
                "mode": "inline",
                "include_original_attachments": True,
            },
        )
        assert msg.subject == "Hello from test"

    def test_forward_wrapped_with_all_options(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        res.forward(
            MBOX,
            MSG,
            to=["a@b.com"],
            cc=["cc@b.com"],
            bcc=["bcc@b.com"],
            mode=ForwardMode.WRAPPED,
            subject="Fwd: see this",
            body_text="FYI",
            body_html="<p>FYI</p>",
            additional_attachments=[
                {"filename": "n.txt", "content_type": "text/plain", "content_base64": "aGk="}
            ],
            include_original_attachments=False,
            reply_to="me@b.com",
        )

        _, kwargs = http.post.call_args
        body = kwargs["json"]
        assert body["recipients"] == {
            "to": ["a@b.com"],
            "cc": ["cc@b.com"],
            "bcc": ["bcc@b.com"],
        }
        assert body["mode"] == "wrapped"
        assert body["subject"] == "Fwd: see this"
        assert body["body_text"] == "FYI"
        assert body["body_html"] == "<p>FYI</p>"
        assert body["additional_attachments"] == [
            {"filename": "n.txt", "content_type": "text/plain", "content_base64": "aGk="}
        ]
        assert body["include_original_attachments"] is False
        assert body["reply_to"] == "me@b.com"

    def test_forward_accepts_string_mode(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        res.forward(MBOX, MSG, to=["a@b.com"], mode="wrapped")

        _, kwargs = http.post.call_args
        assert kwargs["json"]["mode"] == "wrapped"

    def test_forward_optional_fields_omitted(self):
        res, http = _resource()
        http.post.return_value = MESSAGE_DICT

        res.forward(MBOX, MSG, to=["a@b.com"])

        _, kwargs = http.post.call_args
        body = kwargs["json"]
        assert "subject" not in body
        assert "body_text" not in body
        assert "body_html" not in body
        assert "additional_attachments" not in body
        assert "reply_to" not in body
        assert "cc" not in body["recipients"]
        assert "bcc" not in body["recipients"]


class TestMessagesUpdateFlags:
    def test_mark_read(self):
        res, http = _resource()
        http.patch.return_value = {**MESSAGE_DICT, "is_read": True}

        msg = res.mark_read(MBOX, MSG)

        http.patch.assert_called_once_with(
            f"/mailboxes/{MBOX}/messages/{MSG}",
            json={"is_read": True},
        )
        assert msg.is_read is True

    def test_mark_unread(self):
        res, http = _resource()
        http.patch.return_value = MESSAGE_DICT

        res.mark_unread(MBOX, MSG)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {"is_read": False}

    def test_star(self):
        res, http = _resource()
        http.patch.return_value = {**MESSAGE_DICT, "is_starred": True}

        res.star(MBOX, MSG)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {"is_starred": True}

    def test_unstar(self):
        res, http = _resource()
        http.patch.return_value = MESSAGE_DICT

        res.unstar(MBOX, MSG)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {"is_starred": False}

    def test_update_both_flags(self):
        res, http = _resource()
        http.patch.return_value = MESSAGE_DICT

        res.update_flags(MBOX, MSG, is_read=True, is_starred=True)

        _, kwargs = http.patch.call_args
        assert kwargs["json"] == {"is_read": True, "is_starred": True}


class TestMessagesDelete:
    def test_deletes_message(self):
        res, http = _resource()

        res.delete(MBOX, MSG)

        http.delete.assert_called_once_with(f"/mailboxes/{MBOX}/messages/{MSG}")

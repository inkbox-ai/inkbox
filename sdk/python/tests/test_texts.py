"""
sdk/python/tests/test_texts.py

Tests for TextsResource.
"""

from uuid import UUID

from sample_data import (
    TEXT_CONVERSATION_SUMMARY_DICT,
    TEXT_MESSAGE_DICT,
    TEXT_MESSAGE_MMS_DICT,
    TEXT_MESSAGE_OUTBOUND_QUEUED_DICT,
)
from inkbox.phone.types import SmsDeliveryStatus, TextMessageOrigin


NUM_ID = "aaaa1111-0000-0000-0000-000000000001"
TEXT_ID = "dddd4444-0000-0000-0000-000000000001"
REMOTE = "+15167251294"


class TestTextsSend:
    def test_posts_to_correct_path(self, client, transport):
        transport.post.return_value = TEXT_MESSAGE_OUTBOUND_QUEUED_DICT

        client._texts.send(NUM_ID, to="+15551234567", text="Hello")

        transport.post.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts",
            json={"to": "+15551234567", "text": "Hello"},
        )

    def test_returns_parsed_text_with_lifecycle_fields(self, client, transport):
        transport.post.return_value = TEXT_MESSAGE_OUTBOUND_QUEUED_DICT

        msg = client._texts.send(NUM_ID, to="+15167251294", text="Hello from Inkbox")

        assert msg.direction == "outbound"
        assert msg.delivery_status is SmsDeliveryStatus.QUEUED
        assert msg.origin is TextMessageOrigin.USER_INITIATED
        # Lifecycle timestamps haven't been stamped yet on a queued send.
        assert msg.sent_at is None
        assert msg.delivered_at is None
        assert msg.failed_at is None


class TestTextsList:
    def test_returns_texts(self, client, transport):
        transport.get.return_value = [TEXT_MESSAGE_DICT]

        texts = client._texts.list(NUM_ID, limit=10)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts",
            params={"limit": 10, "offset": 0},
        )
        assert len(texts) == 1
        assert texts[0].direction == "inbound"
        assert texts[0].remote_phone_number == REMOTE
        assert texts[0].text == "Hello, is this support?"
        assert texts[0].is_read is False

    def test_default_params(self, client, transport):
        transport.get.return_value = []

        client._texts.list(NUM_ID)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts",
            params={"limit": 50, "offset": 0},
        )

    def test_is_read_filter(self, client, transport):
        transport.get.return_value = []

        client._texts.list(NUM_ID, is_read=False)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts",
            params={"limit": 50, "offset": 0, "is_read": False},
        )

    def test_mms_with_media(self, client, transport):
        transport.get.return_value = [TEXT_MESSAGE_MMS_DICT]

        texts = client._texts.list(NUM_ID)

        assert texts[0].type == "mms"
        assert texts[0].media is not None
        assert len(texts[0].media) == 1
        assert texts[0].media[0].content_type == "image/jpeg"
        assert texts[0].media[0].size == 534972


class TestTextsGet:
    def test_returns_text(self, client, transport):
        transport.get.return_value = TEXT_MESSAGE_DICT

        text = client._texts.get(NUM_ID, TEXT_ID)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/{TEXT_ID}"
        )
        assert text.id == UUID(TEXT_ID)


class TestTextsUpdate:
    def test_mark_read(self, client, transport):
        transport.patch.return_value = {**TEXT_MESSAGE_DICT, "is_read": True}

        text = client._texts.update(NUM_ID, TEXT_ID, is_read=True)

        transport.patch.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/{TEXT_ID}",
            json={"is_read": True},
        )
        assert text.is_read is True

    def test_empty_body_when_no_fields(self, client, transport):
        transport.patch.return_value = TEXT_MESSAGE_DICT

        client._texts.update(NUM_ID, TEXT_ID)

        _, kwargs = transport.patch.call_args
        assert kwargs["json"] == {}


class TestTextsSearch:
    def test_search(self, client, transport):
        transport.get.return_value = [TEXT_MESSAGE_DICT]

        results = client._texts.search(NUM_ID, q="support", limit=10)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/search",
            params={"q": "support", "limit": 10},
        )
        assert len(results) == 1


class TestTextsListConversations:
    def test_returns_summaries(self, client, transport):
        transport.get.return_value = [TEXT_CONVERSATION_SUMMARY_DICT]

        convos = client._texts.list_conversations(NUM_ID)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/conversations",
            params={"limit": 50, "offset": 0},
        )
        assert len(convos) == 1
        assert convos[0].remote_phone_number == REMOTE
        assert convos[0].unread_count == 3
        assert convos[0].total_count == 15
        assert convos[0].latest_direction == "inbound"


class TestTextsGetConversation:
    def test_returns_messages(self, client, transport):
        transport.get.return_value = [TEXT_MESSAGE_DICT]

        msgs = client._texts.get_conversation(NUM_ID, REMOTE, limit=20)

        transport.get.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/conversations/{REMOTE}",
            params={"limit": 20, "offset": 0},
        )
        assert len(msgs) == 1


class TestTextsUpdateConversation:
    def test_mark_conversation_read(self, client, transport):
        transport.patch.return_value = {
            "remote_phone_number": REMOTE,
            "is_read": True,
            "updated_count": 5,
        }

        result = client._texts.update_conversation(NUM_ID, REMOTE, is_read=True)

        transport.patch.assert_called_once_with(
            f"/numbers/{NUM_ID}/texts/conversations/{REMOTE}",
            json={"is_read": True},
        )
        assert result["updated_count"] == 5

"""
sdk/python/tests/test_imessage.py

Tests for IMessagesResource and IMessageContactRulesResource.
"""

from uuid import UUID

from inkbox.imessage.types import (
    IMessageDeliveryStatus,
    IMessageReactionType,
    IMessageRuleAction,
    IMessageRuleMatchType,
    IMessageSendStyle,
    IMessageService,
)
from inkbox.mail.types import ContactRuleStatus


CONVO_ID = "cccc1111-0000-0000-0000-000000000001"
MSG_ID = "dddd4444-0000-0000-0000-000000000001"
IDENTITY_ID = "eeee5555-0000-0000-0000-000000000001"
RULE_ID = "ffff6666-0000-0000-0000-000000000001"
REMOTE = "+15551234567"
HANDLE = "support-bot"

IMESSAGE_DICT = {
    "id": MSG_ID,
    "conversation_id": CONVO_ID,
    "assignment_id": "bbbb2222-0000-0000-0000-000000000001",
    "direction": "outbound",
    "remote_number": REMOTE,
    "content": "Hello over iMessage",
    "message_type": "message",
    "service": "imessage",
    "send_style": None,
    "media": None,
    "was_downgraded": False,
    "status": "queued",
    "error_code": None,
    "error_message": None,
    "error_reason": None,
    "error_detail": None,
    "is_read": False,
    "is_blocked": False,
    "recipients": [
        {
            "remote_number": REMOTE,
            "delivery_status": "queued",
            "service": "imessage",
        },
    ],
    "reactions": [
        {
            "id": "aaaa8888-0000-0000-0000-000000000001",
            "direction": "inbound",
            "reaction": "custom",
            "custom_emoji": "\U0001f334",
            "remote_number": REMOTE,
            "part_index": 0,
            "created_at": "2026-06-01T00:01:00+00:00",
        },
    ],
    "created_at": "2026-06-01T00:00:00+00:00",
    "updated_at": "2026-06-01T00:00:00+00:00",
}

IMESSAGE_CONVERSATION_DICT = {
    "id": CONVO_ID,
    "assignment_id": "bbbb2222-0000-0000-0000-000000000001",
    "remote_number": REMOTE,
    "created_at": "2026-06-01T00:00:00+00:00",
    "updated_at": "2026-06-01T00:00:00+00:00",
}

IMESSAGE_CONVERSATION_SUMMARY_DICT = {
    **IMESSAGE_CONVERSATION_DICT,
    "latest_text": "Hello over iMessage",
    "latest_message_at": "2026-06-01T00:00:00+00:00",
    "latest_direction": "outbound",
    "latest_has_media": False,
    "unread_count": 2,
    "total_count": 5,
}

IMESSAGE_REACTION_DICT = {
    "id": "aaaa7777-0000-0000-0000-000000000001",
    "conversation_id": CONVO_ID,
    "assignment_id": "bbbb2222-0000-0000-0000-000000000001",
    "target_message_id": MSG_ID,
    "direction": "outbound",
    "reaction": "like",
    "remote_number": REMOTE,
    "part_index": 0,
    "created_at": "2026-06-01T00:00:00+00:00",
    "updated_at": "2026-06-01T00:00:00+00:00",
}

IMESSAGE_CONTACT_RULE_DICT = {
    "id": RULE_ID,
    "agent_identity_id": IDENTITY_ID,
    "action": "block",
    "match_type": "exact_number",
    "match_target": REMOTE,
    "status": "active",
    "created_at": "2026-06-01T00:00:00+00:00",
    "updated_at": "2026-06-01T00:00:00+00:00",
}


class TestIMessagesSend:
    def test_posts_to_correct_path(self, client, transport):
        transport.post.return_value = {"message": IMESSAGE_DICT}

        client._imessages.send(to=REMOTE, text="Hello over iMessage")

        transport.post.assert_called_once_with(
            "/messages",
            json={"to": REMOTE, "text": "Hello over iMessage"},
            params=None,
        )

    def test_passes_identity_and_send_style(self, client, transport):
        transport.post.return_value = {"message": IMESSAGE_DICT}

        client._imessages.send(
            conversation_id=CONVO_ID,
            text="Hi",
            send_style=IMessageSendStyle.SLAM,
            agent_identity_id=IDENTITY_ID,
        )

        transport.post.assert_called_once_with(
            "/messages",
            json={
                "conversation_id": CONVO_ID,
                "text": "Hi",
                "send_style": "slam",
            },
            params={"agent_identity_id": IDENTITY_ID},
        )

    def test_returns_parsed_message(self, client, transport):
        transport.post.return_value = {"message": IMESSAGE_DICT}

        msg = client._imessages.send(to=REMOTE, text="Hello over iMessage")

        assert msg.id == UUID(MSG_ID)
        assert msg.direction == "outbound"
        assert msg.service is IMessageService.IMESSAGE
        assert msg.status is IMessageDeliveryStatus.QUEUED
        assert msg.recipients is not None
        assert msg.recipients[0].remote_number == REMOTE
        assert msg.recipients[0].delivery_status is IMessageDeliveryStatus.QUEUED
        assert msg.reactions is not None
        assert msg.reactions[0].reaction is IMessageReactionType.CUSTOM
        assert msg.reactions[0].custom_emoji == "\U0001f334"
        assert msg.reactions[0].direction == "inbound"


class TestIMessagesList:
    def test_gets_with_filters(self, client, transport):
        transport.get.return_value = [IMESSAGE_DICT]

        msgs = client._imessages.list(
            agent_identity_id=IDENTITY_ID,
            conversation_id=CONVO_ID,
            is_read=False,
        )

        transport.get.assert_called_once_with(
            "/messages",
            params={
                "limit": 50,
                "offset": 0,
                "agent_identity_id": IDENTITY_ID,
                "conversation_id": CONVO_ID,
                "is_read": False,
            },
        )
        assert len(msgs) == 1
        assert msgs[0].conversation_id == UUID(CONVO_ID)


class TestIMessageConversations:
    def test_lists_summaries(self, client, transport):
        transport.get.return_value = [IMESSAGE_CONVERSATION_SUMMARY_DICT]

        convos = client._imessages.list_conversations(is_blocked=False)

        transport.get.assert_called_once_with(
            "/conversations",
            params={"limit": 50, "offset": 0, "is_blocked": False},
        )
        assert convos[0].unread_count == 2
        assert convos[0].remote_number == REMOTE

    def test_gets_single_conversation(self, client, transport):
        transport.get.return_value = IMESSAGE_CONVERSATION_DICT

        convo = client._imessages.get_conversation(
            CONVO_ID, agent_identity_id=IDENTITY_ID,
        )

        transport.get.assert_called_once_with(
            f"/conversations/{CONVO_ID}",
            params={"agent_identity_id": IDENTITY_ID},
        )
        assert convo.id == UUID(CONVO_ID)


class TestIMessageActions:
    def test_send_reaction(self, client, transport):
        transport.post.return_value = IMESSAGE_REACTION_DICT

        reaction = client._imessages.send_reaction(
            message_id=MSG_ID,
            reaction=IMessageReactionType.LIKE,
        )

        transport.post.assert_called_once_with(
            "/reactions",
            json={"message_id": MSG_ID, "reaction": "like", "part_index": 0},
        )
        assert reaction.reaction is IMessageReactionType.LIKE
        assert reaction.target_message_id == UUID(MSG_ID)

    def test_mark_conversation_read(self, client, transport):
        transport.post.return_value = {
            "conversation_id": CONVO_ID,
            "updated_count": 3,
        }

        result = client._imessages.mark_conversation_read(CONVO_ID)

        transport.post.assert_called_once_with(
            "/mark-read",
            json={"conversation_id": CONVO_ID},
        )
        assert result.updated_count == 3

    def test_send_typing(self, client, transport):
        transport.post.return_value = {"status": "sent"}

        client._imessages.send_typing(CONVO_ID)

        transport.post.assert_called_once_with(
            "/typing",
            json={"conversation_id": CONVO_ID},
        )

    def test_upload_media(self, client, transport):
        transport.post_multipart.return_value = {
            "media_url": "https://media.example/abc.png",
            "content_type": "image/png",
            "size": 3,
        }

        upload = client._imessages.upload_media(
            content=b"abc",
            filename="abc.png",
            content_type="image/png",
        )

        transport.post_multipart.assert_called_once_with(
            "/media",
            field_name="file",
            filename="abc.png",
            content=b"abc",
            content_type="image/png",
        )
        assert upload.media_url == "https://media.example/abc.png"


class TestIMessageTriageNumber:
    def test_gets_triage_number(self, client, transport):
        transport.get.return_value = {
            "number": "+16467044388",
            "connect_command": "connect @support-bot",
        }

        triage = client._imessages.get_triage_number()

        transport.get.assert_called_once_with("/triage-number")
        assert triage.number == "+16467044388"
        assert triage.connect_command == "connect @support-bot"


class TestIMessageContactRules:
    def test_lists_rules_for_identity(self, client, transport):
        transport.get.return_value = [IMESSAGE_CONTACT_RULE_DICT]

        rules = client._imessage_contact_rules.list(
            HANDLE, action=IMessageRuleAction.BLOCK,
        )

        transport.get.assert_called_once_with(
            f"/identities/{HANDLE}/contact-rules",
            params={"action": "block"},
        )
        assert rules[0].match_type is IMessageRuleMatchType.EXACT_NUMBER
        assert rules[0].status is ContactRuleStatus.ACTIVE

    def test_creates_rule(self, client, transport):
        transport.post.return_value = IMESSAGE_CONTACT_RULE_DICT

        rule = client._imessage_contact_rules.create(
            HANDLE,
            action="block",
            match_target=REMOTE,
        )

        transport.post.assert_called_once_with(
            f"/identities/{HANDLE}/contact-rules",
            json={
                "action": "block",
                "match_type": "exact_number",
                "match_target": REMOTE,
            },
        )
        assert rule.action is IMessageRuleAction.BLOCK

    def test_updates_rule(self, client, transport):
        transport.patch.return_value = IMESSAGE_CONTACT_RULE_DICT

        client._imessage_contact_rules.update(
            HANDLE, RULE_ID, status=ContactRuleStatus.PAUSED,
        )

        transport.patch.assert_called_once_with(
            f"/identities/{HANDLE}/contact-rules/{RULE_ID}",
            json={"status": "paused"},
        )

    def test_deletes_rule(self, client, transport):
        client._imessage_contact_rules.delete(HANDLE, RULE_ID)

        transport.delete.assert_called_once_with(
            f"/identities/{HANDLE}/contact-rules/{RULE_ID}",
        )

    def test_org_wide_list(self, client, transport):
        transport.get.return_value = [IMESSAGE_CONTACT_RULE_DICT]

        client._imessage_contact_rules.list_all(agent_identity_id=IDENTITY_ID)

        transport.get.assert_called_once_with(
            "/contact-rules",
            params={"agent_identity_id": IDENTITY_ID},
        )

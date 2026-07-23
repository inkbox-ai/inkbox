"""
sdk/python/tests/test_imessage.py

Tests for IMessagesResource and IMessageContactRulesResource.
"""

from uuid import UUID

import pytest

from inkbox.imessage.types import (
    IMessageNumberStatus,
    IMessageNumberType,
    IMessageDeliveryStatus,
    IMessageGroupCreationStatus,
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
GROUP_REMOTE = "+15557654321"
HANDLE = "support-bot"

IMESSAGE_NUMBER_DICT = {
    "id": "99999999-0000-0000-0000-000000000001",
    "number": "+15551230001",
    "type": "dedicated_outbound",
    "status": "active",
    "agent_identity_id": IDENTITY_ID,
    "agent_handle": HANDLE,
}

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

GROUP_IMESSAGE_DICT = {
    **IMESSAGE_DICT,
    "assignment_id": None,
    "remote_number": None,
    "sender_number": REMOTE,
    "participants": [REMOTE, GROUP_REMOTE],
    "is_group": True,
    "recipients": [
        {"remote_number": REMOTE, "delivery_status": "queued", "service": "imessage"},
        {"remote_number": GROUP_REMOTE, "delivery_status": "queued", "service": "imessage"},
    ],
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

GROUP_CONVERSATION_DICT = {
    **IMESSAGE_CONVERSATION_DICT,
    "assignment_id": None,
    "assignment_status": None,
    "remote_number": None,
    "participants": [REMOTE, GROUP_REMOTE],
    "is_group": True,
    "group_creation_status": "creating",
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

GROUP_IMESSAGE_REACTION_DICT = {
    **IMESSAGE_REACTION_DICT,
    "assignment_id": None,
    "reaction": "eyes",
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

    def test_passes_media_and_send_style_by_conversation_id(self, client, transport):
        transport.post.return_value = {"message": IMESSAGE_DICT}

        client._imessages.send(
            conversation_id=CONVO_ID,
            text="Hi",
            media_urls=["https://media.example/reply.jpg"],
            send_style=IMessageSendStyle.SLAM,
            agent_identity_id=IDENTITY_ID,
        )

        transport.post.assert_called_once_with(
            "/messages",
            json={
                "conversation_id": CONVO_ID,
                "text": "Hi",
                "media_urls": ["https://media.example/reply.jpg"],
                "send_style": "slam",
            },
            params={"agent_identity_id": IDENTITY_ID},
        )

    def test_serializes_group_recipients_with_style_and_media(
        self, client, transport,
    ):
        response = {
            **GROUP_IMESSAGE_DICT,
            "send_style": "confetti",
            "media": [{"url": "https://media.example/group.jpg"}],
        }
        transport.post.return_value = {"message": response}

        msg = client._imessages.send(
            to=[REMOTE, GROUP_REMOTE],
            text="Hello group",
            media_urls=["https://media.example/group.jpg"],
            send_style=IMessageSendStyle.CONFETTI,
            agent_identity_id=IDENTITY_ID,
        )

        transport.post.assert_called_once_with(
            "/messages",
            json={
                "to": [REMOTE, GROUP_REMOTE],
                "text": "Hello group",
                "media_urls": ["https://media.example/group.jpg"],
                "send_style": "confetti",
            },
            params={"agent_identity_id": IDENTITY_ID},
        )
        assert msg.assignment_id is None
        assert msg.remote_number is None
        assert msg.sender_number == REMOTE
        assert msg.participants == [REMOTE, GROUP_REMOTE]
        assert msg.is_group is True
        assert msg.send_style is IMessageSendStyle.CONFETTI
        assert msg.media is not None
        assert msg.media[0].url == "https://media.example/group.jpg"
        assert len(msg.recipients or []) == 2

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


class TestIMessageNumbers:
    def test_lists_attached_and_unattached_numbers(self, client, transport):
        transport.get.return_value = [
            IMESSAGE_NUMBER_DICT,
            {
                **IMESSAGE_NUMBER_DICT,
                "id": "99999999-0000-0000-0000-000000000002",
                "type": "dedicated_inbound",
                "status": "paused",
                "agent_identity_id": None,
                "agent_handle": None,
            },
        ]

        numbers = client.imessages.list_numbers()

        transport.get.assert_called_once_with("/numbers")
        assert numbers[0].type is IMessageNumberType.DEDICATED_OUTBOUND
        assert numbers[0].status is IMessageNumberStatus.ACTIVE
        assert numbers[0].can_start_conversations is True
        assert numbers[0].agent_identity_id == UUID(IDENTITY_ID)
        assert numbers[1].type is IMessageNumberType.DEDICATED_INBOUND
        assert numbers[1].status is IMessageNumberStatus.PAUSED
        assert numbers[1].can_start_conversations is False
        assert numbers[1].agent_identity_id is None
        assert numbers[1].agent_handle is None

    @pytest.mark.parametrize("missing", ["agent_identity_id", "agent_handle"])
    def test_requires_nullable_attachment_fields(self, client, transport, missing):
        response = dict(IMESSAGE_NUMBER_DICT)
        response.pop(missing)
        transport.get.return_value = [response]

        with pytest.raises(KeyError, match=missing):
            client.imessages.list_numbers()

    def test_claims_number_with_enum(self, client, transport):
        transport.post.return_value = IMESSAGE_NUMBER_DICT

        number = client.imessages.claim_number(
            type=IMessageNumberType.DEDICATED_OUTBOUND,
            idempotency_key="claim-outbound-1",
        )

        transport.post.assert_called_once_with(
            "/numbers",
            json={"type": "dedicated_outbound"},
            headers={"Idempotency-Key": "claim-outbound-1"},
        )
        assert number.number == "+15551230001"

    def test_claims_number_with_string(self, client, transport):
        transport.post.return_value = {
            **IMESSAGE_NUMBER_DICT,
            "type": "dedicated_inbound",
        }

        number = client.imessages.claim_number(
            type="dedicated_inbound",
            idempotency_key="claim-inbound-1",
        )

        transport.post.assert_called_once_with(
            "/numbers",
            json={"type": "dedicated_inbound"},
            headers={"Idempotency-Key": "claim-inbound-1"},
        )
        assert number.can_start_conversations is False

    def test_rejects_non_dedicated_type(self, client, transport):
        with pytest.raises(ValueError):
            client.imessages.claim_number(
                type="shared_inbound",
                idempotency_key="claim-shared-1",
            )

        transport.post.assert_not_called()

    @pytest.mark.parametrize("key", ["", "x" * 256])
    def test_rejects_invalid_idempotency_key(self, client, transport, key):
        with pytest.raises(ValueError, match="between 1 and 255"):
            client.imessages.claim_number(
                type="dedicated_inbound",
                idempotency_key=key,
            )

        transport.post.assert_not_called()

    def test_reused_caller_key_is_sent_unchanged(self, client, transport):
        transport.post.return_value = IMESSAGE_NUMBER_DICT

        for _ in range(2):
            client.imessages.claim_number(
                type="dedicated_outbound",
                idempotency_key="stable-logical-operation",
            )

        assert transport.post.call_count == 2
        for call in transport.post.call_args_list:
            assert call.kwargs["headers"] == {
                "Idempotency-Key": "stable-logical-operation"
            }


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

    def test_includes_groups_only_when_requested(self, client, transport):
        transport.get.return_value = [GROUP_IMESSAGE_DICT]

        msgs = client._imessages.list(include_groups=True)

        transport.get.assert_called_once_with(
            "/messages",
            params={"limit": 50, "offset": 0, "include_groups": True},
        )
        assert msgs[0].is_group is True


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
        assert convos[0].group_creation_status is None

    def test_lists_group_summaries_with_nullable_assignment(self, client, transport):
        transport.get.return_value = [{
            **IMESSAGE_CONVERSATION_SUMMARY_DICT,
            **GROUP_CONVERSATION_DICT,
        }]

        convos = client._imessages.list_conversations(include_groups=True)

        transport.get.assert_called_once_with(
            "/conversations",
            params={"limit": 50, "offset": 0, "include_groups": True},
        )
        assert convos[0].assignment_id is None
        assert convos[0].assignment_status is None
        assert convos[0].remote_number is None
        assert convos[0].participants == [REMOTE, GROUP_REMOTE]
        assert convos[0].is_group is True
        assert convos[0].group_creation_status is IMessageGroupCreationStatus.CREATING

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

    def test_gets_group_conversation_without_list_opt_in(self, client, transport):
        transport.get.return_value = GROUP_CONVERSATION_DICT

        convo = client._imessages.get_conversation(CONVO_ID)

        transport.get.assert_called_once_with(
            f"/conversations/{CONVO_ID}", params={},
        )
        assert convo.is_group is True
        assert convo.assignment_id is None
        assert convo.group_creation_status is IMessageGroupCreationStatus.CREATING


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

    def test_send_group_reaction_preserves_request_and_parses_null_assignment(
        self, client, transport,
    ):
        transport.post.return_value = GROUP_IMESSAGE_REACTION_DICT

        reaction = client._imessages.send_reaction(
            message_id=MSG_ID,
            reaction=IMessageReactionType.EYES,
            part_index=1,
        )

        transport.post.assert_called_once_with(
            "/reactions",
            json={"message_id": MSG_ID, "reaction": "eyes", "part_index": 1},
        )
        assert reaction.assignment_id is None
        assert reaction.reaction is IMessageReactionType.EYES

    @pytest.mark.parametrize("reaction", [IMessageReactionType.CUSTOM, "\U0001f440"])
    def test_send_reaction_rejects_inbound_only_or_arbitrary_values(
        self, client, transport, reaction,
    ):
        with pytest.raises(ValueError, match="reaction must be one of"):
            client._imessages.send_reaction(message_id=MSG_ID, reaction=reaction)

        transport.post.assert_not_called()

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
            "number": "+15555550100",
            "connect_command": "connect @support-bot",
        }

        triage = client._imessages.get_triage_number()

        transport.get.assert_called_once_with("/triage-number")
        assert triage.number == "+15555550100"
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


class TestIMessageAssignments:
    def test_lists_active_assignments(self, client, transport):
        from inkbox.imessage.types import IMessageAssignmentStatus

        transport.get.return_value = [
            {
                "id": "bbbb2222-0000-0000-0000-000000000001",
                "remote_number": REMOTE,
                "agent_identity_id": IDENTITY_ID,
                "organization_id": "org_x",
                "status": "active",
                "released_at": None,
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-01T00:00:00+00:00",
            },
        ]

        rows = client._imessages.list_assignments(
            agent_identity_id=IDENTITY_ID, limit=25, offset=50,
        )

        transport.get.assert_called_once_with(
            "/assignments",
            params={"limit": 25, "offset": 50, "agent_identity_id": IDENTITY_ID},
        )
        assert rows[0].status is IMessageAssignmentStatus.ACTIVE
        assert rows[0].remote_number == REMOTE
        assert rows[0].released_at is None


class TestConversationAssignmentStatus:
    def test_parses_assignment_status(self, client, transport):
        from inkbox.imessage.types import IMessageAssignmentStatus

        transport.get.return_value = {**IMESSAGE_CONVERSATION_DICT, "assignment_status": "released"}

        convo = client._imessages.get_conversation(CONVO_ID)

        assert convo.assignment_status is IMessageAssignmentStatus.RELEASED

    def test_defaults_assignment_status_when_absent(self, client, transport):
        from inkbox.imessage.types import IMessageAssignmentStatus

        transport.get.return_value = [IMESSAGE_CONVERSATION_SUMMARY_DICT]

        convos = client._imessages.list_conversations()

        assert convos[0].assignment_status is IMessageAssignmentStatus.ACTIVE

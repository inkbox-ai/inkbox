"""Existing group metadata and commands share the normal WhatsApp contract."""
import json
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from inkbox.whatsapp import WhatsAppConversation, WhatsAppConversationSummary, WhatsAppMessage, WhatsAppResource

ROOT = Path(__file__).parents[3] / "tests/fixtures"
GROUP = json.loads((ROOT / "whatsapp-groups.json").read_text(encoding="utf-8"))
DIRECT = json.loads((ROOT / "whatsapp.json").read_text(encoding="utf-8"))


def test_group_and_legacy_metadata_remain_distinct():
    for cls, key in [(WhatsAppMessage, "message"), (WhatsAppConversation, "conversation"), (WhatsAppConversationSummary, "summary")]:
        group = cls._from_dict(GROUP[key])
        assert group.is_group and group.group_name == "Project garden"
        assert group.remote_number is None and group.unresolved_participant_count == 0
        legacy = cls._from_dict(DIRECT["conversation_summary" if key == "summary" else key])
        assert not legacy.is_group and legacy.group_name is None and legacy.unresolved_participant_count == 0
    outgoing = WhatsAppMessage._from_dict(GROUP["message"])
    assert outgoing.sender_number == outgoing.local_number and outgoing.recipients == []
    blocked = WhatsAppMessage._from_dict(GROUP["blocked_inbound_message"])
    assert blocked.direction == "inbound" and blocked.is_blocked
    assert blocked.sender_number is None and blocked.unresolved_participant_count == 1


def test_group_quote_media_and_reaction_use_stable_ids():
    http = MagicMock()
    http.post.return_value = {"message": GROUP["message"]}
    api = WhatsAppResource(http)
    result = api.send(**GROUP["send"], idempotency_key="group-quote")
    assert result.is_group
    assert http.post.call_args.kwargs["json"] == GROUP["send"]
    assert http.post.call_args.kwargs["headers"]["Idempotency-Key"] == "group-quote"
    http.post.return_value = {"reaction": GROUP["reaction"]}
    api.send_reaction(message_id=GROUP["message"]["id"], reaction="like", idempotency_key="group-reaction")
    assert http.post.call_args.kwargs["json"] == {"message_id": GROUP["message"]["id"], "reaction": "like"}


def test_animation_requires_media_and_false_does_not_change_wire():
    http = MagicMock()
    api = WhatsAppResource(http)
    for value in [True, "true", 1]:
        with pytest.raises(ValueError):
            api.send(conversation_id=GROUP["conversation"]["id"], text="hello", gif_playback=value)
    http.post.assert_not_called()
    http.post.return_value = {"message": GROUP["message"]}
    api.send(conversation_id=GROUP["conversation"]["id"], text="hello", gif_playback=False)
    assert "gif_playback" not in http.post.call_args.kwargs["json"]


@pytest.mark.parametrize("value, expected", [(True, True), (False, False), (None, False), ("true", False), (1, False)])
def test_native_agent_mention_requires_boolean_evidence(value, expected):
    assert WhatsAppMessage._from_dict({**GROUP["message"], "agent_mentioned": value}).agent_mentioned is expected
    assert WhatsAppMessage._from_dict(GROUP["message"]).agent_mentioned is False


def test_structured_mentions_preserve_unresolved_identity_without_guessing():
    mentions = [{"text": "@123456789", "phone_number": None, "is_agent": False},
                {"text": "@15550000002", "phone_number": "+15550000002", "is_agent": True}]
    parsed = WhatsAppMessage._from_dict({**GROUP["message"], "mentions": mentions})
    assert parsed.mentions[0].text == "@123456789" and parsed.mentions[0].phone_number is None
    assert not parsed.mentions[0].is_agent and parsed.mentions[1].is_agent
    assert parsed.mentions[1].phone_number == "+15550000002"
    assert WhatsAppMessage._from_dict(GROUP["message"]).mentions == []

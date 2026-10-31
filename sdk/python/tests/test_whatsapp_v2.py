"""Shared group, quote-chain and versioned reaction wire contracts."""

import json
from pathlib import Path
from unittest.mock import MagicMock
from uuid import UUID
import pytest
from inkbox.whatsapp import (
    WhatsAppResource,
    WhatsAppMessage,
    WhatsAppConversation,
    WhatsAppReactionStatus,
)

F = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/whatsapp-v2.json").read_text(encoding="utf-8")
)
OLD = json.loads(
    (Path(__file__).parents[3] / "tests/fixtures/whatsapp.json").read_text(encoding="utf-8")
)


@pytest.mark.parametrize("item", F["send_cases"], ids=lambda item: item["name"])
def test_shared_send_vectors_preserve_body_and_key(item):
    http = MagicMock()
    http.post.return_value = {"message": F["message"]}
    if item["valid"]:
        WhatsAppResource(http).send(**item["body"], idempotency_key=item["name"])
        assert http.post.call_args.kwargs["json"] == item["body"]
        assert http.post.call_args.kwargs["headers"]["Idempotency-Key"] == item["name"]
    else:
        with pytest.raises(ValueError):
            WhatsAppResource(http).send(**item["body"], idempotency_key=item["name"])
        http.post.assert_not_called()


def test_projections_preserve_uncertainty_and_do_not_invent_legacy_quotes():
    message = WhatsAppMessage._from_dict(F["message"])
    assert str(message.reply_to_message_id) == F["message"]["reply_to_message_id"]
    assert message.reactions[0].emoji == F["named_emoji"]["love"]
    legacy = WhatsAppMessage._from_dict(OLD["message"])
    assert (
        legacy.reply_to_message_id is None
        and legacy.thread_id is None
        and legacy.reactions == []
    )
    group = WhatsAppConversation._from_dict(F["conversation"])
    assert (
        group.group_creation_status == "uncertain"
        and group.unresolved_participant_count == 1
    )


def test_both_thread_routes_keep_chronological_envelope_and_cursor():
    http = MagicMock()
    http.get.return_value = F["thread"]
    resource = WhatsAppResource(http)
    for run in (
        lambda: resource.get_thread(
            F["message"]["id"], limit=1, cursor="opaque+/cursor="
        ),
        lambda: resource.get_conversation_thread(
            F["thread"]["conversation_id"],
            F["thread"]["thread_id"],
            limit=200,
            cursor="opaque+/cursor=",
        ),
    ):
        page = run()
        assert [str(m.id) for m in page.messages] == [
            m["id"] for m in F["thread"]["messages"]
        ]
        assert page.next_cursor == F["thread"]["next_cursor"]
        assert http.get.call_args.kwargs["params"]["cursor"] == "opaque+/cursor="
    assert http.get.call_args.args[0].endswith(f"/threads/{F['thread']['thread_id']}")
    for limit in (0, 201, True):
        with pytest.raises(ValueError):
            resource.get_thread(F["message"]["id"], limit=limit)


def test_reaction_and_removal_return_receipts_not_live_state():
    http = MagicMock()
    http.post.return_value = {
        "reaction": F["uncertain_reaction"] | {"remote_number": None}
    }
    resource = WhatsAppResource(http)
    result = resource.send_reaction(
        message_id=F["message"]["id"],
        custom_emoji="👨‍👩‍👧‍👦",
        idempotency_key="original",
        agent_identity_id=F["message"]["agent_identity_id"],
    )
    assert (
        result.status == WhatsAppReactionStatus.UNCERTAIN
        and result.remote_number is None
    )
    assert http.post.call_args.kwargs["json"] == {
        "message_id": F["message"]["id"],
        "custom_emoji": "👨‍👩‍👧‍👦",
    }
    assert http.post.call_args.kwargs["headers"] == {"Idempotency-Key": "original"}
    http.get.return_value = {"reaction": F["reaction"]}
    assert resource.get_reaction(F["reaction"]["id"]).id == UUID(F["reaction"]["id"])
    http.delete_with_response.return_value = {"reaction": F["removed_reaction"]}
    assert (
        resource.remove_reaction(
            F["reaction"]["id"], idempotency_key="remove-original"
        ).status
        == WhatsAppReactionStatus.REMOVED
    )
    assert http.delete_with_response.call_args.kwargs["headers"] == {
        "Idempotency-Key": "remove-original"
    }


@pytest.mark.parametrize(
    "options",
    [
        {},
        {"reaction": "custom"},
        {"reaction": "love", "custom_emoji": "👍"},
        {"custom_emoji": " "},
        {"custom_emoji": "x" * 33},
        {"custom_emoji": "\ud800"},
        {"reaction": "like", "idempotency_key": ""},
    ],
)
def test_invalid_reaction_does_not_contact_transport(options):
    http = MagicMock()
    with pytest.raises(ValueError):
        WhatsAppResource(http).send_reaction(
            **(
                {"message_id": F["message"]["id"], "idempotency_key": "stable"}
                | options
            )
        )
    http.post.assert_not_called()


def test_reaction_webhook_uses_its_receipt_and_keeps_unknown_actor_null():
    from typing import get_args
    from inkbox.webhooks import WhatsAppWebhookEventType
    from inkbox.whatsapp import WhatsAppReaction

    event = F["reaction_webhook"]
    assert event["event_type"] in get_args(WhatsAppWebhookEventType)
    assert event["data"]["message"]["id"] == F["message"]["id"]
    assert event["data"]["message"]["direction"] == "outbound"
    assert "is_blocked" not in event["data"]["message"]
    reaction = WhatsAppReaction._from_dict(event["data"]["reaction"])
    assert reaction.remote_number is None
    assert str(reaction.target_message_id) == F["message"]["id"]


def test_reaction_fixture_preserves_one_actor_per_receipt():
    data = F["reaction_webhook"]["data"]
    receipts = {}
    for reaction in [data["reaction"], *data["message"]["reactions"]]:
        actor = (reaction["direction"], reaction["remote_number"], reaction["target_message_id"])
        assert receipts.setdefault(reaction["id"], actor) == actor

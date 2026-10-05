"""Cached Slack reads preserve incomplete state and use authenticated byte routes."""
import copy
import json
from datetime import datetime
from pathlib import Path

import pytest
from inkbox import SlackCachedActor, SlackCachedReaction
from test_slack import wire as wire_fixture

wire = wire_fixture
DATA = json.loads((Path(__file__).parents[3] / "tests/fixtures/slack_cached_archive.json").read_text())
C = DATA["connection_id"]


def test_connection_generation_is_optional_but_preserved(wire):
    client, _, replies = wire
    raw = json.loads((Path(__file__).parents[3] / "tests/fixtures/slack.json").read_text())["connection"]
    for generation in (None, 3):
        item = {**raw, **({"generation": generation} if generation is not None else {})}
        replies.append({"connections": [item], "installation_available": False})
        assert client.slack.list_connections(raw["identity_id"]).connections[0].generation == generation


def test_expanded_page_keeps_unknown_counts_and_partial_rosters(wire):
    client, requests, replies = wire
    replies.append(copy.deepcopy(DATA["page"]))
    result = client.slack.list_archived_messages(C, roots_only=True,
        include=["conversation", "sender", "reactions", "files"], limit=25, cursor="previous")
    assert dict(requests[0].url.params) == {"roots_only": "true", "include": "conversation,sender,reactions,files",
        "limit": "25", "cursor": "previous"}
    message = result.messages[0]
    assert message.reply_count == 3 and message.latest_reply == "1789552801.000100"
    assert isinstance(message.reactions[0], SlackCachedReaction)
    assert message.reactions[0].count is None and message.reactions[0].reacted is None
    assert message.reactions[1].count == 0 and message.reactions[1].reacted is False
    assert message.reactions_complete is False and not message.reactions[0].users_complete
    assert message.blocks[0]["block_id"] == "keep_snake_case"
    actor = result.included.actors["U123"]
    assert isinstance(actor, SlackCachedActor) and isinstance(actor.fetched_at, datetime)
    assert result.included.conversations["C123"].name is None
    assert result.included.conversations["C123"].members_complete is False
    assert result.included.emoji["celebrate"].alias_of == "party"
    assert result.included.files["F123"].content_cached and result.included.files["F123"].preview_url
    assert result.next_cursor == "opaque-next" and len(requests) == 1


def test_older_response_does_not_invent_reaction_or_thread_counts(wire):
    client, requests, replies = wire
    raw = copy.deepcopy(DATA["page"])
    raw.pop("included")
    for key in ("reactions", "reactions_complete", "reply_count", "latest_reply"):
        raw["messages"][0].pop(key)
    replies.append(raw)
    result = client.slack.list_archived_messages(C)
    assert result.included is None
    assert result.messages[0].reactions is None and result.messages[0].reply_count is None
    assert dict(requests[0].url.params) == {"limit": "50"}


def test_cached_emoji_does_not_auto_paginate_or_confuse_aliases(wire):
    client, requests, replies = wire
    replies.append(copy.deepcopy(DATA["emoji_page"]))
    page = client.slack.list_cached_emoji(C, q="party +", cursor="previous", limit=2)
    assert page.status == "pending" and page.next_cursor == "party"
    assert page.emoji[0].alias_of == "party" and page.emoji[1].image_cached
    assert dict(requests[0].url.params) == {"q": "party +", "cursor": "previous", "limit": "2"}
    assert len(requests) == 1


@pytest.mark.parametrize("method,arguments,path", [
    ("download_cached_media", ("emoji", "party+"), "/cached-media/emoji/party+"),
    ("download_file_preview", ("F123",), "/files/F123/preview"),
])
def test_cached_binary_methods_preserve_bytes_and_authentication(wire, method, arguments, path):
    client, requests, replies = wire
    replies.append(b"\x00\xff\x01")
    assert getattr(client.slack, method)(C, *arguments) == b"\x00\xff\x01"
    assert requests[0].url.path == f"/api/v1/slack/connections/{C}{path}"
    assert requests[0].headers.get("x-api-key") == "synthetic-test-key"

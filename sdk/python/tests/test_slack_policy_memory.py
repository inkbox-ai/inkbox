"""Shared wire fixture covers policy, durable Slack references, and Companion reply routing."""
import copy
import json
from pathlib import Path

import pytest

from inkbox import ContactFactCitation, SlackCorrespondenceItem, SlackRuleAction
from inkbox.companion import CompanionInitializationError, _page
from inkbox.contacts.types import _parse_correspondence_item
from test_slack import wire as wire

F = json.loads((Path(__file__).parents[3] / "tests/fixtures/slack_policy_memory.json").read_text())
BASE = "/api/v1/slack/identities/example-agent/contact-rules"


def test_seven_rule_operations_exact_wire(wire):
    client, requests, replies = wire
    rules = client.slack.contact_rules

    def check(reply, call, method, suffix="", body=None, query=None):
        replies.append(reply)
        result = call()
        request = requests[-1]
        assert (request.method, request.url.path) == (method, BASE + suffix)
        assert dict(request.url.params) == (query or {})
        if body is not None:
            assert json.loads(request.content) == body
        return result

    row = check(F["rule"], lambda: rules.create("@example-agent", action="allow", match_type="exact_user", match_target="TEXAMPLE:UEXAMPLE"), "POST", body={"action":"allow","match_type":"exact_user","match_target":"TEXAMPLE:UEXAMPLE"})
    assert row.action == SlackRuleAction.ALLOW and row.created_at.tzinfo
    check([F["rule"]], lambda: rules.list("example-agent", direction="inbound", limit=5, offset=0), "GET", query={"direction":"inbound","limit":"5","offset":"0"})
    check(F["rule"], lambda: rules.get("example-agent", row.id), "GET", f"/{row.id}")
    check(F["rule"], lambda: rules.update("example-agent", row.id, action="block", apply_to="outbound"), "PATCH", f"/{row.id}", {"action":"block","apply_to":"outbound"})
    check(F["settings"], lambda: rules.get_settings("example-agent"), "GET", "/settings")
    settings = check(F["settings"], lambda: rules.update_settings("example-agent", inbound_filter_mode="whitelist"), "PATCH", "/settings", {"inbound_filter_mode":"whitelist"})
    assert settings.outbound_filter_mode == "blacklist"
    check(None, lambda: rules.delete("example-agent", row.id), "DELETE", f"/{row.id}")
    assert len(requests) == 7


@pytest.mark.parametrize("operation,kwargs", [("update",{}), ("update",{"action":"allow","direction":"both","apply_to":"inbound"}), ("update_settings",{}), ("update_settings",{"outbound_filter_mode":None})])
def test_invalid_local_mutations_make_no_request(wire, operation, kwargs):
    client, requests, _ = wire
    args = ["example-agent", F["rule"]["id"]] if operation == "update" else ["example-agent"]
    with pytest.raises((ValueError, TypeError)):
        getattr(client.slack.contact_rules, operation)(*args, **kwargs)
    assert not requests


def test_slack_memory_references_and_native_ids_survive():
    item = _parse_correspondence_item(F["correspondence"])
    assert isinstance(item, SlackCorrespondenceItem)
    assert item.conversation_id == "CEXAMPLE" and item.media.count == 1
    citation = ContactFactCitation._from_dict(F["citation"])
    assert citation.source_type == "slack_message"
    assert citation.source_locator["version"] == 1
    assert citation.source_id == item.source_id


def test_slack_initialization_keeps_distinct_scope_and_reply_coordinates():
    result = _page(F["activation"], F["activation"]["activation_id"])
    assert result.reply_context.slack_conversation_id == "CEXAMPLE"
    assert result.reply_context.conversation_id != "CEXAMPLE"
    assert result.reply_context.thread_ts == "1780000000.000001"
    assert result.items[0].sender_access == "sponsored"
    for key in ("connection_id", "slack_conversation_id"):
        broken = copy.deepcopy(F["activation"])
        broken["reply_context"].pop(key)
        with pytest.raises(CompanionInitializationError):
            _page(broken, broken["activation_id"])

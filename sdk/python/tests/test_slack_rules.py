"""Slack rule, discovery, and import wire contracts."""
import json
from uuid import UUID
import httpx
import pytest
from inkbox import Inkbox, SlackRuleAction, SlackRuleMatchType
from inkbox.companion import _page, CompanionInitializationError

ID = "11111111-1111-4111-8111-111111111111"
RULE = {"id": ID, "agent_identity_id": ID, "action": "allow", "match_type": "exact_user",
        "match_target": "TEXAMPLE:UEXAMPLE", "direction": "both", "status": "active",
        "created_at": "2026-10-02T00:00:00Z", "updated_at": "2026-10-02T00:00:00Z", "contact": None}

@pytest.fixture
def wire():
    client = Inkbox(api_key="synthetic", base_url="https://example.com")
    requests, replies = [], []
    def receive(request):
        requests.append(request)
        return httpx.Response(200, json=replies.pop(0))
    client._api_http._client.close()
    client._api_http._client = httpx.Client(base_url="https://example.com/api/v1", transport=httpx.MockTransport(receive))
    yield client, requests, replies
    client.close()


def test_rule_crud_and_one_sided_edit(wire):
    client, requests, replies = wire
    rules = client.slack.contact_rules
    replies.append(RULE)
    rule = rules.create("project-agent", action="allow", match_target=RULE["match_target"])
    assert rule.action == SlackRuleAction.ALLOW and rule.match_type == SlackRuleMatchType.EXACT_USER
    assert json.loads(requests[-1].content) == {"action": "allow", "match_type": "exact_user", "match_target": RULE["match_target"]}
    assert requests[-1].url.path == "/api/v1/identities/project-agent/slack-contact-rules"
    replies.append(RULE)
    rules.update("project-agent", ID, action="block", apply_to="outbound")
    assert json.loads(requests[-1].content) == {"action": "block", "apply_to": "outbound"}
    assert requests[-1].method == "PATCH"
    replies.append([RULE])
    assert len(rules.list("project-agent", direction="inbound", limit=2, offset=3)) == 1
    assert dict(requests[-1].url.params) == {"direction": "inbound", "limit": "2", "offset": "3"}
    replies.append([RULE])
    rules.list_all(agent_identity_id=ID, match_type="workspace")
    assert requests[-1].url.path == "/api/v1/slack/contact-rules"
    assert requests[-1].url.params["agent_identity_id"] == ID
    replies.append(RULE)
    assert rules.get("project-agent", ID).id == UUID(ID)
    replies.append({})
    rules.delete("project-agent", ID)
    assert requests[-1].method == "DELETE"
    count = len(requests)
    with pytest.raises(ValueError):
        rules.update("project-agent", ID, action="block", direction="both", apply_to="outbound")
    assert len(requests) == count


def test_discovery_and_import_keep_empty_page_cursors(wire):
    client, requests, replies = wire
    replies.append({"workspaces": [], "next_cursor": "next", "unavailable_reason": None})
    page = client.slack.discover_workspaces(ID, source="conversations", cursor="previous", limit=10)
    assert page.next_cursor == "next"
    assert dict(requests[-1].url.params) == {"source": "conversations", "cursor": "previous", "limit": "10"}
    assert requests[-1].url.path == f"/api/v1/slack/connections/{ID}/workspaces"
    replies.append({"imported_count": 0, "skipped_count": 2, "contact_ids": [], "next_cursor": "next"})
    page = client.slack.import_contacts(ID, conversation_id="CEXAMPLE", cursor="previous", limit=20)
    assert page.next_cursor == "next" and page.skipped_count == 2
    assert requests[-1].method == "POST"
    assert requests[-1].url.path.endswith("/contacts/import")
    assert json.loads(requests[-1].content) == {"conversation_id": "CEXAMPLE", "cursor": "previous", "limit": 20}


def test_slack_companion_reply_scope_is_preserved_and_validated():
    page = {"scope_id": ID, "activation_id": ID, "conversation_id": ID, "channel": "slack", "items": [],
            "history_complete": True, "next_cursor": None, "reply_context": {
                "channel": "slack", "conversation_id": ID, "connection_id": ID,
                "slack_conversation_id": "CEXAMPLE", "thread_ts": "1234.000100"}}
    parsed = _page(page, ID)
    assert parsed.reply_context.connection_id == ID
    assert parsed.reply_context.thread_ts == "1234.000100"
    page["reply_context"]["thread_ts"] = 1234.0001
    with pytest.raises(CompanionInitializationError):
        _page(page, ID)


def test_slack_identity_modes_match_shared_directional_contract():
    from unittest.mock import patch
    from inkbox import FilterMode
    requests = []
    response = {"id": ID, "organization_id": "example-org", "agent_handle": "project-agent",
                "created_at": RULE["created_at"], "updated_at": RULE["updated_at"],
                "slack_filter_mode": "whitelist", "slack_outbound_filter_mode": "blacklist"}
    def receive(request):
        requests.append(request)
        return httpx.Response(200, json=response)
    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(receive)):
        client = Inkbox(api_key="synthetic", base_url="https://example.com")
    with client:
        agent = client.get_identity("project-agent")
        assert agent.slack_inbound_filter_mode == FilterMode.WHITELIST
        assert agent.slack_outbound_filter_mode == FilterMode.BLACKLIST
        agent.update(slack_inbound_filter_mode="blacklist")
        assert json.loads(requests[-1].content) == {"slack_inbound_filter_mode": "blacklist"}
        with pytest.raises(ValueError):
            agent.update(slack_filter_mode="blacklist", slack_inbound_filter_mode="whitelist")
        with pytest.raises(ValueError):
            agent.update(slack_outbound_filter_mode=None)

import copy
import json
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest

from inkbox import CompanionInitializationError, Inkbox
from inkbox.webhooks import MailWebhookPayload, TextWebhookPayload, IMessageWebhookPayload

FIXTURE = json.loads((Path(__file__).parents[3] / "tests/fixtures/companion-v1.json").read_text())
ACTIVATION = FIXTURE["pages"][0]["activation_id"]


def client_for(handler):
    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(handler)):
        return Inkbox("test-key", base_url="https://example.com")


def test_config_patch_omission_and_paged_state():
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json={"items": [], "total": 0} if request.url.path.endswith("conversations") else FIXTURE["config"])

    with client_for(respond) as client:
        assert client.companion.get("example-agent").sponsor is None
        client.companion.update("example-agent", enabled=False)
        assert json.loads(requests[-1].content) == {"enabled": False}
        sponsor = {"emails": ["sponsor@example.com"], "phone_numbers": [], "contact_id": None}
        client.companion.update("example-agent", sponsor=sponsor)
        assert json.loads(requests[-1].content) == {"sponsor": sponsor}
        page = client.companion.conversations("example-agent", channel="mail", limit=200, offset=10000)
        assert page.total == 0
        assert dict(requests[-1].url.params) == {"channel": "mail", "limit": "200", "offset": "10000"}
        with pytest.raises(ValueError):
            client.companion.update("example-agent", enabled=None)
        with pytest.raises(ValueError):
            client.companion.update("example-agent", sponsor=None)


@pytest.mark.parametrize("channel", ["mail", "phone", "imessage"])
def test_complete_hydration_dedup_scope_notices_and_attachments(channel):
    pages = copy.deepcopy(FIXTURE["pages"])
    for page in pages:
        page["channel"] = page["reply_context"]["channel"] = channel
        if channel != "mail":
            page["reply_context"].update(to=None, cc=None, reply_to_message_id=None)
    calls = []

    def respond(request):
        calls.append(request.url.params.get("cursor"))
        return httpx.Response(200, json=pages[1 if request.url.params.get("cursor") else 0])

    with client_for(respond) as client:
        observed = client.with_response_metadata(lambda scoped: scoped.companion.load_initialization("example-agent", ACTIVATION))
    result = observed.data
    assert calls == [None, "opaque-page-2", None]
    assert len(result.entries) == 3
    assert sum(entry.is_trigger for entry in result.entries) == 1
    assert result.text.count("Please join this conversation.") == 1
    assert "\\nCan you review this?" in result.text
    assert result.entries[0].attachments == pages[0]["items"][0]["attachments"]
    assert result.reply_context.conversation_id == pages[0]["conversation_id"]
    assert result.notices == observed.notices
    assert result.notices[0].code == "future_history_notice"


@pytest.mark.parametrize("mutation", ["scope", "activation", "channel", "reply", "audience", "conflict", "cursor", "incomplete", "no_trigger", "two_triggers"])
def test_reject_inconsistent_or_incomplete_snapshots(mutation):
    pages = copy.deepcopy(FIXTURE["pages"])
    second = pages[1]
    if mutation == "scope":
        second["scope_id"] = second["conversation_id"]
    elif mutation == "activation":
        second["activation_id"] = second["scope_id"]
    elif mutation == "channel":
        second["channel"] = "phone"
    elif mutation == "reply":
        second["reply_context"]["conversation_id"] = second["scope_id"]
    elif mutation == "audience":
        second["reply_context"]["to"] = ["someone@example.com"]
    elif mutation == "conflict":
        second["items"][0]["text"] = "different"
    elif mutation == "cursor":
        second.update(history_complete=False, next_cursor="opaque-page-2")
    elif mutation == "incomplete":
        second.update(history_complete=False, next_cursor=None)
    elif mutation == "no_trigger":
        second["items"].pop()
    elif mutation == "two_triggers":
        pages[0]["items"][0].update(historical=False, is_trigger=True)
    with client_for(lambda r: httpx.Response(200, json=pages[1 if r.url.params.get("cursor") else 0])) as client:
        with pytest.raises(CompanionInitializationError):
            client.companion.load_initialization("example-agent", ACTIVATION)


def test_permission_revalidation_and_bounds_never_return_partial_context():
    calls = []

    def respond(request):
        calls.append(request)
        if len(calls) == 3:
            return httpx.Response(403, json={"detail": "Activation unavailable"})
        return httpx.Response(200, json=FIXTURE["pages"][len(calls) - 1])

    with client_for(respond) as client:
        with pytest.raises(Exception) as denied:
            client.companion.load_initialization("example-agent", ACTIVATION)
        assert denied.value.status_code == 403
    for bounds in ({"max_bytes": 100}, {"max_pages": 1}):
        with client_for(lambda _: httpx.Response(200, json=FIXTURE["pages"][0])) as client:
            with pytest.raises(CompanionInitializationError):
                client.companion.load_initialization("example-agent", ACTIVATION, **bounds)


def test_one_page_attachment_only_trigger_revalidates_and_webhooks_are_additive():
    page = copy.deepcopy(FIXTURE["pages"][1])
    page["items"] = [page["items"][1]]
    page["items"][0]["text"] = ""
    page["items"][0]["attachments"] = [{"index": 0, "content_type": "image/png"}]
    requests = []

    def respond(request):
        requests.append(request)
        return httpx.Response(200, json=page)

    with client_for(respond) as client:
        result = client.companion.load_initialization("example-agent", ACTIVATION)
        assert len(result.entries) == 1
        assert len(requests) == 2
    for payload in (MailWebhookPayload, TextWebhookPayload, IMessageWebhookPayload):
        assert "companion" in payload.__annotations__

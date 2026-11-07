"""Conversation selectors preserve repeated values and pagination."""

from unittest.mock import MagicMock
from uuid import UUID

import pytest

from inkbox.whatsapp import WhatsAppResource
from inkbox.mail.resources.threads import ThreadsResource
from inkbox.phone.resources.texts import TextsResource
from inkbox.imessage.resources.imessages import IMessagesResource


@pytest.mark.parametrize("channel", ["email", "sms", "imessage", "whatsapp"])
@pytest.mark.parametrize("selector", [{"participants": ["guest@example.com", "+14155550123"]}, {"contact_id": UUID("aaaaaaaa-1111-4111-8111-111111111111")}])
def test_selectors_forward_exact_query(channel, selector):
    http = MagicMock()
    if channel == "email":
        http.get.return_value = {"items": [], "has_more": False}
        list(ThreadsResource(http).list("agent@example.com", **selector))
    elif channel == "sms":
        http.get.return_value = []
        TextsResource(http).list_conversations("number-id", **selector)
    elif channel == "whatsapp":
        http.get.return_value = []
        WhatsAppResource(http).list_conversations(**selector)
    else:
        http.get.return_value = []
        IMessagesResource(http).list_conversations(**selector)
    query = http.get.call_args.kwargs["params"]
    for key, value in selector.items():
        assert query[key] == (str(value) if isinstance(value, UUID) else value)


def test_email_selector_remains_on_each_page():
    http = MagicMock()
    http.get.side_effect = [{"items": [], "has_more": True, "next_cursor": "page2"}, {"items": [], "has_more": False}]
    list(ThreadsResource(http).list("agent@example.com", participants=["guest@example.com"]))
    assert [call.kwargs["params"]["participants"] for call in http.get.call_args_list] == [["guest@example.com"]] * 2
    assert http.get.call_args_list[1].kwargs["params"]["cursor"] == "page2"


@pytest.mark.parametrize("selector", [{"participants": []}, {"participants": ["guest@example.com"], "contact_id": "contact"}])
def test_invalid_selectors_never_fall_back_to_unfiltered_request(selector):
    http = MagicMock()
    with pytest.raises(ValueError):
        TextsResource(http).list_conversations("number-id", **selector)
    http.get.assert_not_called()

@pytest.mark.parametrize("selector", [{"participants": []}, {"participants": ["+14155550123"], "contact_id": "contact"}])
def test_invalid_whatsapp_selectors_do_not_issue_requests(selector):
    http = MagicMock()
    with pytest.raises(ValueError):
        WhatsAppResource(http).list_conversations(**selector)
    http.get.assert_not_called()


def test_whatsapp_selector_preserves_scope_and_pagination():
    http = MagicMock()
    http.get.return_value = []
    WhatsAppResource(http).list_conversations(agent_identity_id="owner", limit=12, offset=7,
                                             participants=["+14155550123"], is_blocked=False)
    http.get.assert_called_once_with("/conversations", params={
        "agent_identity_id": "owner", "limit": 12, "offset": 7,
        "participants": ["+14155550123"], "is_blocked": False,
    })

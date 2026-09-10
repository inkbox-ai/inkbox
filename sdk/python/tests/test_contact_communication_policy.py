"""Communication-policy transport and typed response contracts."""

import json
from unittest.mock import MagicMock
from uuid import UUID

from inkbox import ContactChannelDecisions, ContactIdentityDecisions
from inkbox.contacts.resources.contacts import ContactsResource

CONTACT_ID = UUID("11111111-1111-4111-8111-111111111111")
IDENTITY_ID = UUID("22222222-2222-4222-8222-222222222222")


def test_replace_serializes_uuid_overrides_and_revision() -> None:
    http = MagicMock()
    http.put.return_value = {
        "contact_id": str(CONTACT_ID), "revision": 4,
        "defaults": {"email": "block", "phone": "block"},
        "identities": [{"identity_id": str(IDENTITY_ID), "email": "allow", "phone": "block"}],
    }
    result = ContactsResource(http).communication_policy.replace(
        CONTACT_ID, expected_revision=3,
        defaults=ContactChannelDecisions(email="block", phone="block"),
        identities=[ContactIdentityDecisions(identity_id=IDENTITY_ID, email="allow", phone="block")],
    )
    payload = http.put.call_args.kwargs["json"]
    assert json.loads(json.dumps(payload))["identities"][0]["identity_id"] == str(IDENTITY_ID)
    assert payload["expected_revision"] == 3
    assert result.contact_id == CONTACT_ID
    assert result.revision == 4
    assert result.identities[0].identity_id == IDENTITY_ID


def test_preview_and_page_handle_hidden_contacts() -> None:
    http = MagicMock()
    preview = {"identity_id": str(IDENTITY_ID), "contact": None, "email": False, "phone": False, "full_profile": False}
    http.get.return_value = preview
    resource = ContactsResource(http).communication_policy
    assert resource.preview(CONTACT_ID, IDENTITY_ID).contact is None
    http.get.assert_called_with(f"/contacts/{CONTACT_ID}/communication-preview", params={"identity_id": str(IDENTITY_ID)})
    http.get.return_value = {"items": [preview], "limit": 1, "offset": 2, "has_more": True}
    page = resource.list_for_identity("test-agent", limit=1, offset=2)
    assert page.has_more is True
    assert page.items[0].identity_id == IDENTITY_ID
    http.get.assert_called_with("/identities/test-agent/contact-communication-policies", params={"limit": 1, "offset": 2})

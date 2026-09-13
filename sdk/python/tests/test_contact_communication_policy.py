"""Communication-policy transport and typed response contracts."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch
from uuid import UUID

import httpx

from inkbox import (ContactAddressUpdate, ContactVisibilityDecisions,
                    ContactVisibilityPolicy, ContactIdentityVisibilityDecisions)
from inkbox.contacts.resources.contacts import ContactsResource
from inkbox import ContactReviewStatus
from inkbox._http import HttpTransport

CONTACT_ID = UUID("11111111-1111-4111-8111-111111111111")
IDENTITY_ID = UUID("22222222-2222-4222-8222-222222222222")


def test_shared_wire_fixture_through_http_transport() -> None:
    fixture = json.loads((Path(__file__).parents[3] / "tests/fixtures/contact_communication_policy.json").read_text())
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "PUT":
            assert json.loads(request.content) == fixture["update"]
        if request.url.path.endswith("communication-preview"):
            assert request.url.params["identity_id"] == str(IDENTITY_ID)
            return httpx.Response(200, json=fixture["preview"])
        assert request.url.path == f"/api/v1/contacts/{CONTACT_ID}/communication-policy"
        if request.method == "GET":
            assert request.url.params["identity_id"] == str(IDENTITY_ID)
        return httpx.Response(200, json=fixture["policy"])

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        http = HttpTransport("test-key", "https://example.com/api/v1")
    try:
        resource = ContactsResource(http).communication_policy
        policy = resource.get(CONTACT_ID, IDENTITY_ID)
        assert not policy.addresses[0].allowed and not policy.effective_visibility.profile
        saved = resource.replace(CONTACT_ID, expected_revision=7, identity_id=IDENTITY_ID,
                                 addresses=[ContactAddressUpdate(**row) for row in fixture["update"]["addresses"]],
                                 visibility=policy.visibility)
        assert saved == policy
        preview = resource.preview(CONTACT_ID, IDENTITY_ID)
        assert preview.contact is None and not preview.visibility.profile
        assert [request.method for request in requests] == ["GET", "PUT", "GET"]
    finally:
        http.close()


def test_management_roster_uses_distinct_contract_and_filters() -> None:
    http = MagicMock()
    http.get.return_value = {"items": [{
        "contact": {"id": str(CONTACT_ID), "preferred_name": "Person", "given_name": None, "family_name": None,
                    "company_name": None, "review_status": "confirmed", "emails": [],
                    "phones": [{"value_e164": "+15555550123", "label": "Work", "is_primary": True}]},
        "revision": 8,
        "visibility": {"defaults": {"profile": "inherit", "memories": "inherit"},
                       "identity_override": {"profile": "allow", "memories": "block"}},
        "effective": {"email": "no_identifiers", "phone": "some", "profile": True, "memories": False},
    }], "limit": 1, "offset": 2, "has_more": True}
    page = ContactsResource(http).communication_policy.list_management_for_identity(
        "test-agent", q="Person", order="name", limit=1, offset=2, review_status=[ContactReviewStatus.CONFIRMED])
    http.get.assert_called_once_with("/identities/test-agent/contact-permissions", params={
        "q": "Person", "order": "name", "limit": 1, "offset": 2, "review_status": ["confirmed"]})
    assert page.has_more and page.items[0].revision == 8
    assert page.items[0].contact.phones[0].value == "+15555550123"
    assert page.items[0].effective.phone == "some"
    assert page.items[0].visibility.identity_override.memories == "block"
    assert not hasattr(page.items[0].contact, "notes")


def test_replace_serializes_uuid_overrides_and_revision() -> None:
    http = MagicMock()
    http.put.return_value = {
        "contact_id": str(CONTACT_ID), "revision": 4,
        "identity_id": str(IDENTITY_ID), "addresses": [], "effective_visibility": {"profile": False, "memories": False},
        "visibility": {"defaults": {"profile": "inherit", "memories": "inherit"}, "identities": []},
    }
    result = ContactsResource(http).communication_policy.replace(
        CONTACT_ID, expected_revision=3,
        identity_id=IDENTITY_ID,
        addresses=[ContactAddressUpdate("phone", "+15555550123", "allow", "block")],
    )
    payload = http.put.call_args.kwargs["json"]
    assert json.loads(json.dumps(payload))["identity_id"] == str(IDENTITY_ID)
    assert payload["addresses"] == [{"kind": "phone", "value": "+15555550123", "action": "allow", "expected_action": "block"}]
    assert payload["expected_revision"] == 3
    assert result.contact_id == CONTACT_ID
    assert result.revision == 4
    assert result.identity_id == IDENTITY_ID


def test_preview_and_page_handle_hidden_contacts() -> None:
    http = MagicMock()
    preview = {"identity_id": str(IDENTITY_ID), "contact": None, "email": False, "phone": False, "full_profile": False,
               "visibility": {"profile": False, "memories": False}}
    http.get.return_value = preview
    resource = ContactsResource(http).communication_policy
    assert resource.preview(CONTACT_ID, IDENTITY_ID).contact is None
    http.get.assert_called_with(f"/contacts/{CONTACT_ID}/communication-preview", params={"identity_id": str(IDENTITY_ID)})
    http.get.return_value = {"items": [preview], "limit": 1, "offset": 2, "has_more": True}
    page = resource.list_for_identity("test-agent", limit=1, offset=2)
    assert page.has_more is True
    assert page.items[0].identity_id == IDENTITY_ID
    http.get.assert_called_with("/identities/test-agent/contact-communication-policies", params={"limit": 1, "offset": 2})


def test_visibility_round_trip_preserves_omission() -> None:
    http = MagicMock()
    visibility = ContactVisibilityPolicy(
        defaults=ContactVisibilityDecisions("block", "block"),
        identities=[ContactIdentityVisibilityDecisions(IDENTITY_ID, "allow", "block")],
    )
    http.put.return_value = {"contact_id": str(CONTACT_ID), "revision": 8,
                             "identity_id": None, "addresses": [], "effective_visibility": None,
                             "visibility": visibility._to_wire()}
    resource = ContactsResource(http).communication_policy
    saved = resource.replace(CONTACT_ID, expected_revision=7, identity_id=IDENTITY_ID,
                             addresses=[], visibility=visibility)
    payload = http.put.call_args.kwargs["json"]
    assert json.loads(json.dumps(payload))["visibility"]["identities"][0]["identity_id"] == str(IDENTITY_ID)
    assert "defaults" not in payload
    assert saved.identity_id is None and saved.effective_visibility is None
    assert saved.visibility == visibility
    resource.replace(CONTACT_ID, expected_revision=8, identity_id=IDENTITY_ID, addresses=[])
    assert "visibility" not in http.put.call_args.kwargs["json"]


def test_preview_parses_profile_without_memories() -> None:
    http = MagicMock()
    http.get.return_value = {"identity_id": str(IDENTITY_ID), "email": True, "phone": False, "full_profile": False,
                             "visibility": {"profile": True, "memories": False},
                             "contact": {"id": str(CONTACT_ID), "notes": "Visible notes", "emails": [], "phones": [],
                                         "created_at": "2026-09-10T12:00:00Z", "updated_at": "2026-09-10T12:00:00Z",
                                         "memory_count": 0, "latest_memory": None}}
    preview = ContactsResource(http).communication_policy.preview(CONTACT_ID, IDENTITY_ID)
    assert preview.visibility.profile is True and preview.visibility.memories is False
    assert preview.contact.notes == "Visible notes"
    assert preview.contact.memory_count == 0 and preview.contact.latest_memory is None

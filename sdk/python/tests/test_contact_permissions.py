"""Boolean permission requests through the public resource and HTTP transport."""

import json
from pathlib import Path
from unittest.mock import patch

import httpx

from inkbox import ContactAccessSettings, ContactChannelAccessUpdate, ContactCreatePermissions, ContactPermissions, Inkbox


def test_boolean_permissions_preserve_false_empty_maps_and_omitted_settings() -> None:
    fixture = json.loads((Path(__file__).parents[3] / "tests/fixtures/contact_communication_policy.json").read_text())
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert request.url.path == f"/api/v1/identities/test-agent/contacts/{fixture['policy']['contact_id']}/permissions"
        requests.append((request.method, json.loads(request.content) if request.content else None))
        return httpx.Response(200, json=fixture["permissions"])

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox(api_key="test-key", base_url="https://example.com")
    try:
        resource = client.contacts.permissions
        loaded = resource.get("test-agent", fixture["policy"]["contact_id"])
        assert loaded == ContactPermissions(**fixture["permissions"])
        assert resource.update("test-agent", fixture["policy"]["contact_id"],
            emails={"person@example.com": False}, phones={}, profile=False) == loaded
        resource.update("test-agent", fixture["policy"]["contact_id"])
        assert requests == [("GET", None), ("PATCH", fixture["permissions_update"]), ("PATCH", {})]
    finally:
        client.close()


def test_group_access_preserves_nested_omission_and_atomic_creation_shape() -> None:
    fixture = json.loads((Path(__file__).parents[3] / "tests/fixtures/contact_communication_policy.json").read_text())
    requests = []
    contact_id = fixture["policy"]["contact_id"]

    def respond(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else None
        requests.append((request.method, request.url.path, body))
        if request.method == "POST":
            return httpx.Response(201, json={"id": contact_id, "created_at": "2026-09-11T00:00:00Z", "updated_at": "2026-09-11T00:00:00Z"})
        return httpx.Response(200, json=fixture["access"])

    with patch("inkbox._http.httpx.HTTPTransport", return_value=httpx.MockTransport(respond)):
        client = Inkbox(api_key="test-key", base_url="https://example.com")
    try:
        loaded = client.contacts.access.get("test-agent", contact_id)
        assert isinstance(loaded, ContactAccessSettings)
        assert loaded.email.visible and loaded.email.contactable == ["person@example.com"]
        assert loaded.phone.visible and loaded.phone.contactable == []
        assert not loaded.profile and loaded.memories
        assert client.contacts.access.update(
            "test-agent", contact_id,
            email=ContactChannelAccessUpdate(visible=True, contactable=[]),
            phone=ContactChannelAccessUpdate(visible=False), profile=False, memories=True,
        ) == loaded
        client.contacts.access.update("test-agent", contact_id, email=ContactChannelAccessUpdate())
        client.contacts.access.update("test-agent", contact_id)
        client.contacts.create(given_name="Ada", permissions=ContactCreatePermissions(
            identity_id=fixture["policy"]["identity_id"],
            email=ContactChannelAccessUpdate(visible=True, contactable=[]), profile=False,
        ))
        path = f"/api/v1/identities/test-agent/contacts/{contact_id}/access"
        assert requests == [
            ("GET", path, None), ("PATCH", path, fixture["access_update"]),
            ("PATCH", path, {"email": {}}), ("PATCH", path, {}),
            ("POST", "/api/v1/contacts/with-permissions", {"given_name": "Ada", "permissions": {
                "identity_id": fixture["policy"]["identity_id"], "profile": False,
                "email": {"visible": True, "contactable": []},
            }}),
        ]
    finally:
        client.close()

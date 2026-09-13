"""Boolean permission requests through the public resource and HTTP transport."""

import json
from pathlib import Path
from unittest.mock import patch

import httpx

from inkbox import ContactPermissions, Inkbox


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

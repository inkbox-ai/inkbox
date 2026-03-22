"""Tests for Inkbox unified client — identities."""

from inkbox import Inkbox
from inkbox.identities.resources.identities import IdentitiesResource


class TestInkboxIdentitiesResources:
    def test_creates_identities_resource(self):
        client = Inkbox(api_key="sk-test")

        assert isinstance(client._ids_resource, IdentitiesResource)

        client.close()

    def test_ids_http_base_url(self):
        client = Inkbox(api_key="sk-test", base_url="https://localhost:8000")
        assert str(client._ids_http._client.base_url) == "https://localhost:8000/api/v1/identities/"
        client.close()

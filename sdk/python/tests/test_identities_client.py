"""
sdk/python/tests/test_identities_client.py

Tests for Inkbox unified client — identities.
"""

from unittest.mock import MagicMock

from sample_data_identities import IDENTITY_DETAIL_DICT, IDENTITY_DICT

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


def _client_with_mock_ids_resource() -> tuple[Inkbox, MagicMock]:
    client = Inkbox(api_key="sk-test")
    mock_ids = MagicMock()
    mock_ids.get.return_value = type(
        "Data",
        (),
        IDENTITY_DETAIL_DICT,
    )()  # not used by AgentIdentity unit-style — see actual call below
    client._ids_resource = mock_ids
    return client, mock_ids


class TestCreateIdentitySendingDomain:
    """Verify the high-level `Inkbox.create_identity` helper round-trips
    sending_domain into the nested mailbox payload across omit/null/string,
    and that presence triggers mailbox creation."""

    def _client(self):
        client = Inkbox(api_key="sk-test")
        mock_ids = MagicMock()
        mock_ids.create.return_value = None
        # `get` must return a fully-populated _AgentIdentityData; reuse the
        # response parser so we don't drift from the wire shape.
        from inkbox.identities.types import _AgentIdentityData

        mock_ids.get.return_value = _AgentIdentityData._from_dict(
            IDENTITY_DETAIL_DICT
        )
        client._ids_resource = mock_ids
        return client, mock_ids

    def test_no_mailbox_when_only_handle(self):
        client, mock_ids = self._client()
        # Drop mailbox from the get-response for this specific case.
        from inkbox.identities.types import _AgentIdentityData

        mock_ids.get.return_value = _AgentIdentityData._from_dict(IDENTITY_DICT)

        client.create_identity("sales-agent")

        _, kwargs = mock_ids.create.call_args
        assert kwargs["mailbox"] is None
        client.close()

    def test_omitted_sending_domain_is_not_sent(self):
        """Setting only display_name implies a mailbox; sending_domain is omitted."""
        client, mock_ids = self._client()

        client.create_identity("sales-agent", display_name="Sales Team")

        _, kwargs = mock_ids.create.call_args
        wire = kwargs["mailbox"].to_wire()
        assert "sending_domain" not in wire
        assert wire == {"display_name": "Sales Team"}
        client.close()

    def test_explicit_null_forces_platform(self):
        client, mock_ids = self._client()

        client.create_identity("sales-agent", sending_domain=None)

        _, kwargs = mock_ids.create.call_args
        assert kwargs["mailbox"] is not None  # presence of sending_domain triggers mailbox
        wire = kwargs["mailbox"].to_wire()
        assert wire == {"sending_domain": None}
        client.close()

    def test_explicit_string_binds_to_domain(self):
        client, mock_ids = self._client()

        client.create_identity("sales-agent", sending_domain="mail.acme.com")

        _, kwargs = mock_ids.create.call_args
        wire = kwargs["mailbox"].to_wire()
        assert wire == {"sending_domain": "mail.acme.com"}
        client.close()

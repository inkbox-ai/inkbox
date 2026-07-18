"""
sdk/python/tests/test_identities_client.py

Tests for Inkbox unified client — identities.
"""

from unittest.mock import MagicMock

from sample_data_identities import IDENTITY_DETAIL_DICT

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
        mock_ids.create.return_value = mock_ids.get.return_value

        client.create_identity("sales-agent")

        _, kwargs = mock_ids.create.call_args
        assert kwargs["mailbox"] is None
        client.close()

    def test_display_name_is_identity_level_not_mailbox(self):
        """display_name is an identity-level field; it does NOT imply a mailbox spec."""
        client, mock_ids = self._client()
        # When the caller returns a fresh detail, the client should use it
        # directly without a follow-up get().
        mock_ids.create.return_value = mock_ids.get.return_value

        client.create_identity("sales-agent", display_name="Sales Team")

        _, kwargs = mock_ids.create.call_args
        assert kwargs["display_name"] == "Sales Team"
        # mailbox is None because no mailbox-only field was passed.
        assert kwargs["mailbox"] is None
        client.close()

    def test_explicit_null_forces_platform(self):
        client, mock_ids = self._client()
        mock_ids.create.return_value = mock_ids.get.return_value

        client.create_identity("sales-agent", sending_domain=None)

        _, kwargs = mock_ids.create.call_args
        assert kwargs["mailbox"] is not None
        wire = kwargs["mailbox"].to_wire()
        assert wire == {"sending_domain": None}
        client.close()

    def test_explicit_string_binds_to_domain(self):
        client, mock_ids = self._client()
        mock_ids.create.return_value = mock_ids.get.return_value

        client.create_identity("sales-agent", sending_domain="mail.acme.com")

        _, kwargs = mock_ids.create.call_args
        wire = kwargs["mailbox"].to_wire()
        assert wire == {"sending_domain": "mail.acme.com"}
        client.close()

    def test_passes_atomic_imessage_line_claim(self):
        client, mock_ids = self._client()
        mock_ids.create.return_value = mock_ids.get.return_value

        identity = client.create_identity(
            "sales-agent",
            imessage_enabled=True,
            imessage_line_type="dedicated_outbound",
        )

        _, kwargs = mock_ids.create.call_args
        assert kwargs["imessage_enabled"] is True
        assert kwargs["imessage_line_type"] == "dedicated_outbound"
        assert identity.imessage_number is not None
        client.close()

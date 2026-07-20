"""
sdk/python/tests/test_identities.py

Tests for IdentitiesResource.
"""

from unittest.mock import MagicMock
from uuid import UUID

import pytest

from sample_data_identities import (
    IDENTITY_DICT,
    IDENTITY_DETAIL_DICT,
    IDENTITY_LIST_DETAIL_DICT,
    IDENTITY_ACCESS_WILDCARD_DICT,
    IDENTITY_ACCESS_VIEWER_DICT,
)
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.identities.types import (
    IdentityAccess,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
    IdentityTunnelCreateOptions,
    _AgentIdentityData,
)
from inkbox.imessage.types import IMessageNumberType


def _resource():
    http = MagicMock()
    return IdentitiesResource(http), http


HANDLE = "sales-agent"


class TestIdentitiesCreate:
    def test_creates_identity(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DETAIL_DICT

        identity = res.create(agent_handle=HANDLE)

        http.post.assert_called_once_with("/", json={"agent_handle": HANDLE})
        assert isinstance(identity, _AgentIdentityData)
        assert identity.agent_handle == HANDLE
        assert identity.tunnel is not None

    def test_creates_identity_with_mailbox_phone_number_and_secret_access(self):
        res, http = _resource()
        http.post.return_value = {**IDENTITY_DETAIL_DICT, "email_address": "sales.team@inkboxmail.com"}

        identity = res.create(
            agent_handle=HANDLE,
            display_name="Sales Team",
            description="Sales outreach",
            mailbox=IdentityMailboxCreateOptions(
                email_local_part="sales.team",
            ),
            tunnel=IdentityTunnelCreateOptions(tls_mode="passthrough"),
            phone_number=IdentityPhoneNumberCreateOptions(
                type="local",
                state="NY",
                incoming_call_action="webhook",
                incoming_call_webhook_url="https://example.com/calls",
            ),
            vault_secret_ids=[
                UUID("11111111-1111-1111-1111-111111111111"),
                UUID("22222222-2222-2222-2222-222222222222"),
            ],
        )

        http.post.assert_called_once_with(
            "/",
            json={
                "agent_handle": HANDLE,
                "display_name": "Sales Team",
                "description": "Sales outreach",
                "mailbox": {
                    "email_local_part": "sales.team",
                },
                "tunnel": {"tls_mode": "passthrough"},
                "phone_number": {
                    "type": "local",
                    "state": "NY",
                    "incoming_call_action": "webhook",
                    "incoming_call_webhook_url": "https://example.com/calls",
                },
                "vault_secret_ids": [
                    "11111111-1111-1111-1111-111111111111",
                    "22222222-2222-2222-2222-222222222222",
                ],
            },
        )
        assert identity.email_address == "sales.team@inkboxmail.com"

    def test_claims_imessage_number_atomically(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DETAIL_DICT

        identity = res.create(
            agent_handle=HANDLE,
            imessage_enabled=True,
            imessage_number_type=IMessageNumberType.DEDICATED_OUTBOUND,
        )

        http.post.assert_called_once_with(
            "/",
            json={
                "agent_handle": HANDLE,
                "imessage_enabled": True,
                "imessage_number_type": "dedicated_outbound",
            },
        )
        assert identity.imessage_number is not None
        assert identity.imessage_number.can_start_conversations is True

    def test_number_claim_requires_imessage_enabled_true(self):
        res, http = _resource()

        with pytest.raises(ValueError, match="imessage_enabled=True"):
            res.create(
                agent_handle=HANDLE,
                imessage_number_type="dedicated_inbound",
            )

        http.post.assert_not_called()

    def test_creates_identity_with_single_vault_secret_id(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DICT

        secret_id = UUID("11111111-1111-1111-1111-111111111111")
        res.create(agent_handle=HANDLE, vault_secret_ids=secret_id)

        http.post.assert_called_once_with(
            "/",
            json={
                "agent_handle": HANDLE,
                "vault_secret_ids": "11111111-1111-1111-1111-111111111111",
            },
        )


class TestIdentitiesList:
    def test_preserves_hydrated_fields(self):
        res, http = _resource()
        http.get.return_value = [IDENTITY_LIST_DETAIL_DICT]

        identities = res.list()

        http.get.assert_called_once_with("/")
        assert len(identities) == 1
        assert identities[0].agent_handle == HANDLE
        assert identities[0].mailbox.email_address == "sales-agent@inkbox.ai"
        assert identities[0].tunnel.tunnel_name == HANDLE
        assert identities[0].access[0].viewer_identity_id is None

    def test_accepts_older_summary_response(self):
        res, http = _resource()
        http.get.return_value = [IDENTITY_DICT]

        identity = res.list()[0]

        assert identity.agent_handle == HANDLE
        assert identity.mailbox is None
        assert identity.tunnel is None
        assert identity.access == []

    def test_empty_list(self):
        res, http = _resource()
        http.get.return_value = []

        assert res.list() == []


class TestIdentitiesGet:
    def test_returns_detail(self):
        res, http = _resource()
        http.get.return_value = IDENTITY_DETAIL_DICT

        detail = res.get(HANDLE)

        http.get.assert_called_once_with(f"/{HANDLE}")
        assert isinstance(detail, _AgentIdentityData)
        assert detail.mailbox.email_address == "sales-agent@inkbox.ai"
        assert detail.phone_number.number == "+18335794607"


class TestIdentitiesUpdate:
    def test_update_handle(self):
        res, http = _resource()
        http.patch.return_value = {
            **IDENTITY_DETAIL_DICT,
            "agent_handle": "new-handle",
        }

        result = res.update(HANDLE, new_handle="new-handle")

        http.patch.assert_called_once_with(
            f"/{HANDLE}", json={"agent_handle": "new-handle"}
        )
        assert result.agent_handle == "new-handle"

    def test_omitted_fields_not_sent(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT

        res.update(HANDLE, new_handle="new-handle")

        _, kwargs = http.patch.call_args
        assert "status" not in kwargs["json"]

    def test_claims_new_imessage_number(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT

        res.update(
            HANDLE,
            imessage_number_type=IMessageNumberType.DEDICATED_INBOUND,
            idempotency_key="identity-claim-1",
        )

        http.patch.assert_called_once_with(
            f"/{HANDLE}",
            json={"imessage_number_type": "dedicated_inbound"},
            headers={"Idempotency-Key": "identity-claim-1"},
        )

    def test_attaches_owned_imessage_number(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT
        number_id = UUID("99999999-0000-0000-0000-000000000001")

        res.update(HANDLE, imessage_number_id=number_id)

        http.patch.assert_called_once_with(
            f"/{HANDLE}", json={"imessage_number_id": str(number_id)}
        )

    def test_explicit_null_moves_to_shared_service(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT

        res.update(HANDLE, imessage_number_id=None)

        http.patch.assert_called_once_with(
            f"/{HANDLE}", json={"imessage_number_id": None}
        )

    def test_omits_imessage_number_id_by_default(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT

        res.update(HANDLE, display_name="Sales")

        assert "imessage_number_id" not in http.patch.call_args.kwargs["json"]

    def test_rejects_number_type_with_number_id(self):
        res, http = _resource()

        with pytest.raises(ValueError, match="cannot be set together"):
            res.update(
                HANDLE,
                imessage_number_type="dedicated_outbound",
                imessage_number_id=None,
            )

        http.patch.assert_not_called()

    def test_number_claim_requires_idempotency_key(self):
        res, http = _resource()

        with pytest.raises(ValueError, match="idempotency_key is required"):
            res.update(
                HANDLE,
                imessage_number_type="dedicated_outbound",
            )

        http.patch.assert_not_called()

    def test_explicit_null_can_be_combined_with_disable(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DETAIL_DICT

        res.update(
            HANDLE,
            imessage_enabled=False,
            imessage_number_id=None,
        )

        http.patch.assert_called_once_with(
            f"/{HANDLE}",
            json={"imessage_enabled": False, "imessage_number_id": None},
        )


class TestIdentitiesDelete:
    def test_deletes_identity(self):
        res, http = _resource()

        res.delete(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}")


class TestIdentitiesReleasePhoneNumber:
    def test_releases_phone_number(self):
        res, http = _resource()

        res.release_phone_number(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}/phone_number")


VIEWER_ID = "dddd4444-0000-0000-0000-000000000001"


class TestIdentitiesListAccess:
    def test_lists_per_viewer_rows(self):
        res, http = _resource()
        http.get.return_value = [IDENTITY_ACCESS_VIEWER_DICT]

        rows = res.list_access(HANDLE)

        http.get.assert_called_once_with(f"/{HANDLE}/access")
        assert len(rows) == 1
        assert isinstance(rows[0], IdentityAccess)
        assert rows[0].viewer_identity_id == UUID(VIEWER_ID)
        assert rows[0].target_identity_id == UUID(
            "eeee5555-0000-0000-0000-000000000001"
        )

    def test_parses_wildcard_row(self):
        res, http = _resource()
        http.get.return_value = [IDENTITY_ACCESS_WILDCARD_DICT]

        rows = res.list_access(HANDLE)

        assert rows[0].viewer_identity_id is None

    def test_empty_list(self):
        res, http = _resource()
        http.get.return_value = []

        assert res.list_access(HANDLE) == []


class TestIdentitiesGrantAccess:
    def test_grants_per_viewer(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_ACCESS_VIEWER_DICT

        grant = res.grant_access(HANDLE, VIEWER_ID)

        http.post.assert_called_once_with(
            f"/{HANDLE}/access", json={"viewer_identity_id": VIEWER_ID}
        )
        assert isinstance(grant, IdentityAccess)
        assert grant.viewer_identity_id == UUID(VIEWER_ID)

    def test_grant_accepts_uuid_object(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_ACCESS_VIEWER_DICT

        res.grant_access(HANDLE, UUID(VIEWER_ID))

        http.post.assert_called_once_with(
            f"/{HANDLE}/access", json={"viewer_identity_id": VIEWER_ID}
        )

    def test_grant_wildcard_with_none(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_ACCESS_WILDCARD_DICT

        grant = res.grant_access(HANDLE, None)

        http.post.assert_called_once_with(
            f"/{HANDLE}/access", json={"viewer_identity_id": None}
        )
        assert grant.viewer_identity_id is None


class TestIdentitiesRevokeAccess:
    def test_revokes_viewer(self):
        res, http = _resource()

        res.revoke_access(HANDLE, VIEWER_ID)

        http.delete.assert_called_once_with(f"/{HANDLE}/access/{VIEWER_ID}")


class TestIdentitiesIMessageFields:
    def test_create_sends_imessage_enabled(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DICT

        res.create(agent_handle=HANDLE, imessage_enabled=True)

        _, kwargs = http.post.call_args
        assert kwargs["json"]["imessage_enabled"] is True

    def test_create_omits_imessage_enabled_by_default(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DICT

        res.create(agent_handle=HANDLE)

        _, kwargs = http.post.call_args
        assert "imessage_enabled" not in kwargs["json"]

    def test_update_sends_imessage_fields(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DICT

        res.update(
            HANDLE,
            imessage_enabled=True,
            imessage_filter_mode="whitelist",
        )

        http.patch.assert_called_once_with(
            f"/{HANDLE}",
            json={"imessage_enabled": True, "imessage_filter_mode": "whitelist"},
        )

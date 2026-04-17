"""
sdk/python/tests/test_identities.py

Tests for IdentitiesResource.
"""

from unittest.mock import MagicMock
from uuid import UUID

from sample_data_identities import IDENTITY_DICT, IDENTITY_DETAIL_DICT
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityPhoneNumberCreateOptions,
    IdentityWalletCreateOptions,
    _AgentIdentityData,
)


def _resource():
    http = MagicMock()
    return IdentitiesResource(http), http


HANDLE = "sales-agent"


class TestIdentitiesCreate:
    def test_creates_identity(self):
        res, http = _resource()
        http.post.return_value = IDENTITY_DICT

        identity = res.create(agent_handle=HANDLE)

        http.post.assert_called_once_with("/", json={"agent_handle": HANDLE})
        assert isinstance(identity, AgentIdentitySummary)
        assert identity.agent_handle == HANDLE

    def test_creates_identity_with_mailbox_phone_number_and_secret_access(self):
        res, http = _resource()
        http.post.return_value = {**IDENTITY_DICT, "email_address": "sales.team@inkboxmail.com"}

        identity = res.create(
            agent_handle=HANDLE,
            mailbox=IdentityMailboxCreateOptions(
                display_name="Sales Team",
                email_local_part="sales.team",
            ),
            phone_number=IdentityPhoneNumberCreateOptions(
                type="local",
                state="NY",
                incoming_call_action="webhook",
                incoming_call_webhook_url="https://example.com/calls",
                incoming_text_webhook_url="https://example.com/texts",
            ),
            wallet=IdentityWalletCreateOptions(
                chains=["base", "tempo"],
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
                "mailbox": {
                    "display_name": "Sales Team",
                    "email_local_part": "sales.team",
                },
                "phone_number": {
                    "type": "local",
                    "state": "NY",
                    "incoming_call_action": "webhook",
                    "incoming_call_webhook_url": "https://example.com/calls",
                    "incoming_text_webhook_url": "https://example.com/texts",
                },
                "wallet": {
                    "chains": ["base", "tempo"],
                },
                "vault_secret_ids": [
                    "11111111-1111-1111-1111-111111111111",
                    "22222222-2222-2222-2222-222222222222",
                ],
            },
        )
        assert identity.email_address == "sales.team@inkboxmail.com"

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
    def test_returns_list(self):
        res, http = _resource()
        http.get.return_value = [IDENTITY_DICT]

        identities = res.list()

        http.get.assert_called_once_with("/")
        assert len(identities) == 1
        assert identities[0].agent_handle == HANDLE

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
        assert detail.wallet.addresses["evm"] == "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb1"


class TestIdentitiesUpdate:
    def test_update_handle(self):
        res, http = _resource()
        http.patch.return_value = {**IDENTITY_DICT, "agent_handle": "new-handle"}

        result = res.update(HANDLE, new_handle="new-handle")

        http.patch.assert_called_once_with(
            f"/{HANDLE}", json={"agent_handle": "new-handle"}
        )
        assert result.agent_handle == "new-handle"

    def test_omitted_fields_not_sent(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DICT

        res.update(HANDLE, new_handle="new-handle")

        _, kwargs = http.patch.call_args
        assert "status" not in kwargs["json"]


class TestIdentitiesDelete:
    def test_deletes_identity(self):
        res, http = _resource()

        res.delete(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}")


class TestIdentitiesAssignMailbox:
    def test_assigns_mailbox(self):
        res, http = _resource()
        mailbox_id = "aaaa1111-0000-0000-0000-000000000001"
        http.post.return_value = IDENTITY_DETAIL_DICT

        detail = res.assign_mailbox(HANDLE, mailbox_id=mailbox_id)

        http.post.assert_called_once_with(
            f"/{HANDLE}/mailbox", json={"mailbox_id": mailbox_id}
        )
        assert isinstance(detail, _AgentIdentityData)


class TestIdentitiesUnlinkMailbox:
    def test_unlinks_mailbox(self):
        res, http = _resource()

        res.unlink_mailbox(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}/mailbox")


class TestIdentitiesAssignPhoneNumber:
    def test_assigns_phone_number(self):
        res, http = _resource()
        phone_id = "bbbb2222-0000-0000-0000-000000000001"
        http.post.return_value = IDENTITY_DETAIL_DICT

        detail = res.assign_phone_number(HANDLE, phone_number_id=phone_id)

        http.post.assert_called_once_with(
            f"/{HANDLE}/phone_number", json={"phone_number_id": phone_id}
        )
        assert isinstance(detail, _AgentIdentityData)


class TestIdentitiesUnlinkPhoneNumber:
    def test_unlinks_phone_number(self):
        res, http = _resource()

        res.unlink_phone_number(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}/phone_number")

"""
sdk/python/tests/test_identities.py

Tests for IdentitiesResource.
"""

from unittest.mock import MagicMock

from sample_data_identities import IDENTITY_DICT, IDENTITY_DETAIL_DICT
from inkbox.identities.resources.identities import IdentitiesResource
from inkbox.identities.types import AgentIdentitySummary, _AgentIdentityData


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


class TestIdentitiesUpdate:
    def test_update_handle(self):
        res, http = _resource()
        http.patch.return_value = {**IDENTITY_DICT, "agent_handle": "new-handle"}

        result = res.update(HANDLE, new_handle="new-handle")

        http.patch.assert_called_once_with(
            f"/{HANDLE}", json={"agent_handle": "new-handle"}
        )
        assert result.agent_handle == "new-handle"

    def test_update_status(self):
        res, http = _resource()
        http.patch.return_value = {**IDENTITY_DICT, "status": "paused"}

        result = res.update(HANDLE, status="paused")

        http.patch.assert_called_once_with(f"/{HANDLE}", json={"status": "paused"})
        assert result.status == "paused"

    def test_omitted_fields_not_sent(self):
        res, http = _resource()
        http.patch.return_value = IDENTITY_DICT

        res.update(HANDLE, status="active")

        _, kwargs = http.patch.call_args
        assert "agent_handle" not in kwargs["json"]


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


class TestIdentitiesAssignAuthenticatorApp:
    def test_assigns_authenticator_app(self):
        res, http = _resource()
        app_id = "cccc3333-0000-0000-0000-000000000001"
        http.post.return_value = IDENTITY_DETAIL_DICT

        detail = res.assign_authenticator_app(HANDLE, authenticator_app_id=app_id)

        http.post.assert_called_once_with(
            f"/{HANDLE}/authenticator_app", json={"authenticator_app_id": app_id}
        )
        assert isinstance(detail, _AgentIdentityData)
        assert detail.authenticator_app is not None


class TestIdentitiesUnlinkAuthenticatorApp:
    def test_unlinks_authenticator_app(self):
        res, http = _resource()

        res.unlink_authenticator_app(HANDLE)

        http.delete.assert_called_once_with(f"/{HANDLE}/authenticator_app")

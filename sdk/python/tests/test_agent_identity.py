"""Tests for AgentIdentity convenience methods."""

import pytest
from unittest.mock import MagicMock

from sample_data_identities import IDENTITY_DETAIL_DICT
from sample_data_mail import MESSAGE_DETAIL_DICT, THREAD_DETAIL_DICT

from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import _AgentIdentityData
from inkbox.mail.exceptions import InkboxError
from inkbox.mail.types import MessageDetail, ThreadDetail


def _identity_with_mailbox():
    """Return an AgentIdentity backed by a mock Inkbox client."""
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_mailbox():
    """Return an AgentIdentity with no mailbox assigned."""
    detail = {**IDENTITY_DETAIL_DICT, "mailbox": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityGetMessage:
    def test_get_message_returns_message_detail(self):
        identity, inkbox = _identity_with_mailbox()
        message_id = MESSAGE_DETAIL_DICT["id"]
        inkbox._messages.get.return_value = MessageDetail._from_dict(MESSAGE_DETAIL_DICT)

        result = identity.get_message(message_id)

        inkbox._messages.get.assert_called_once_with("sales-agent@inkbox.ai", message_id)
        assert isinstance(result, MessageDetail)
        assert str(result.id) == message_id
        assert result.body_text == "Hi there, this is a test message body."

    def test_get_message_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="no mailbox assigned"):
            identity.get_message("bbbb2222-0000-0000-0000-000000000001")


class TestAgentIdentityGetThread:
    def test_get_thread_returns_thread_detail(self):
        identity, inkbox = _identity_with_mailbox()
        thread_id = THREAD_DETAIL_DICT["id"]
        inkbox._threads.get.return_value = ThreadDetail._from_dict(THREAD_DETAIL_DICT)

        result = identity.get_thread(thread_id)

        inkbox._threads.get.assert_called_once_with("sales-agent@inkbox.ai", thread_id)
        assert isinstance(result, ThreadDetail)
        assert str(result.id) == thread_id
        assert len(result.messages) == 1

    def test_get_thread_requires_mailbox(self):
        identity, _ = _identity_without_mailbox()

        with pytest.raises(InkboxError, match="no mailbox assigned"):
            identity.get_thread("eeee5555-0000-0000-0000-000000000001")


def _identity_with_authenticator_app():
    """Return an AgentIdentity backed by a mock Inkbox client, with authenticator app."""
    data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


def _identity_without_authenticator_app():
    """Return an AgentIdentity with no authenticator app assigned."""
    detail = {**IDENTITY_DETAIL_DICT, "authenticator_app": None}
    data = _AgentIdentityData._from_dict(detail)
    inkbox = MagicMock()
    return AgentIdentity(data, inkbox), inkbox


class TestAgentIdentityCreateAuthenticatorApp:
    def test_creates_and_links_app(self):
        from inkbox.authenticator.types import AuthenticatorApp

        identity, inkbox = _identity_without_authenticator_app()
        app_data = AuthenticatorApp._from_dict({
            "id": "cccc3333-0000-0000-0000-000000000001",
            "organization_id": "org-abc123",
            "identity_id": "eeee5555-0000-0000-0000-000000000001",
            "status": "active",
            "created_at": "2026-03-18T12:00:00Z",
            "updated_at": "2026-03-18T12:00:00Z",
        })
        inkbox._auth_apps.create.return_value = app_data

        result = identity.create_authenticator_app()

        inkbox._auth_apps.create.assert_called_once_with(agent_handle="sales-agent")
        assert result is app_data
        assert identity.authenticator_app is not None


class TestAgentIdentityAssignAuthenticatorApp:
    def test_assigns_app(self):
        identity, inkbox = _identity_without_authenticator_app()
        detail_data = _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT)
        inkbox._ids_resource.assign_authenticator_app.return_value = detail_data

        result = identity.assign_authenticator_app("cccc3333-0000-0000-0000-000000000001")

        inkbox._ids_resource.assign_authenticator_app.assert_called_once_with(
            "sales-agent",
            authenticator_app_id="cccc3333-0000-0000-0000-000000000001",
        )
        assert result is not None


class TestAgentIdentityUnlinkAuthenticatorApp:
    def test_unlinks_app(self):
        identity, inkbox = _identity_with_authenticator_app()

        identity.unlink_authenticator_app()

        inkbox._ids_resource.unlink_authenticator_app.assert_called_once_with("sales-agent")
        assert identity.authenticator_app is None

    def test_requires_authenticator_app(self):
        identity, _ = _identity_without_authenticator_app()

        with pytest.raises(InkboxError, match="no authenticator app assigned"):
            identity.unlink_authenticator_app()


class TestAgentIdentityGenerateOTP:
    def test_generates_otp(self):
        from inkbox.authenticator.types import OTPCode

        identity, inkbox = _identity_with_authenticator_app()
        otp = OTPCode._from_dict({
            "otp_code": "123456",
            "valid_for_seconds": 17,
            "otp_type": "totp",
            "algorithm": "sha1",
            "digits": 6,
            "period": 30,
        })
        inkbox._auth_accounts.generate_otp.return_value = otp

        result = identity.generate_otp("dddd4444-0000-0000-0000-000000000001")

        assert result.otp_code == "123456"

    def test_requires_authenticator_app(self):
        identity, _ = _identity_without_authenticator_app()

        with pytest.raises(InkboxError, match="no authenticator app assigned"):
            identity.generate_otp("dddd4444-0000-0000-0000-000000000001")


class TestAgentIdentityListAuthenticatorAccounts:
    def test_lists_accounts(self):
        identity, inkbox = _identity_with_authenticator_app()
        inkbox._auth_accounts.list.return_value = []

        result = identity.list_authenticator_accounts()

        assert result == []

    def test_requires_authenticator_app(self):
        identity, _ = _identity_without_authenticator_app()

        with pytest.raises(InkboxError, match="no authenticator app assigned"):
            identity.list_authenticator_accounts()

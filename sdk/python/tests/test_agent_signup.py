"""
sdk/python/tests/test_agent_signup.py

Tests for the agent self-signup flow (Inkbox class methods).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from inkbox import Inkbox
from inkbox._http import sdk_user_agent
from inkbox.agent_signup.types import (
    AgentSignupResponse,
    AgentSignupResendResponse,
    AgentSignupStatusResponse,
    AgentSignupVerifyResponse,
    SignupRestrictions,
)
from inkbox.exceptions import InkboxAPIError


# ---- raw API fixtures ----

RAW_SIGNUP = {
    "email_address": "agent@inkboxmail.com",
    "organization_id": "org-123",
    "api_key": "ApiKey_abc",
    "agent_handle": "my-agent",
    "claim_status": "unclaimed",
    "human_email": "human@example.com",
    "message": "Verification email sent",
}

RAW_VERIFY = {
    "claim_status": "claimed",
    "organization_id": "org-123",
    "message": "Verified",
}

RAW_RESEND = {
    "claim_status": "pending_verification",
    "organization_id": "org-123",
    "message": "Verification email resent",
}

RAW_STATUS = {
    "claim_status": "unclaimed",
    "human_state": "pending",
    "human_email": "human@example.com",
    "restrictions": {
        "max_sends_per_day": 5,
        "allowed_recipients": ["human@example.com"],
        "can_receive": True,
        "can_create_mailboxes": False,
    },
}


def _mock_httpx_client(mock_client_cls: MagicMock, status_code: int, json_data: dict) -> MagicMock:
    """Configure the mocked httpx.Client context manager to return a response."""
    mock_response = MagicMock()
    mock_response.status_code = status_code
    mock_response.json.return_value = json_data
    mock_response.text = str(json_data)
    mock_response.headers = {}

    mock_client_instance = MagicMock()
    mock_client_instance.request.return_value = mock_response
    mock_client_instance.__enter__ = MagicMock(return_value=mock_client_instance)
    mock_client_instance.__exit__ = MagicMock(return_value=False)
    mock_client_cls.return_value = mock_client_instance
    return mock_client_instance


class TestSignup:
    def test_null_invitation_normalizes_to_none(self):
        assert AgentSignupResponse._from_dict(
            {**RAW_SIGNUP, "invitation": None}
        ).invitation is None

    @patch("httpx.Client")
    def test_signup_sends_correct_request_and_parses_response(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        result = Inkbox.signup(
            human_email="human@example.com",
            display_name="My Agent",
            note_to_human="Please approve me",
        )

        client.request.assert_called_once_with(
            "POST",
            "https://inkbox.ai/api/v1/agent-signup",
            headers={"Accept": "application/json", "User-Agent": sdk_user_agent()},
            json={
                "human_email": "human@example.com",
                "display_name": "My Agent",
                "note_to_human": "Please approve me",
            },
        )

        assert isinstance(result, AgentSignupResponse)
        assert result.email_address == "agent@inkboxmail.com"
        assert result.organization_id == "org-123"
        assert result.api_key == "ApiKey_abc"
        assert result.agent_handle == "my-agent"
        assert result.claim_status == "unclaimed"
        assert result.human_email == "human@example.com"
        assert result.message == "Verification email sent"

    @patch("httpx.Client")
    def test_signup_omits_optional_fields_by_default(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        Inkbox.signup(
            human_email="human@example.com",
            note_to_human="Please approve me",
        )

        client.request.assert_called_once_with(
            "POST",
            "https://inkbox.ai/api/v1/agent-signup",
            headers={"Accept": "application/json", "User-Agent": sdk_user_agent()},
            json={
                "human_email": "human@example.com",
                "note_to_human": "Please approve me",
            },
        )
    @patch("httpx.Client")
    def test_signup_sends_invitation_and_parses_summary(self, mock_client_cls: MagicMock):
        summary = {
            "invitation_id": "inv_1",
            "status": "awaiting_verification",
            "invitee_identity_id": "identity_2",
            "invitee_agent_handle": "buyer",
            "peer_agent_handles": ["support"],
            "accepted_at": None,
        }
        client = _mock_httpx_client(
            mock_client_cls, 200, {**RAW_SIGNUP, "invitation": summary}
        )
        result = Inkbox.signup(
            human_email="human@example.com",
            note_to_human="Please approve me",
            invitation_token="https://inkbox.ai/console/a2a/invitations/accept#token=a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        )
        assert client.request.call_args.kwargs["json"]["invitation_token"] == (
            "a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        )
        assert result.invitation is not None
        assert result.invitation.invitation_id == "inv_1"

    @patch("httpx.Client")
    def test_signup_sends_optional_handle_and_email_local_part(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        Inkbox.signup(
            human_email="human@example.com",
            note_to_human="Please approve me",
            display_name="My Agent",
            agent_handle="my-agent",
            email_local_part="my.agent",
        )

        client.request.assert_called_once_with(
            "POST",
            "https://inkbox.ai/api/v1/agent-signup",
            headers={"Accept": "application/json", "User-Agent": sdk_user_agent()},
            json={
                "human_email": "human@example.com",
                "note_to_human": "Please approve me",
                "display_name": "My Agent",
                "agent_handle": "my-agent",
                "email_local_part": "my.agent",
            },
        )

    @patch("httpx.Client")
    def test_signup_custom_base_url(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        Inkbox.signup(
            human_email="h@e.com",
            note_to_human="hi",
            base_url="https://custom.example.com",
        )

        url = client.request.call_args[0][1]
        assert url == "https://custom.example.com/api/v1/agent-signup"


class TestVerifySignup:
    @patch("httpx.Client")
    def test_verify_sends_auth_header_and_code(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_VERIFY)

        result = Inkbox.verify_signup(api_key="ApiKey_abc", verification_code="123456")

        client.request.assert_called_once_with(
            "POST",
            "https://inkbox.ai/api/v1/agent-signup/verify",
            headers={
                "Accept": "application/json",
                "User-Agent": sdk_user_agent(),
                "X-API-Key": "ApiKey_abc",
            },
            json={"verification_code": "123456"},
        )

        assert isinstance(result, AgentSignupVerifyResponse)
        assert result.claim_status == "claimed"
        assert result.organization_id == "org-123"
        assert result.message == "Verified"
        assert result.invitation is None

    @patch("httpx.Client")
    def test_verify_parses_accepted_invitation_summary(self, mock_client_cls: MagicMock):
        _mock_httpx_client(mock_client_cls, 200, {
            **RAW_VERIFY,
            "invitation": {
                "invitation_id": "inv_1",
                "status": "accepted",
                "invitee_identity_id": "identity_2",
                "invitee_agent_handle": "buyer",
                "peer_agent_handles": ["support"],
                "accepted_at": "2026-08-04T02:00:00Z",
            },
        })
        result = Inkbox.verify_signup("ApiKey_abc", "123456")
        assert result.invitation is not None
        assert result.invitation.status == "accepted"


class TestResendSignupVerification:
    @patch("httpx.Client")
    def test_resend_sends_auth_header_no_body(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_RESEND)

        result = Inkbox.resend_signup_verification(api_key="ApiKey_abc")

        client.request.assert_called_once_with(
            "POST",
            "https://inkbox.ai/api/v1/agent-signup/resend-verification",
            headers={
                "Accept": "application/json",
                "User-Agent": sdk_user_agent(),
                "X-API-Key": "ApiKey_abc",
            },
            json=None,
        )

        assert isinstance(result, AgentSignupResendResponse)
        assert result.claim_status == "pending_verification"
        assert result.organization_id == "org-123"
        assert result.message == "Verification email resent"


class TestGetSignupStatus:
    @patch("httpx.Client")
    def test_status_sends_get_with_auth_and_parses_restrictions(self, mock_client_cls: MagicMock):
        client = _mock_httpx_client(mock_client_cls, 200, RAW_STATUS)

        result = Inkbox.get_signup_status(api_key="ApiKey_abc")

        client.request.assert_called_once_with(
            "GET",
            "https://inkbox.ai/api/v1/agent-signup/status",
            headers={
                "Accept": "application/json",
                "User-Agent": sdk_user_agent(),
                "X-API-Key": "ApiKey_abc",
            },
            json=None,
        )

        assert isinstance(result, AgentSignupStatusResponse)
        assert result.claim_status == "unclaimed"
        assert result.human_state == "pending"
        assert result.human_email == "human@example.com"

        assert isinstance(result.restrictions, SignupRestrictions)
        assert result.restrictions.max_sends_per_day == 5
        assert result.restrictions.allowed_recipients == ["human@example.com"]
        assert result.restrictions.can_receive is True
        assert result.restrictions.can_create_mailboxes is False


class TestSignupErrors:
    @patch("httpx.Client")
    def test_invitation_error_preserves_structured_detail_and_retry_after(
        self, mock_client_cls: MagicMock
    ):
        mock_response = MagicMock()
        mock_response.status_code = 429
        mock_response.json.return_value = {
            "detail": {
                "code": "a2a_invitation_recipient_unavailable",
                "message": "The recipient is temporarily unavailable.",
            }
        }
        mock_response.text = "error"
        mock_response.headers = {"Retry-After": "1800"}
        mock_client_instance = MagicMock()
        mock_client_instance.request.return_value = mock_response
        mock_client_instance.__enter__ = MagicMock(return_value=mock_client_instance)
        mock_client_instance.__exit__ = MagicMock(return_value=False)
        mock_client_cls.return_value = mock_client_instance

        with pytest.raises(InkboxAPIError) as raised:
            Inkbox.signup(
                human_email="human@example.com",
                note_to_human="Please approve me",
                invitation_token="a2ai_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            )

        assert raised.value.detail == {
            "code": "a2a_invitation_recipient_unavailable",
            "message": "The recipient is temporarily unavailable.",
        }
        assert raised.value.retry_after_seconds == 1800

    @patch("httpx.Client")
    def test_raises_inkbox_api_error_on_4xx(self, mock_client_cls: MagicMock):
        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.json.return_value = {"detail": "Invalid verification code"}
        mock_response.text = "Invalid verification code"
        mock_response.headers = {}

        mock_client_instance = MagicMock()
        mock_client_instance.request.return_value = mock_response
        mock_client_instance.__enter__ = MagicMock(return_value=mock_client_instance)
        mock_client_instance.__exit__ = MagicMock(return_value=False)
        mock_client_cls.return_value = mock_client_instance

        with pytest.raises(InkboxAPIError, match="422"):
            Inkbox.verify_signup(api_key="ApiKey_abc", verification_code="000000")

    def test_rejects_non_https_base_url(self):
        with pytest.raises(ValueError, match="Only HTTPS base URLs are permitted"):
            Inkbox.signup(
                human_email="h@e.com",
                note_to_human="hi",
                base_url="http://evil.com",
            )

    @patch("httpx.Client")
    def test_allows_http_localhost(self, mock_client_cls: MagicMock):
        _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        result = Inkbox.signup(
            human_email="h@e.com",
            note_to_human="hi",
            base_url="http://localhost:8000",
        )
        assert isinstance(result, AgentSignupResponse)

    @patch("httpx.Client")
    def test_allows_http_127(self, mock_client_cls: MagicMock):
        _mock_httpx_client(mock_client_cls, 200, RAW_SIGNUP)

        result = Inkbox.signup(
            human_email="h@e.com",
            note_to_human="hi",
            base_url="http://127.0.0.1:8000",
        )
        assert isinstance(result, AgentSignupResponse)

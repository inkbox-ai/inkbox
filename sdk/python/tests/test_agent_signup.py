"""
sdk/python/tests/test_agent_signup.py

Tests for the agent self-signup flow (Inkbox class methods).
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from inkbox import Inkbox
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
        "max_sends_per_day": 10,
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

    mock_client_instance = MagicMock()
    mock_client_instance.request.return_value = mock_response
    mock_client_instance.__enter__ = MagicMock(return_value=mock_client_instance)
    mock_client_instance.__exit__ = MagicMock(return_value=False)
    mock_client_cls.return_value = mock_client_instance
    return mock_client_instance


class TestSignup:
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
            headers={"Accept": "application/json"},
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
            headers={"Accept": "application/json"},
            json={
                "human_email": "human@example.com",
                "note_to_human": "Please approve me",
            },
        )

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
            headers={"Accept": "application/json"},
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
                "X-API-Key": "ApiKey_abc",
            },
            json={"verification_code": "123456"},
        )

        assert isinstance(result, AgentSignupVerifyResponse)
        assert result.claim_status == "claimed"
        assert result.organization_id == "org-123"
        assert result.message == "Verified"


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
                "X-API-Key": "ApiKey_abc",
            },
            json=None,
        )

        assert isinstance(result, AgentSignupStatusResponse)
        assert result.claim_status == "unclaimed"
        assert result.human_state == "pending"
        assert result.human_email == "human@example.com"

        assert isinstance(result.restrictions, SignupRestrictions)
        assert result.restrictions.max_sends_per_day == 10
        assert result.restrictions.allowed_recipients == ["human@example.com"]
        assert result.restrictions.can_receive is True
        assert result.restrictions.can_create_mailboxes is False


class TestSignupErrors:
    @patch("httpx.Client")
    def test_raises_inkbox_api_error_on_4xx(self, mock_client_cls: MagicMock):
        mock_response = MagicMock()
        mock_response.status_code = 422
        mock_response.json.return_value = {"detail": "Invalid verification code"}
        mock_response.text = "Invalid verification code"

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

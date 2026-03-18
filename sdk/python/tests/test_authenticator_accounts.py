"""Tests for AuthenticatorAccountsResource."""

from unittest.mock import MagicMock

from sample_data_authenticator import AUTHENTICATOR_ACCOUNT_DICT, OTP_CODE_DICT
from inkbox.authenticator.resources.accounts import AuthenticatorAccountsResource
from inkbox.authenticator.types import AuthenticatorAccount, OTPCode


def _resource():
    http = MagicMock()
    return AuthenticatorAccountsResource(http), http


APP_ID = "cccc3333-0000-0000-0000-000000000001"
ACCOUNT_ID = "dddd4444-0000-0000-0000-000000000001"
OTPAUTH_URI = "otpauth://totp/GitHub:alice@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub"


class TestAuthenticatorAccountsCreate:
    def test_creates_account(self):
        res, http = _resource()
        http.post.return_value = AUTHENTICATOR_ACCOUNT_DICT

        account = res.create(
            APP_ID,
            otpauth_uri=OTPAUTH_URI,
            display_name="GitHub Work",
            description="Primary engineering account",
        )

        http.post.assert_called_once_with(
            f"/apps/{APP_ID}/accounts",
            json={
                "otpauth_uri": OTPAUTH_URI,
                "display_name": "GitHub Work",
                "description": "Primary engineering account",
            },
        )
        assert isinstance(account, AuthenticatorAccount)
        assert account.otp_type == "totp"
        assert account.issuer == "GitHub"

    def test_creates_account_minimal(self):
        res, http = _resource()
        http.post.return_value = AUTHENTICATOR_ACCOUNT_DICT

        res.create(APP_ID, otpauth_uri=OTPAUTH_URI)

        _, kwargs = http.post.call_args
        assert "display_name" not in kwargs["json"]
        assert "description" not in kwargs["json"]


class TestAuthenticatorAccountsList:
    def test_returns_list(self):
        res, http = _resource()
        http.get.return_value = [AUTHENTICATOR_ACCOUNT_DICT]

        accounts = res.list(APP_ID)

        http.get.assert_called_once_with(f"/apps/{APP_ID}/accounts")
        assert len(accounts) == 1
        assert isinstance(accounts[0], AuthenticatorAccount)

    def test_empty_list(self):
        res, http = _resource()
        http.get.return_value = []

        assert res.list(APP_ID) == []


class TestAuthenticatorAccountsGet:
    def test_returns_account(self):
        res, http = _resource()
        http.get.return_value = AUTHENTICATOR_ACCOUNT_DICT

        account = res.get(APP_ID, ACCOUNT_ID)

        http.get.assert_called_once_with(f"/apps/{APP_ID}/accounts/{ACCOUNT_ID}")
        assert isinstance(account, AuthenticatorAccount)
        assert str(account.id) == ACCOUNT_ID


class TestAuthenticatorAccountsUpdate:
    def test_updates_metadata(self):
        res, http = _resource()
        http.patch.return_value = {**AUTHENTICATOR_ACCOUNT_DICT, "display_name": "Renamed"}

        account = res.update(APP_ID, ACCOUNT_ID, display_name="Renamed")

        http.patch.assert_called_once_with(
            f"/apps/{APP_ID}/accounts/{ACCOUNT_ID}",
            json={"display_name": "Renamed"},
        )
        assert account.display_name == "Renamed"

    def test_clears_field_with_none(self):
        res, http = _resource()
        http.patch.return_value = {**AUTHENTICATOR_ACCOUNT_DICT, "description": None}

        res.update(APP_ID, ACCOUNT_ID, description=None)

        _, kwargs = http.patch.call_args
        assert kwargs["json"]["description"] is None

    def test_omitted_fields_not_sent(self):
        res, http = _resource()
        http.patch.return_value = AUTHENTICATOR_ACCOUNT_DICT

        res.update(APP_ID, ACCOUNT_ID, display_name="Test")

        _, kwargs = http.patch.call_args
        assert "description" not in kwargs["json"]


class TestAuthenticatorAccountsDelete:
    def test_deletes_account(self):
        res, http = _resource()

        res.delete(APP_ID, ACCOUNT_ID)

        http.delete.assert_called_once_with(f"/apps/{APP_ID}/accounts/{ACCOUNT_ID}")


class TestAuthenticatorAccountsGenerateOTP:
    def test_generates_otp(self):
        res, http = _resource()
        http.post.return_value = OTP_CODE_DICT

        otp = res.generate_otp(APP_ID, ACCOUNT_ID)

        http.post.assert_called_once_with(
            f"/apps/{APP_ID}/accounts/{ACCOUNT_ID}/generate-otp",
        )
        assert isinstance(otp, OTPCode)
        assert otp.otp_code == "123456"
        assert otp.valid_for_seconds == 17
        assert otp.otp_type == "totp"
        assert otp.algorithm == "sha1"
        assert otp.digits == 6
        assert otp.period == 30

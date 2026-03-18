"""
inkbox/authenticator/resources/accounts.py

Authenticator account CRUD and OTP generation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.authenticator.types import AuthenticatorAccount, OTPCode

if TYPE_CHECKING:
    from inkbox.authenticator._http import HttpTransport

_UNSET = object()


class AuthenticatorAccountsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(
        self,
        authenticator_app_id: UUID | str,
        *,
        otpauth_uri: str,
        display_name: str | None = None,
        description: str | None = None,
    ) -> AuthenticatorAccount:
        """Create a new authenticator account from an ``otpauth://`` URI.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
            otpauth_uri: ``otpauth://totp/...`` or ``otpauth://hotp/...`` URI.
            display_name: Optional user-managed label (max 255 characters).
            description: Optional free-form notes.

        Returns:
            The created authenticator account.
        """
        body: dict[str, Any] = {"otpauth_uri": otpauth_uri}
        if display_name is not None:
            body["display_name"] = display_name
        if description is not None:
            body["description"] = description
        data = self._http.post(
            f"/apps/{authenticator_app_id}/accounts", json=body
        )
        return AuthenticatorAccount._from_dict(data)

    def list(self, authenticator_app_id: UUID | str) -> list[AuthenticatorAccount]:
        """List all non-deleted authenticator accounts for an app.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
        """
        data = self._http.get(f"/apps/{authenticator_app_id}/accounts")
        return [AuthenticatorAccount._from_dict(a) for a in data]

    def get(
        self,
        authenticator_app_id: UUID | str,
        account_id: UUID | str,
    ) -> AuthenticatorAccount:
        """Get a single authenticator account by ID.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
            account_id: UUID of the authenticator account.
        """
        data = self._http.get(
            f"/apps/{authenticator_app_id}/accounts/{account_id}"
        )
        return AuthenticatorAccount._from_dict(data)

    def update(
        self,
        authenticator_app_id: UUID | str,
        account_id: UUID | str,
        *,
        display_name: str | None = _UNSET,  # type: ignore[assignment]
        description: str | None = _UNSET,  # type: ignore[assignment]
    ) -> AuthenticatorAccount:
        """Update user-managed account metadata.

        Only provided fields are applied; omitted fields are left unchanged.
        Pass ``None`` to clear a field.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
            account_id: UUID of the authenticator account to update.
            display_name: New label (max 255 characters), or ``None`` to clear.
            description: New notes, or ``None`` to clear.

        Returns:
            The updated authenticator account.
        """
        body: dict[str, Any] = {}
        if display_name is not _UNSET:
            body["display_name"] = display_name
        if description is not _UNSET:
            body["description"] = description
        data = self._http.patch(
            f"/apps/{authenticator_app_id}/accounts/{account_id}",
            json=body,
        )
        return AuthenticatorAccount._from_dict(data)

    def delete(
        self,
        authenticator_app_id: UUID | str,
        account_id: UUID | str,
    ) -> None:
        """Soft-delete an authenticator account.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
            account_id: UUID of the authenticator account to delete.
        """
        self._http.delete(
            f"/apps/{authenticator_app_id}/accounts/{account_id}"
        )

    def generate_otp(
        self,
        authenticator_app_id: UUID | str,
        account_id: UUID | str,
    ) -> OTPCode:
        """Generate the current OTP code for an account.

        For TOTP accounts, ``valid_for_seconds`` indicates time until expiry.
        For HOTP accounts, the stored counter is incremented atomically and
        ``valid_for_seconds`` is ``None``.

        Args:
            authenticator_app_id: UUID of the parent authenticator app.
            account_id: UUID of the authenticator account.

        Returns:
            The generated OTP code with metadata.
        """
        data = self._http.post(
            f"/apps/{authenticator_app_id}/accounts/{account_id}/generate-otp",
        )
        return OTPCode._from_dict(data)

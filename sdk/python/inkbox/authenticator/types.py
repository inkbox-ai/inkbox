"""
inkbox/authenticator/types.py

Dataclasses mirroring the Inkbox Authenticator API response models.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID


@dataclass
class AuthenticatorApp:
    """An org-scoped authenticator app container for OTP accounts."""

    id: UUID
    organization_id: str
    identity_id: UUID | None
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AuthenticatorApp:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            identity_id=UUID(d["identity_id"]) if d.get("identity_id") else None,
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class AuthenticatorAccount:
    """An OTP account within an authenticator app."""

    id: UUID
    authenticator_app_id: UUID
    otp_type: str
    issuer: str | None
    account_name: str | None
    display_name: str | None
    description: str | None
    algorithm: str
    digits: int
    period: int | None
    counter: int | None
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> AuthenticatorAccount:
        return cls(
            id=UUID(d["id"]),
            authenticator_app_id=UUID(d["authenticator_app_id"]),
            otp_type=d["otp_type"],
            issuer=d.get("issuer"),
            account_name=d.get("account_name"),
            display_name=d.get("display_name"),
            description=d.get("description"),
            algorithm=d["algorithm"],
            digits=d["digits"],
            period=d.get("period"),
            counter=d.get("counter"),
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class OTPCode:
    """A generated OTP code."""

    otp_code: str
    valid_for_seconds: int | None
    otp_type: str
    algorithm: str
    digits: int
    period: int | None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> OTPCode:
        return cls(
            otp_code=d["otp_code"],
            valid_for_seconds=d.get("valid_for_seconds"),
            otp_type=d["otp_type"],
            algorithm=d["algorithm"],
            digits=d["digits"],
            period=d.get("period"),
        )

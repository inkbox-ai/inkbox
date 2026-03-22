"""
inkbox/vault/types.py

Dataclasses mirroring the Inkbox Vault API response models and
client-side structured secret payloads.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Union
from uuid import UUID


## API response types

@dataclass
class VaultInfo:
    """Vault metadata returned by the info endpoint."""

    id: UUID
    organization_id: str
    status: str
    created_at: datetime
    updated_at: datetime
    key_count: int
    secret_count: int
    recovery_key_count: int

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> VaultInfo:
        return cls(
            id=UUID(d["id"]),
            organization_id=d["organization_id"],
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            key_count=d["key_count"],
            secret_count=d["secret_count"],
            recovery_key_count=d["recovery_key_count"],
        )


@dataclass
class VaultKey:
    """Vault key metadata (no wrapped key material)."""

    id: UUID
    key_type: str
    created_by: str | None
    status: str
    created_at: datetime
    updated_at: datetime

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> VaultKey:
        return cls(
            id=UUID(d["id"]),
            key_type=d["key_type"],
            created_by=d.get("created_by"),
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
        )


@dataclass
class VaultSecret:
    """Vault secret metadata (no encrypted payload)."""

    id: UUID
    name: str
    secret_type: str
    status: str
    created_at: datetime
    updated_at: datetime
    description: str | None = None

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> VaultSecret:
        return cls(
            id=UUID(d["id"]),
            name=d["name"],
            secret_type=d["secret_type"],
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            description=d.get("description"),
        )


@dataclass
class VaultSecretDetail(VaultSecret):
    """Vault secret including the encrypted payload (base64)."""

    encrypted_payload: str = ""

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> VaultSecretDetail:
        return cls(
            id=UUID(d["id"]),
            name=d["name"],
            secret_type=d["secret_type"],
            status=d["status"],
            created_at=datetime.fromisoformat(d["created_at"]),
            updated_at=datetime.fromisoformat(d["updated_at"]),
            description=d.get("description"),
            encrypted_payload=d["encrypted_payload"],
        )


## Client-side structured secret payloads

@dataclass
class LoginPayload:
    """
    Structured payload for ``login`` secrets.

    Attributes:
        username: Login username or email.
        password: Login password.
        url: Optional URL of the service.
        notes: Optional free-form notes.
    """

    username: str
    password: str
    url: str | None = None
    notes: str | None = None

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "username": self.username,
            "password": self.password,
        }
        if self.url is not None:
            d["url"] = self.url
        if self.notes is not None:
            d["notes"] = self.notes
        return d

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> LoginPayload:
        return cls(
            username=d["username"],
            password=d["password"],
            url=d.get("url"),
            notes=d.get("notes"),
        )


@dataclass
class SSHKeyPayload:
    """
    Structured payload for ``ssh_key`` secrets.

    Attributes:
        private_key: The SSH private key (PEM or OpenSSH format).
        public_key: Optional corresponding public key.
        fingerprint: Optional key fingerprint.
        passphrase: Optional passphrase protecting the private key.
        notes: Optional free-form notes.
    """

    private_key: str
    public_key: str | None = None
    fingerprint: str | None = None
    passphrase: str | None = None
    notes: str | None = None

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "private_key": self.private_key,
        }
        if self.public_key is not None:
            d["public_key"] = self.public_key
        if self.fingerprint is not None:
            d["fingerprint"] = self.fingerprint
        if self.passphrase is not None:
            d["passphrase"] = self.passphrase
        if self.notes is not None:
            d["notes"] = self.notes
        return d

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> SSHKeyPayload:
        return cls(
            private_key=d["private_key"],
            public_key=d.get("public_key"),
            fingerprint=d.get("fingerprint"),
            passphrase=d.get("passphrase"),
            notes=d.get("notes"),
        )


@dataclass
class APIKeyPayload:
    """
    Structured payload for ``api_key`` secrets.

    Attributes:
        key: The API key or access key.
        secret: Optional API secret or secret key.
        endpoint: Optional API endpoint URL.
        notes: Optional free-form notes.
    """

    key: str
    secret: str | None = None
    endpoint: str | None = None
    notes: str | None = None

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "key": self.key,
        }
        if self.secret is not None:
            d["secret"] = self.secret
        if self.endpoint is not None:
            d["endpoint"] = self.endpoint
        if self.notes is not None:
            d["notes"] = self.notes
        return d

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> APIKeyPayload:
        return cls(
            key=d["key"],
            secret=d.get("secret"),
            endpoint=d.get("endpoint"),
            notes=d.get("notes"),
        )


@dataclass
class OtherPayload:
    """
    Structured payload for ``other`` secrets.

    Attributes:
        data: Any freeform content.
    """

    data: str

    def _to_dict(self) -> dict[str, Any]:
        return {
            "data": self.data,
        }

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> OtherPayload:
        return cls(
            data=d["data"],
        )


# Union of all payload types
SecretPayload = Union[LoginPayload, SSHKeyPayload, APIKeyPayload, OtherPayload]

# Map secret_type string → payload class
_PAYLOAD_PARSERS: dict[str, type] = {
    "login": LoginPayload,
    "ssh_key": SSHKeyPayload,
    "api_key": APIKeyPayload,
    "other": OtherPayload,
}


def _parse_payload(secret_type: str, raw: dict[str, Any]) -> SecretPayload:
    """Deserialize a raw dict into the correct payload dataclass."""
    cls = _PAYLOAD_PARSERS.get(secret_type)
    if cls is None:
        raise ValueError(f"Unknown secret_type: {secret_type!r}")
    return cls._from_dict(raw)


def _infer_secret_type(payload: SecretPayload) -> str:
    """Infer the ``secret_type`` string from a payload instance."""
    _TYPE_MAP: dict[type, str] = {
        LoginPayload: "login",
        SSHKeyPayload: "ssh_key",
        APIKeyPayload: "api_key",
        OtherPayload: "other",
    }
    t = _TYPE_MAP.get(type(payload))
    if t is None:
        raise TypeError(f"Unknown payload type: {type(payload).__name__}")
    return t


@dataclass
class DecryptedVaultSecret:
    """A vault secret with its payload decrypted into a structured type.

    Attributes:
        id: Secret UUID.
        name: Display name.
        description: Optional description.
        secret_type: Credential category (``login``, ``ssh_key``,
            ``api_key``, ``other``).
        status: Lifecycle status.
        created_at: Creation timestamp.
        updated_at: Last modification timestamp.
        payload: The decrypted, structured payload.
    """

    id: UUID
    name: str
    secret_type: str
    status: str
    created_at: datetime
    updated_at: datetime
    payload: SecretPayload
    description: str | None = None

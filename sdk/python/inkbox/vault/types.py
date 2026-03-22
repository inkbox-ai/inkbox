"""
inkbox/vault/types.py

Dataclasses mirroring the Inkbox Vault API response models and
client-side structured secret payloads.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum
from typing import Any, ClassVar
from uuid import UUID


## Enums

class VaultSecretType(StrEnum):
    """
    Category of credential stored in a vault secret.

    Used as a client-side hint for which form to render. The server
    does not validate or enforce payload structure (it's opaque ciphertext).

    Attributes:
        API_KEY: API key or access-key/secret-key pair.
        LOGIN: Username/password combination, optionally with URL.
        SSH_KEY: SSH private key, optionally with public key/fingerprint.
        OTHER: Freeform encrypted catch-all.
    """
    API_KEY = "api_key"
    LOGIN = "login"
    SSH_KEY = "ssh_key"
    OTHER = "other"


class VaultKeyType(StrEnum):
    """
    Discriminator for vault key records.

    Attributes:
        PRIMARY: A standard vault key issued to users or agents.
        RECOVERY: A recovery code generated at vault initialization,
            intended for offline backup.
    """
    PRIMARY = "primary"
    RECOVERY = "recovery"


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
class AbstractSecretPayload(ABC):
    """
    Abstract base for all secret payload types.

    Each subclass sets :attr:`secret_type` as a class-level discriminator
    so the correct type can be inferred without isinstance checks.

    Attributes:
        notes: Optional free-form notes.
    """

    secret_type: ClassVar[VaultSecretType]  # discriminator
    notes: str | None = field(default=None, kw_only=True)

    @abstractmethod
    def _to_dict(self) -> dict[str, Any]:
        ...

    @classmethod
    @abstractmethod
    def _from_dict(cls, d: dict[str, Any]) -> AbstractSecretPayload:
        ...


@dataclass
class LoginPayload(AbstractSecretPayload):
    """
    Structured payload for ``login`` secrets.

    Attributes:
        username: Login username or email.
        password: Login password.
        url: Optional URL of the service.
    """

    secret_type: ClassVar[VaultSecretType] = VaultSecretType.LOGIN

    username: str
    password: str
    url: str | None = None
    # TODO: store TOTP data structure here

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
class SSHKeyPayload(AbstractSecretPayload):
    """
    Structured payload for ``ssh_key`` secrets.

    Attributes:
        private_key: The SSH private key (PEM or OpenSSH format).
        public_key: Optional corresponding public key.
        fingerprint: Optional key fingerprint.
        passphrase: Optional passphrase protecting the private key.
    """

    secret_type: ClassVar[VaultSecretType] = VaultSecretType.SSH_KEY

    private_key: str
    public_key: str | None = None
    fingerprint: str | None = None
    passphrase: str | None = None

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
class APIKeyPayload(AbstractSecretPayload):
    """
    Structured payload for ``api_key`` secrets.

    Attributes:
        key: The API key or access key.
        secret: Optional API secret or secret key.
        endpoint: Optional API endpoint URL.
    """

    secret_type: ClassVar[VaultSecretType] = VaultSecretType.API_KEY

    key: str
    secret: str | None = None
    endpoint: str | None = None

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
class OtherPayload(AbstractSecretPayload):
    """
    Structured payload for ``other`` secrets.

    Attributes:
        data: Any freeform content.
    """

    secret_type: ClassVar[VaultSecretType] = VaultSecretType.OTHER

    data: str

    def _to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {"data": self.data}
        if self.notes is not None:
            d["notes"] = self.notes
        return d

    @classmethod
    def _from_dict(cls, d: dict[str, Any]) -> OtherPayload:
        return cls(
            data=d["data"],
            notes=d.get("notes"),
        )


# Type alias — use the abstract base directly; all concrete payloads inherit from it.
SecretPayload = AbstractSecretPayload

# Registry: VaultSecretType → payload class (built from subclasses defined above)
_PAYLOAD_REGISTRY: dict[VaultSecretType, type[AbstractSecretPayload]] = {
    cls.secret_type: cls
    for cls in AbstractSecretPayload.__subclasses__()
}


def _parse_payload(secret_type: str, raw: dict[str, Any]) -> SecretPayload:
    """Deserialize a raw dict into the correct payload dataclass."""
    cls = _PAYLOAD_REGISTRY.get(VaultSecretType(secret_type))
    if cls is None:
        raise ValueError(f"Unknown secret_type: {secret_type!r}")
    return cls._from_dict(raw)  # type: ignore[return-value]


def _infer_secret_type(payload: SecretPayload) -> str:
    """Return the ``secret_type`` string from a payload's class-level discriminator."""
    return payload.secret_type.value


@dataclass
class DecryptedVaultSecret:
    """
    A vault secret with its payload decrypted into a structured type.

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

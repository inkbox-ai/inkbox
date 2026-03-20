"""
inkbox/vault/resources/vault.py

VaultResource — org-level vault operations.
UnlockedVault — crypto-enabled wrapper for secret CRUD after unlock.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.vault.crypto import (
    compute_auth_hash,
    decrypt_payload,
    derive_master_key,
    derive_salt,
    encrypt_payload,
    unwrap_org_key,
)
from inkbox.vault.types import (
    DecryptedVaultSecret,
    SecretPayload,
    VaultInfo,
    VaultKey,
    VaultSecret,
    VaultSecretDetail,
    _infer_secret_type,
    _parse_payload,
)

if TYPE_CHECKING:
    from inkbox.vault._http import HttpTransport

_UNSET = object()


class VaultResource:
    """Org-level vault operations.

    Obtain via ``inkbox.vault``.  Most read-only operations work without
    unlocking.  To create, read, or update secret *payloads* call
    :meth:`unlock` first.
    """

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    # ------------------------------------------------------------------
    # Vault metadata
    # ------------------------------------------------------------------

    def info(self) -> VaultInfo:
        """Get vault metadata for the caller's organisation.

        Returns:
            :class:`~inkbox.vault.types.VaultInfo` with counts and status.
        """
        data = self._http.get("/info")
        return VaultInfo._from_dict(data)

    # ------------------------------------------------------------------
    # Keys (read-only via API key)
    # ------------------------------------------------------------------

    def list_keys(self, *, key_type: str | None = None) -> list[VaultKey]:
        """List vault keys (metadata only — no wrapped key material).

        Args:
            key_type: Optional filter: ``"primary"`` or ``"recovery"``.
        """
        params: dict[str, Any] = {}
        if key_type is not None:
            params["type"] = key_type
        data = self._http.get("/keys", params=params)
        return [VaultKey._from_dict(k) for k in data]

    # ------------------------------------------------------------------
    # Secrets (metadata-only operations)
    # ------------------------------------------------------------------

    def list_secrets(self, *, secret_type: str | None = None) -> list[VaultSecret]:
        """List vault secrets (metadata only, no encrypted payload).

        Args:
            secret_type: Optional filter: ``"login"``, ``"card"``,
                ``"note"``, ``"ssh_key"``, or ``"api_key"``.
        """
        params: dict[str, Any] = {}
        if secret_type is not None:
            params["secret_type"] = secret_type
        data = self._http.get("/secrets", params=params)
        return [VaultSecret._from_dict(s) for s in data]

    def delete_secret(self, secret_id: UUID | str) -> None:
        """Delete a vault secret.

        Args:
            secret_id: UUID of the secret to delete.
        """
        self._http.delete(f"/secrets/{secret_id}")

    # ------------------------------------------------------------------
    # Unlock
    # ------------------------------------------------------------------

    def unlock(self, password: str) -> UnlockedVault:
        """Unlock the vault with a password.

        Derives the encryption key from the provided password, fetches
        and decrypts all vault secrets.

        Args:
            password: Vault password or recovery code.

        Returns:
            :class:`UnlockedVault` with decrypted secrets and methods for
            secret CRUD.

        Raises:
            ValueError: If the password is incorrect or the vault key
                has been deleted.
        """
        # Step 1: get org_id for salt derivation
        vault_info = self.info()
        salt = derive_salt(vault_info.organization_id)

        # Step 2: derive master key → auth hash
        master_key = derive_master_key(password, salt)
        auth_hash = compute_auth_hash(master_key)

        # Step 3: fetch wrapped key + encrypted secrets
        # We always send auth_hash, so the server returns the singular
        # wrapped_org_encryption_key for the matching vault key.  The
        # plural wrapped_org_encryption_keys is only returned when
        # auth_hash is omitted (a recovery flow this SDK does not use,
        # since recovery codes are derived the same way as passwords).
        data = self._http.get("/unlock", params={"auth_hash": auth_hash})

        wrapped = data.get("wrapped_org_encryption_key")
        if wrapped is None:
            raise ValueError(
                "No vault key matched this password. "
                "Check that the password is correct and the key has not been deleted."
            )

        # Step 4: unwrap the org encryption key
        org_key = unwrap_org_key(master_key, wrapped)

        # Step 5: decrypt all secrets from the unlock bundle
        decrypted: list[DecryptedVaultSecret] = []
        for raw in data.get("encrypted_secrets", []):
            detail = VaultSecretDetail._from_dict(raw)
            payload_dict = decrypt_payload(org_key, detail.encrypted_payload)
            payload = _parse_payload(detail.secret_type, payload_dict)
            decrypted.append(
                DecryptedVaultSecret(
                    id=detail.id,
                    label=detail.label,
                    secret_type=detail.secret_type,
                    status=detail.status,
                    created_at=detail.created_at,
                    updated_at=detail.updated_at,
                    payload=payload,
                )
            )

        return UnlockedVault(http=self._http, org_key=org_key, secrets_cache=decrypted)


class UnlockedVault:
    """A vault unlocked with a valid password.

    Provides transparent encrypt/decrypt for secret CRUD operations.

    Obtain via :meth:`VaultResource.unlock`.
    """

    def __init__(
        self,
        http: HttpTransport,
        org_key: bytes,
        secrets_cache: list[DecryptedVaultSecret],
    ) -> None:
        self._http = http
        self._org_key = org_key
        self._secrets_cache = secrets_cache

    @property
    def secrets(self) -> list[DecryptedVaultSecret]:
        """All vault secrets decrypted from the unlock response."""
        return list(self._secrets_cache)

    # ------------------------------------------------------------------
    # Encrypted CRUD
    # ------------------------------------------------------------------

    def get_secret(self, secret_id: UUID | str) -> DecryptedVaultSecret:
        """Fetch and decrypt a single vault secret.

        Args:
            secret_id: UUID of the secret.

        Returns:
            :class:`~inkbox.vault.types.DecryptedVaultSecret`.
        """
        data = self._http.get(f"/secrets/{secret_id}")
        detail = VaultSecretDetail._from_dict(data)
        payload_dict = decrypt_payload(self._org_key, detail.encrypted_payload)
        payload = _parse_payload(detail.secret_type, payload_dict)
        return DecryptedVaultSecret(
            id=detail.id,
            label=detail.label,
            secret_type=detail.secret_type,
            status=detail.status,
            created_at=detail.created_at,
            updated_at=detail.updated_at,
            payload=payload,
        )

    def create_secret(
        self,
        label: str,
        payload: SecretPayload,
    ) -> VaultSecret:
        """Encrypt and store a new secret.

        The ``secret_type`` is inferred from the payload type.

        Args:
            label: Display name (max 255 characters).
            payload: One of :class:`LoginPayload`, :class:`CardPayload`,
                :class:`NotePayload`, :class:`SSHKeyPayload`, or
                :class:`APIKeyPayload`.

        Returns:
            :class:`~inkbox.vault.types.VaultSecret` metadata (no payload).
        """
        secret_type = _infer_secret_type(payload)
        encrypted = encrypt_payload(self._org_key, payload._to_dict())
        body: dict[str, Any] = {
            "label": label,
            "secret_type": secret_type,
            "encrypted_payload": encrypted,
        }
        data = self._http.post(
            path="/secrets",
            json=body,
        )
        return VaultSecret._from_dict(data)

    def update_secret(
        self,
        secret_id: UUID | str,
        *,
        label: str | None = _UNSET,  # type: ignore[assignment]
        payload: SecretPayload | None = _UNSET,  # type: ignore[assignment]
    ) -> VaultSecret:
        """
        Update a vault secret's label and/or encrypted payload.

        Only provided arguments are sent to the server.

        .. note::

           The ``secret_type`` is immutable after creation.  If a payload
           is provided it must be the **same type** as the original (e.g.
           update a ``login`` secret with a new :class:`LoginPayload`).
           To change the type, delete the secret and create a new one.

        Args:
            secret_id: UUID of the secret to update.
            label: New display name.
            payload: New payload of the **same type** as the original
                (will be re-encrypted).

        Returns:
            :class:`~inkbox.vault.types.VaultSecret` metadata.
        """
        body: dict[str, Any] = {}
        if label is not _UNSET:
            body["label"] = label
        if payload is not _UNSET and payload is not None:
            body["encrypted_payload"] = encrypt_payload(
                self._org_key,
                payload._to_dict()
            )
        data = self._http.patch(
            f"/secrets/{secret_id}",
            json=body,
        )
        return VaultSecret._from_dict(data)

    def delete_secret(self, secret_id: UUID | str) -> None:
        """Delete a vault secret.

        Args:
            secret_id: UUID of the secret to delete.
        """
        self._http.delete(f"/secrets/{secret_id}")

"""
inkbox/vault/resources/vault.py

VaultResource: org-level vault operations.
UnlockedVault: crypto-enabled wrapper for secret CRUD after unlock.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any
from uuid import UUID

from inkbox.vault.totp import TOTPCode, TOTPConfig, generate_totp, parse_totp_uri
from inkbox.vault.crypto import (
    compute_auth_hash,
    decrypt_payload,
    derive_master_key,
    derive_salt,
    encrypt_payload,
    unwrap_org_key,
)
from inkbox.vault.types import (
    AccessRule,
    DecryptedVaultSecret,
    SecretPayload,
    VaultInfo,
    VaultKey,
    VaultSecret,
    VaultSecretDetail,
    VaultSecretType,
    _infer_secret_type,
    _parse_payload,
)

if TYPE_CHECKING:
    from inkbox.vault._http import HttpTransport

_UNSET = object()


class VaultResource:
    """
    Org-level vault operations.

    Obtain via ``inkbox.vault``.  Most read-only operations work without
    unlocking.  To create, read, or update secret *payloads* call
    :meth:`unlock` first.
    """

    def __init__(self, http: HttpTransport) -> None:
        self._http = http
        self._unlocked: UnlockedVault | None = None

    ## Vault metadata

    def info(self) -> VaultInfo:
        """
        Get vault metadata for the caller's organisation.

        Returns:
            :class:`~inkbox.vault.types.VaultInfo` with counts and status.
        """
        data = self._http.get("/info")
        return VaultInfo._from_dict(data)

    ## Keys (read-only via API key)

    def list_keys(self, *, key_type: str | None = None) -> list[VaultKey]:
        """
        List vault keys (metadata only, no wrapped key material).

        Args:
            key_type: Optional filter: ``"primary"`` or ``"recovery"``.
        """
        params: dict[str, Any] = {}
        if key_type is not None:
            params["type"] = key_type
        data = self._http.get("/keys", params=params)
        return [VaultKey._from_dict(k) for k in data]

    ## Secrets (metadata-only operations)

    def list_secrets(self, *, secret_type: str | None = None) -> list[VaultSecret]:
        """
        List vault secrets (metadata only, no encrypted payload).

        Args:
            secret_type: Optional filter: ``"login"``, ``"ssh_key"``,
                ``"api_key"``, or ``"other"``.
        """
        params: dict[str, Any] = {}
        if secret_type is not None:
            params["secret_type"] = secret_type
        data = self._http.get("/secrets", params=params)
        return [VaultSecret._from_dict(s) for s in data]

    def delete_secret(self, secret_id: UUID | str) -> None:
        """
        Delete a vault secret.

        Args:
            secret_id: UUID of the secret to delete.
        """
        self._http.delete(f"/secrets/{secret_id}")

    ## Access rules

    def list_access_rules(self, secret_id: UUID | str) -> list[AccessRule]:
        """
        List identity access rules for a vault secret.

        Args:
            secret_id: UUID of the secret.
        """
        data = self._http.get(f"/secrets/{secret_id}/access")
        return [AccessRule._from_dict(r) for r in data]

    def grant_access(self, secret_id: UUID | str, identity_id: UUID | str) -> AccessRule:
        """
        Grant an identity access to a vault secret.

        Args:
            secret_id: UUID of the secret.
            identity_id: UUID of the identity to grant access to.
        """
        data = self._http.post(
            f"/secrets/{secret_id}/access",
            json={"identity_id": str(identity_id)},
        )
        return AccessRule._from_dict(data)

    def revoke_access(self, secret_id: UUID | str, identity_id: UUID | str) -> None:
        """
        Revoke an identity's access to a vault secret.

        Args:
            secret_id: UUID of the secret.
            identity_id: UUID of the identity to revoke access from.
        """
        self._http.delete(
            f"/secrets/{secret_id}/access/{identity_id}",
        )

    ## Unlock

    def unlock(
        self,
        vault_key: str,
        *,
        identity_id: UUID | str | None = None,
    ) -> UnlockedVault:
        """
        Unlock the vault with a vault key.

        Derives the encryption key from the provided vault key, fetches
        and decrypts all vault secrets.

        Args:
            vault_key: Vault key or recovery code.
            identity_id: Optional agent identity UUID.  When provided,
                only secrets that this identity has been granted access
                to are included in :attr:`UnlockedVault.secrets`.

        Returns:
            :class:`UnlockedVault` with decrypted secrets and methods for
            secret CRUD.

        Raises:
            ValueError: If the vault key is incorrect or the vault key
                has been deleted.
        """
        # Step 1: get org_id for salt derivation
        vault_info = self.info()
        salt = derive_salt(vault_info.organization_id)

        # Step 2: derive master key → auth hash
        master_key = derive_master_key(vault_key, salt)
        auth_hash = compute_auth_hash(master_key)

        # Step 3: fetch wrapped key + encrypted secrets
        # We always send auth_hash, so the server returns the singular
        # wrapped_org_encryption_key for the matching vault key.  The
        # plural wrapped_org_encryption_keys is only returned when
        # auth_hash is omitted (a recovery flow this SDK does not use,
        # since recovery codes are derived the same way as vault keys).
        data = self._http.get("/unlock", params={"auth_hash": auth_hash})

        wrapped = data.get("wrapped_org_encryption_key")
        if wrapped is None:
            raise ValueError(
                "No vault key matched. "
                "Check that the vault key is correct and has not been deleted."
            )

        # Step 4: unwrap the org encryption key.
        # The wrapped key was encrypted with the vault key UUID as AAD.
        # Fetch all key IDs and try each as AAD until one works.
        keys_data = self._http.get("/keys")
        primary_key_ids = [
            k["id"] for k in keys_data
            if k.get("key_type") == "primary" and k.get("status") == "active"
        ]
        recovery_key_ids = [
            k["id"] for k in keys_data
            if k.get("key_type") == "recovery" and k.get("status") == "active"
        ]
        all_key_ids = primary_key_ids + recovery_key_ids

        org_key: bytes | None = None
        for key_id in all_key_ids:
            try:
                org_key = unwrap_org_key(master_key, wrapped, vault_key_id=key_id)
                break
            except Exception:
                continue

        if org_key is None:
            # Fallback: try without AAD (for vaults initialized by older SDK versions)
            try:
                org_key = unwrap_org_key(master_key, wrapped, vault_key_id="")
            except Exception:
                raise ValueError(
                    "Failed to unwrap org encryption key. "
                    "Check that the vault key is correct."
                ) from None

        # Step 5: decrypt all secrets from the unlock bundle
        decrypted: list[DecryptedVaultSecret] = []
        for raw in data.get("encrypted_secrets", []):
            detail = VaultSecretDetail._from_dict(raw)
            # Try with secret ID as AAD, fall back to empty AAD
            try:
                payload_dict = decrypt_payload(org_key, detail.encrypted_payload, secret_id=str(detail.id))
            except Exception:
                payload_dict = decrypt_payload(org_key, detail.encrypted_payload, secret_id="")
            payload = _parse_payload(detail.secret_type, payload_dict)
            decrypted.append(
                DecryptedVaultSecret(
                    id=detail.id,
                    name=detail.name,
                    secret_type=detail.secret_type,
                    status=detail.status,
                    created_at=detail.created_at,
                    updated_at=detail.updated_at,
                    payload=payload,
                    description=detail.description,
                )
            )

        # Always store the unfiltered vault so identity.credentials
        # has the full set to filter from, even when identity_id is provided.
        self._unlocked = UnlockedVault(
            http=self._http,
            org_key=org_key,
            secrets_cache=list(decrypted),
        )

        # Step 6 (optional): filter by identity access rules
        if identity_id is not None:
            id_str = str(identity_id)
            filtered: list[DecryptedVaultSecret] = []
            for secret in decrypted:
                access_rules = self._http.get(
                    f"/secrets/{secret.id}/access",
                )
                if any(r["identity_id"] == id_str for r in access_rules):
                    filtered.append(secret)
            return UnlockedVault(
                http=self._http,
                org_key=org_key,
                secrets_cache=filtered,
            )

        return self._unlocked


class UnlockedVault:
    """
    A vault unlocked with a valid vault key.

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

    def _refresh_cached_secret(self, secret_id: UUID | str) -> None:
        """Re-fetch, decrypt, and update a single secret in the cache.

        Best-effort — if the re-fetch fails (e.g. the secret was just
        deleted or the server is unreachable), the cache is left unchanged.
        """
        try:
            updated = self.get_secret(secret_id)
        except Exception:
            return
        sid = str(secret_id)
        self._secrets_cache = [
            updated if str(s.id) == sid else s
            for s in self._secrets_cache
        ]

    ## Encrypted CRUD

    def get_secret(self, secret_id: UUID | str) -> DecryptedVaultSecret:
        """
        Fetch and decrypt a single vault secret.

        Args:
            secret_id: UUID of the secret.

        Returns:
            :class:`~inkbox.vault.types.DecryptedVaultSecret`.
        """
        data = self._http.get(f"/secrets/{secret_id}")
        detail = VaultSecretDetail._from_dict(data)
        try:
            payload_dict = decrypt_payload(self._org_key, detail.encrypted_payload, secret_id=str(detail.id))
        except Exception:
            payload_dict = decrypt_payload(self._org_key, detail.encrypted_payload, secret_id="")
        payload = _parse_payload(
            secret_type=detail.secret_type,
            raw=payload_dict,
        )
        return DecryptedVaultSecret(
            id=detail.id,
            name=detail.name,
            secret_type=detail.secret_type,
            status=detail.status,
            created_at=detail.created_at,
            updated_at=detail.updated_at,
            payload=payload,
            description=detail.description,
        )

    def create_secret(
        self,
        name: str,
        payload: SecretPayload,
        *,
        description: str | None = None,
    ) -> VaultSecret:
        """
        Encrypt and store a new secret.

        The ``secret_type`` is inferred from the payload type.

        Args:
            name: Display name (max 255 characters).
            payload: One of :class:`LoginPayload`, :class:`SSHKeyPayload`,
                :class:`APIKeyPayload`, or :class:`OtherPayload`.
            description: Optional description.

        Returns:
            :class:`~inkbox.vault.types.VaultSecret` metadata (no payload).
        """
        secret_type = _infer_secret_type(payload)
        encrypted = encrypt_payload(self._org_key, payload._to_dict())
        body: dict[str, Any] = {
            "name": name,
            "secret_type": secret_type,
            "encrypted_payload": encrypted,
        }
        if description is not None:
            body["description"] = description
        data = self._http.post(
            path="/secrets",
            json=body,
        )
        result = VaultSecret._from_dict(data)
        # Append the new secret to the cache so it's immediately visible.
        try:
            decrypted = self.get_secret(str(result.id))
            self._secrets_cache.append(decrypted)
        except Exception:
            pass  # best-effort
        return result

    def update_secret(
        self,
        secret_id: UUID | str,
        *,
        name: str | None = _UNSET,  # type: ignore[assignment]
        description: str | None = _UNSET,  # type: ignore[assignment]
        payload: SecretPayload | None = _UNSET,  # type: ignore[assignment]
    ) -> VaultSecret:
        """
        Update a vault secret's name, description, and/or encrypted payload.

        Only provided arguments are sent to the server.

        .. note::

           The ``secret_type`` is immutable after creation.  If a payload
           is provided it must be the **same type** as the original (e.g.
           update a ``login`` secret with a new :class:`LoginPayload`).
           To change the type, delete the secret and create a new one.

        Args:
            secret_id: UUID of the secret to update.
            name: New display name.
            description: New description.
            payload: New payload of the **same type** as the original
                (will be re-encrypted).

        Returns:
            :class:`~inkbox.vault.types.VaultSecret` metadata.
        """
        body: dict[str, Any] = {}
        if name is not _UNSET:
            body["name"] = name
        if description is not _UNSET:
            body["description"] = description
        if payload is not _UNSET and payload is not None:
            # enforce secret_type immutability; the server treats the
            # payload as opaque ciphertext and cannot check this itself
            current = VaultSecret._from_dict(
                self._http.get(f"/secrets/{secret_id}")
            )
            new_type = _infer_secret_type(payload)
            if new_type != current.secret_type:
                raise TypeError(
                    f"Cannot update a {current.secret_type!r} secret with "
                    f"a {new_type!r} payload. Delete and recreate instead."
                )
            body["encrypted_payload"] = encrypt_payload(
                self._org_key,
                payload._to_dict(),
                secret_id=str(secret_id),
            )
        data = self._http.patch(
            path=f"/secrets/{secret_id}",
            json=body,
        )
        # Refresh the cache so subsequent reads are consistent.
        self._refresh_cached_secret(secret_id)
        return VaultSecret._from_dict(data)

    def delete_secret(self, secret_id: UUID | str) -> None:
        """
        Delete a vault secret.

        Args:
            secret_id: UUID of the secret to delete.
        """
        self._http.delete(f"/secrets/{secret_id}")
        sid = str(secret_id)
        self._secrets_cache = [
            s for s in self._secrets_cache if str(s.id) != sid
        ]

    ## TOTP helpers

    def set_totp(
        self,
        secret_id: UUID | str,
        totp: TOTPConfig | str,
    ) -> VaultSecret:
        """Add or replace the TOTP configuration on a login secret.

        Args:
            secret_id: UUID of the login secret.
            totp: A :class:`~inkbox.vault.totp.TOTPConfig` or an
                ``otpauth://totp/...`` URI string.

        Returns:
            Updated :class:`~inkbox.vault.types.VaultSecret` metadata.

        Raises:
            TypeError: If the secret is not a login type.
            ValueError: If a URI string is invalid or not TOTP.
        """
        if isinstance(totp, str):
            totp = parse_totp_uri(totp)
        secret = self.get_secret(secret_id)
        if secret.secret_type != VaultSecretType.LOGIN:
            raise TypeError(
                f"Cannot set TOTP on a {secret.secret_type!r} secret — "
                f"only login secrets support TOTP"
            )
        payload = secret.payload
        payload.totp = totp  # type: ignore[union-attr]
        return self.update_secret(secret_id, payload=payload)

    def remove_totp(self, secret_id: UUID | str) -> VaultSecret:
        """Remove TOTP configuration from a login secret.

        Args:
            secret_id: UUID of the login secret.

        Returns:
            Updated :class:`~inkbox.vault.types.VaultSecret` metadata.

        Raises:
            TypeError: If the secret is not a login type.
        """
        secret = self.get_secret(secret_id)
        if secret.secret_type != VaultSecretType.LOGIN:
            raise TypeError(
                f"Cannot remove TOTP from a {secret.secret_type!r} secret — "
                f"only login secrets support TOTP"
            )
        payload = secret.payload
        payload.totp = None  # type: ignore[union-attr]
        return self.update_secret(secret_id, payload=payload)

    def get_totp_code(self, secret_id: UUID | str) -> TOTPCode:
        """Generate the current TOTP code for a login secret.

        Args:
            secret_id: UUID of the login secret.

        Returns:
            A :class:`~inkbox.vault.totp.TOTPCode`.

        Raises:
            TypeError: If the secret is not a login type.
            ValueError: If the login has no TOTP configured.
        """
        secret = self.get_secret(secret_id)
        if secret.secret_type != VaultSecretType.LOGIN:
            raise TypeError(
                f"Cannot generate TOTP for a {secret.secret_type!r} secret — "
                f"only login secrets support TOTP"
            )
        totp_config = secret.payload.totp  # type: ignore[union-attr]
        if totp_config is None:
            raise ValueError(
                f"Login secret {secret_id!r} has no TOTP configured"
            )
        return generate_totp(totp_config)

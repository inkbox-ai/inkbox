"""
inkbox/credentials.py

Credentials — agent-facing credential access, typed and identity-scoped.

This is the *runtime* surface for agents that need their credentials.
The vault remains the *admin* surface for creating secrets, managing
keys, and configuring access rules.
"""

from __future__ import annotations

from uuid import UUID

from inkbox.vault.types import (
    APIKeyPayload,
    DecryptedVaultSecret,
    LoginPayload,
    SSHKeyPayload,
    SecretPayload,
    VaultSecretType,
)


class Credentials:
    """
    Agent-facing credential access — typed, identity-scoped.

    Wraps a pre-filtered list of :class:`~inkbox.vault.types.DecryptedVaultSecret`
    objects and provides typed accessors so agents can retrieve credentials
    without dealing with vault internals.

    Obtain via :attr:`AgentIdentity.credentials` after unlocking the vault::

        inkbox.vault.unlock("my-Vault-key-01!")
        identity = inkbox.get_identity("support-bot")

        logins = identity.credentials.list_logins()
        api_key = identity.credentials.get_api_key("cccc3333-...")
    """

    def __init__(self, secrets: list[DecryptedVaultSecret]) -> None:
        self._secrets = secrets
        self._by_id: dict[str, DecryptedVaultSecret] = {
            str(s.id): s for s in secrets
        }

    ## Discovery; return full DecryptedVaultSecret for name/metadata

    def list(self) -> list[DecryptedVaultSecret]:
        """List all credentials this identity has access to."""
        return list(self._secrets)

    def list_logins(self) -> list[DecryptedVaultSecret]:
        """List login credentials (username/password)."""
        return [s for s in self._secrets if s.secret_type == VaultSecretType.LOGIN]

    def list_api_keys(self) -> list[DecryptedVaultSecret]:
        """List API key credentials."""
        return [s for s in self._secrets if s.secret_type == VaultSecretType.API_KEY]

    def list_ssh_keys(self) -> list[DecryptedVaultSecret]:
        """List SSH key credentials."""
        return [s for s in self._secrets if s.secret_type == VaultSecretType.SSH_KEY]

    ## Access by UUID; return typed payload directly

    def get(self, secret_id: UUID | str) -> DecryptedVaultSecret:
        """Get any credential by UUID.

        Args:
            secret_id: UUID of the secret.

        Raises:
            KeyError: If no credential with this UUID is accessible.
        """
        key = str(secret_id)
        try:
            return self._by_id[key]
        except KeyError:
            raise KeyError(
                f"No credential with id {key!r} is accessible to this identity"
            ) from None

    def get_login(self, secret_id: UUID | str) -> LoginPayload:
        """Get a login credential's payload by UUID.

        Args:
            secret_id: UUID of the secret.

        Raises:
            KeyError: If no credential with this UUID is accessible.
            TypeError: If the credential is not a login type.
        """
        return self._get_typed(secret_id, VaultSecretType.LOGIN)  # type: ignore[return-value]

    def get_api_key(self, secret_id: UUID | str) -> APIKeyPayload:
        """Get an API key credential's payload by UUID.

        Args:
            secret_id: UUID of the secret.

        Raises:
            KeyError: If no credential with this UUID is accessible.
            TypeError: If the credential is not an api_key type.
        """
        return self._get_typed(secret_id, VaultSecretType.API_KEY)  # type: ignore[return-value]

    def get_ssh_key(self, secret_id: UUID | str) -> SSHKeyPayload:
        """Get an SSH key credential's payload by UUID.

        Args:
            secret_id: UUID of the secret.

        Raises:
            KeyError: If no credential with this UUID is accessible.
            TypeError: If the credential is not an ssh_key type.
        """
        return self._get_typed(secret_id, VaultSecretType.SSH_KEY)  # type: ignore[return-value]

    ## Internal

    def _get_typed(self, secret_id: UUID | str, expected_type: VaultSecretType) -> SecretPayload:
        secret = self.get(secret_id)
        if secret.secret_type != expected_type:
            raise TypeError(
                f"Credential {str(secret_id)!r} is a {secret.secret_type!r} secret, "
                f"not {expected_type.value!r}"
            )
        return secret.payload

    def __len__(self) -> int:
        return len(self._secrets)

    def __repr__(self) -> str:
        return f"Credentials({len(self._secrets)} secrets)"

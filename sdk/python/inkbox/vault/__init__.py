"""
inkbox.vault — encrypted vault types and exceptions.
"""

from inkbox.vault.exceptions import InkboxAPIError, InkboxError
from inkbox.vault.types import (
    APIKeyPayload,
    DecryptedVaultSecret,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
    VaultInfo,
    VaultKey,
    VaultSecret,
    VaultSecretDetail,
    VaultSecretType,
)
from inkbox.vault.crypto import (
    VaultKeyMaterial,
    generate_org_encryption_key,
    generate_recovery_code,
    generate_vault_key_material,
)

__all__ = [
    "InkboxError",
    "InkboxAPIError",
    # API response types
    "VaultInfo",
    "VaultKey",
    "VaultSecret",
    "VaultSecretDetail",
    "DecryptedVaultSecret",
    # Enums
    "VaultSecretType",
    # Structured payloads
    "LoginPayload",
    "SSHKeyPayload",
    "APIKeyPayload",
    "OtherPayload",
    # Key generation helpers
    "VaultKeyMaterial",
    "generate_org_encryption_key",
    "generate_vault_key_material",
    "generate_recovery_code",
]

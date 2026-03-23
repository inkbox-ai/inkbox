"""
inkbox.vault — encrypted vault types and exceptions.
"""

from inkbox.vault.types import (
    AccessRule,
    APIKeyPayload,
    DecryptedVaultSecret,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
    VaultInfo,
    VaultKey,
    VaultKeyType,
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
from inkbox.vault.exceptions import InkboxVaultKeyError

__all__ = [
    # API response types
    "AccessRule",
    "VaultInfo",
    "VaultKey",
    "VaultSecret",
    "VaultSecretDetail",
    "DecryptedVaultSecret",
    # Enums
    "VaultSecretType",
    "VaultKeyType",
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
    # Exceptions
    "InkboxVaultKeyError",
]

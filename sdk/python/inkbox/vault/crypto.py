"""
inkbox/vault/crypto.py

Client-side cryptography for the encrypted vault.

Key derivation: Argon2id (vault_key → master key)
Encryption:     AES-256-GCM
Hashing:        SHA-256

Salt derivation:
    The Argon2id salt is the raw UTF-8 encoding of the organisation ID,
    so that both the dashboard (vault init) and the SDK (vault unlock) can
    compute the same master key from the same vault key without a round-trip::

        salt = org_id.encode()
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import secrets
from dataclasses import dataclass
from typing import Any
from uuid import UUID, uuid4

from argon2.low_level import Type as Argon2Type
from argon2.low_level import hash_secret_raw
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from inkbox.exceptions import InkboxVaultKeyError
from inkbox.vault.types import VaultKeyType


## Constants

ARGON2_TIME_COST = 3
ARGON2_MEMORY_COST = 65_536  # 64 MiB
ARGON2_PARALLELISM = 1
ARGON2_HASH_LEN = 32  # 256-bit master key

AES_KEY_BYTES = 32
AES_IV_BYTES = 12

# Recovery code alphabet (unambiguous uppercase + digits, no 0/O/1/I/L)
_RC_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ"
_RC_GROUP_LEN = 4
_RC_GROUPS = 8  # 8 groups × 4 chars ≈ 120 bits of entropy


## Vault key validation

def _validate_vault_key(vault_key: str) -> None:
    """
    Enforce minimum vault key requirements.

    Args:
        vault_key: The vault key string to validate.

    Raises:
        InkboxVaultKeyError: If the vault key does not meet requirements.
    """
    if len(vault_key) < 16:
        raise InkboxVaultKeyError("Vault key must be at least 16 characters")
    if not re.search(
        pattern=r"[A-Z]",
        string=vault_key,
    ):
        raise InkboxVaultKeyError("Vault key must contain at least one uppercase letter")
    if not re.search(
        pattern=r"[a-z]",
        string=vault_key,
    ):
        raise InkboxVaultKeyError("Vault key must contain at least one lowercase letter")
    if not re.search(
        pattern=r"[0-9]",
        string=vault_key,
    ):
        raise InkboxVaultKeyError("Vault key must contain at least one digit")
    if not re.search(
        pattern=r"[^A-Za-z0-9]",
        string=vault_key,
    ):
        raise InkboxVaultKeyError("Vault key must contain at least one special character")


## Salt derivation

def derive_salt(organization_id: str) -> bytes:
    """
    Derive the Argon2id salt from the organisation ID.

    The salt is the raw UTF-8 encoding of the organisation ID.  This is
    deterministic so both vault init and vault unlock can reach the same
    master key from the same vault key.
    """
    return organization_id.encode()


## Key derivation

def derive_master_key(vault_key: str, salt: bytes) -> bytes:
    """
    Derive a 256-bit master key from a vault key using Argon2id.

    Args:
        vault_key: User-provided vault key or recovery code.
        salt: 16-byte salt from :func:`derive_salt`.

    Returns:
        32-byte master key.
    """
    return hash_secret_raw(
        secret=vault_key.encode(),
        salt=salt,
        time_cost=ARGON2_TIME_COST,
        memory_cost=ARGON2_MEMORY_COST,
        parallelism=ARGON2_PARALLELISM,
        hash_len=ARGON2_HASH_LEN,
        type=Argon2Type.ID,
    )


def compute_auth_hash(master_key: bytes) -> str:
    """Compute ``SHA-256(masterKey)`` as a hex digest."""
    return hashlib.sha256(master_key).hexdigest()


## AES-256-GCM wrapping / unwrapping

def _aes_gcm_encrypt(key: bytes, plaintext: bytes, aad: str = "") -> bytes:
    """Encrypt with AES-256-GCM.  Returns ``ciphertext || nonce || tag``.

    Args:
        key: 32-byte AES key.
        plaintext: Data to encrypt.
        aad: Additional authenticated data (e.g. vault key ID or secret ID).
    """
    iv = os.urandom(AES_IV_BYTES)
    associated_data = aad.encode() if aad else None
    ct_and_tag = AESGCM(key).encrypt(
        nonce=iv,
        data=plaintext,
        associated_data=associated_data,
    )
    ct = ct_and_tag[:-16]
    tag = ct_and_tag[-16:]
    return ct + iv + tag


def _aes_gcm_decrypt(key: bytes, blob: bytes, aad: str = "") -> bytes:
    """Decrypt AES-256-GCM blob formatted as ``ciphertext || nonce || tag``.

    Args:
        key: 32-byte AES key.
        blob: Ciphertext blob.
        aad: Additional authenticated data (must match what was used during encryption).
    """
    ct = blob[:-28]
    nonce = blob[-28:-16]
    tag = blob[-16:]
    associated_data = aad.encode() if aad else None
    return AESGCM(key).decrypt(
        nonce=nonce,
        data=ct + tag,
        associated_data=associated_data,
    )


def wrap_org_key(master_key: bytes, org_key: bytes, vault_key_id: str = "") -> str:
    """
    Wrap the org encryption key with a master key.

    Args:
        master_key: 32-byte master key.
        org_key: 32-byte org encryption key.
        vault_key_id: Vault key UUID used as AAD.

    Returns:
        Base64-encoded blob ``(ciphertext || nonce || tag)``.
    """
    return base64.b64encode(
        s=_aes_gcm_encrypt(
            key=master_key,
            plaintext=org_key,
            aad=vault_key_id,
        )
    ).decode()


def unwrap_org_key(master_key: bytes, wrapped_b64: str, vault_key_id: str = "") -> bytes:
    """
    Unwrap the org encryption key using a master key.

    Args:
        master_key: 32-byte master key derived from the vault key.
        wrapped_b64: Base64-encoded wrapped blob from the server.
        vault_key_id: Vault key UUID used as AAD during wrapping.

    Returns:
        32-byte org encryption key.
    """
    blob = base64.b64decode(wrapped_b64)
    return _aes_gcm_decrypt(
        key=master_key,
        blob=blob,
        aad=vault_key_id,
    )


## Secret payload encryption / decryption

def encrypt_payload(org_key: bytes, payload: dict[str, Any], secret_id: str = "") -> str:
    """
    Serialize a payload dict to JSON and encrypt with the org key.

    Args:
        org_key: 32-byte org encryption key.
        payload: Payload dict to serialize and encrypt.
        secret_id: Vault secret UUID used as AAD.

    Returns:
        Base64-encoded ciphertext blob.
    """
    plaintext = json.dumps(
        obj=payload,
        separators=(",", ":"),
    ).encode()
    return base64.b64encode(
        s=_aes_gcm_encrypt(
            key=org_key,
            plaintext=plaintext,
            aad=secret_id,
        )
    ).decode()


def decrypt_payload(org_key: bytes, encrypted_b64: str, secret_id: str = "") -> dict[str, Any]:
    """
    Decrypt a base64 ciphertext blob and parse the JSON payload.

    Args:
        org_key: 32-byte org encryption key.
        encrypted_b64: Base64-encoded ciphertext.
        secret_id: Vault secret UUID used as AAD during encryption.

    Returns:
        The decrypted payload as a dict.
    """
    blob = base64.b64decode(encrypted_b64)
    plaintext = _aes_gcm_decrypt(
        key=org_key,
        blob=blob,
        aad=secret_id,
    )
    return json.loads(plaintext)


## Vault key material generation (used by dashboard / init code)

def generate_org_encryption_key() -> bytes:
    """Generate a random 256-bit org encryption key."""
    return os.urandom(AES_KEY_BYTES)


@dataclass
class VaultKeyMaterial:
    """
    Cryptographic material for registering a vault key with the server.

    Call :meth:`to_wire` to get a JSON-serializable dict suitable for
    ``POST /vault/initialize`` or ``POST /vault/keys``.

    Attributes:
        id: Client-generated UUID (database primary key).
        wrapped_org_encryption_key: Base64-encoded AES-256-GCM ciphertext.
        auth_hash: SHA-256(masterKey) hex digest.
        key_type: ``"primary"`` or ``"recovery"``.
    """
    id: UUID
    wrapped_org_encryption_key: str
    auth_hash: str
    key_type: VaultKeyType

    def to_wire(self) -> dict[str, str]:
        """Return a JSON-serializable dict matching the API's expected schema."""
        return {
            "id": str(self.id),
            "wrapped_org_encryption_key": self.wrapped_org_encryption_key,
            "auth_hash": self.auth_hash,
            "key_type": self.key_type.value,
        }


def generate_vault_key_material(
    vault_key: str,
    organization_id: str,
    org_encryption_key: bytes,
    *,
    key_type: VaultKeyType = VaultKeyType.PRIMARY,
) -> VaultKeyMaterial:
    """
    Generate vault key material from a vault key.

    Derives a master key via Argon2id and wraps the org encryption key.

    Args:
        vault_key: User-chosen vault key or recovery code string.
        organization_id: Organisation ID (used as salt basis).
        org_encryption_key: 32-byte org encryption key to wrap.
        key_type: ``VaultKeyType.PRIMARY`` or ``VaultKeyType.RECOVERY``.

    Returns:
        :class:`VaultKeyMaterial` ready to send to the server.
    """
    _validate_vault_key(vault_key)
    salt = derive_salt(organization_id)
    master_key = derive_master_key(vault_key, salt)
    auth_hash = compute_auth_hash(master_key)
    key_id = uuid4()
    wrapped = wrap_org_key(master_key, org_encryption_key, vault_key_id=str(key_id))

    return VaultKeyMaterial(
        id=key_id,
        wrapped_org_encryption_key=wrapped,
        auth_hash=auth_hash,
        key_type=key_type,
    )


def generate_recovery_code(
    organization_id: str,
    org_encryption_key: bytes,
) -> tuple[str, VaultKeyMaterial]:
    """
    Generate a random recovery code and its vault key material.

    The recovery code is a human-readable string of the form
    ``XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`` (~120 bits of entropy).

    Args:
        organization_id: Organisation ID (used as salt basis).
        org_encryption_key: 32-byte org encryption key to wrap.

    Returns:
        A ``(code_string, VaultKeyMaterial)`` tuple.  The code string must
        be stored securely by the user — it cannot be recovered.
    """
    groups: list[str] = [
        "".join(
            secrets.choice(_RC_ALPHABET)
            for _ in range(_RC_GROUP_LEN)
        )
        for _ in range(_RC_GROUPS)
    ]
    code = "-".join(groups)

    # Recovery codes bypass _validate_vault_key; they are auto-generated
    # and don't follow vault key rules.  Derive directly.
    salt = derive_salt(organization_id)
    master_key = derive_master_key(
        vault_key=code,
        salt=salt,
    )
    auth_hash = compute_auth_hash(master_key)
    key_id = uuid4()
    wrapped = wrap_org_key(master_key, org_encryption_key, vault_key_id=str(key_id))

    material = VaultKeyMaterial(
        id=key_id,
        wrapped_org_encryption_key=wrapped,
        auth_hash=auth_hash,
        key_type=VaultKeyType.RECOVERY,
    )
    return code, material

"""Tests for vault crypto module."""

import pytest
from inkbox.vault.crypto import (
    _validate_vault_key,
    compute_auth_hash,
    decrypt_payload,
    derive_master_key,
    derive_salt,
    encrypt_payload,
    generate_org_encryption_key,
    generate_recovery_code,
    generate_vault_key_material,
    unwrap_org_key,
    wrap_org_key,
)
from inkbox.vault.types import VaultKeyType

VALID_VAULT_KEY = "Test-Passw0rd!xy"


class TestValidateVaultKey:
    def test_valid_key_passes(self):
        _validate_vault_key(VALID_VAULT_KEY)

    def test_too_short(self):
        with pytest.raises(ValueError, match="at least 16 characters"):
            _validate_vault_key("Short-Pass0rd!")

    def test_no_uppercase(self):
        with pytest.raises(ValueError, match="uppercase letter"):
            _validate_vault_key("test-passw0rd!xy")

    def test_no_lowercase(self):
        with pytest.raises(ValueError, match="lowercase letter"):
            _validate_vault_key("TEST-PASSW0RD!XY")

    def test_no_digit(self):
        with pytest.raises(ValueError, match="digit"):
            _validate_vault_key("Test-Password!xy")

    def test_no_special(self):
        with pytest.raises(ValueError, match="special character"):
            _validate_vault_key("TestPassw0rdxyxy")


class TestDeriveSalt:
    def test_deterministic(self):
        assert derive_salt("org_test_123") == derive_salt("org_test_123")

    def test_different_orgs_different_salts(self):
        assert derive_salt("org_a") != derive_salt("org_b")

    def test_length_matches_org_id(self):
        assert derive_salt("org_test_123") == b"org_test_123"


class TestDeriveAndHash:
    def test_same_password_same_salt_same_key(self):
        salt = derive_salt("org_test_123")
        k1 = derive_master_key("password", salt)
        k2 = derive_master_key("password", salt)
        assert k1 == k2

    def test_different_passwords_different_keys(self):
        salt = derive_salt("org_test_123")
        k1 = derive_master_key("password_a", salt)
        k2 = derive_master_key("password_b", salt)
        assert k1 != k2

    def test_master_key_length(self):
        salt = derive_salt("org_test_123")
        assert len(derive_master_key("pw", salt)) == 32

    def test_auth_hash_is_hex_64(self):
        salt = derive_salt("org_test_123")
        mk = derive_master_key("pw", salt)
        h = compute_auth_hash(mk)
        assert len(h) == 64
        int(h, 16)  # must be valid hex


class TestWrapUnwrapOrgKey:
    def test_roundtrip(self):
        mk = derive_master_key("pw", derive_salt("org_test_wrap"))
        org_key = generate_org_encryption_key()
        wrapped = wrap_org_key(mk, org_key)
        assert isinstance(wrapped, str)
        recovered = unwrap_org_key(mk, wrapped)
        assert recovered == org_key

    def test_wrong_key_fails(self):
        salt = derive_salt("org_test_wrap")
        mk1 = derive_master_key("right", salt)
        mk2 = derive_master_key("wrong", salt)
        org_key = generate_org_encryption_key()
        wrapped = wrap_org_key(mk1, org_key)
        try:
            unwrap_org_key(mk2, wrapped)
            assert False, "Should have raised"
        except Exception:
            pass


class TestEncryptDecryptPayload:
    def test_roundtrip(self):
        org_key = generate_org_encryption_key()
        payload = {"username": "admin", "password": "s3cret", "url": "https://x.com"}
        enc = encrypt_payload(org_key, payload)
        assert isinstance(enc, str)
        dec = decrypt_payload(org_key, enc)
        assert dec == payload

    def test_different_keys_fail(self):
        k1 = generate_org_encryption_key()
        k2 = generate_org_encryption_key()
        enc = encrypt_payload(k1, {"a": 1})
        try:
            decrypt_payload(k2, enc)
            assert False, "Should have raised"
        except Exception:
            pass


class TestGenerateVaultKeyMaterial:
    def test_roundtrip(self):
        org_key = generate_org_encryption_key()
        mat = generate_vault_key_material(VALID_VAULT_KEY, "org_test_123", org_key)
        assert mat.key_type == VaultKeyType.PRIMARY
        # Re-derive and verify
        salt = derive_salt("org_test_123")
        mk = derive_master_key(VALID_VAULT_KEY, salt)
        assert compute_auth_hash(mk) == mat.auth_hash
        assert unwrap_org_key(mk, mat.wrapped_org_encryption_key) == org_key

    def test_type_override(self):
        org_key = generate_org_encryption_key()
        mat = generate_vault_key_material(
            VALID_VAULT_KEY, "org_test_123", org_key, key_type=VaultKeyType.RECOVERY
        )
        assert mat.key_type == VaultKeyType.RECOVERY

    def test_rejects_weak_key(self):
        org_key = generate_org_encryption_key()
        with pytest.raises(ValueError, match="at least 16 characters"):
            generate_vault_key_material("short", "org_test_123", org_key)


class TestGenerateRecoveryCode:
    def test_format(self):
        org_key = generate_org_encryption_key()
        code, mat = generate_recovery_code("org_test_123", org_key)
        parts = code.split("-")
        assert len(parts) == 8
        assert all(len(p) == 4 for p in parts)
        assert mat.key_type == VaultKeyType.RECOVERY

    def test_roundtrip(self):
        org_key = generate_org_encryption_key()
        code, mat = generate_recovery_code("org_test_123", org_key)
        salt = derive_salt("org_test_123")
        mk = derive_master_key(code, salt)
        assert compute_auth_hash(mk) == mat.auth_hash
        assert unwrap_org_key(mk, mat.wrapped_org_encryption_key) == org_key

    def test_codes_are_unique(self):
        org_key = generate_org_encryption_key()
        c1, _ = generate_recovery_code("org_test_123", org_key)
        c2, _ = generate_recovery_code("org_test_123", org_key)
        assert c1 != c2

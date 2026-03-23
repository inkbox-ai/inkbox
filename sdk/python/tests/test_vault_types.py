"""
sdk/python/tests/test_vault_types.py

Tests for vault type parsing.
"""

from uuid import UUID

from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT, VAULT_SECRET_DETAIL_DICT
from inkbox.vault.types import (
    APIKeyPayload,
    KeyPairPayload,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
    VaultInfo,
    VaultKey,
    VaultKeyType,
    VaultSecret,
    VaultSecretDetail,
    VaultSecretType,
    _infer_secret_type,
    _parse_payload,
)


class TestVaultInfo:
    def test_from_dict(self):
        info = VaultInfo._from_dict(VAULT_INFO_DICT)
        assert isinstance(info.id, UUID)
        assert info.organization_id == "org_test_123"
        assert info.key_count == 1
        assert info.secret_count == 2
        assert info.recovery_key_count == 4


class TestVaultKey:
    def test_from_dict(self):
        key = VaultKey._from_dict(VAULT_KEY_DICT)
        assert isinstance(key.id, UUID)
        assert key.key_type == "primary"


class TestVaultSecret:
    def test_from_dict(self):
        s = VaultSecret._from_dict(VAULT_SECRET_DICT)
        assert isinstance(s.id, UUID)
        assert s.name == "AWS Production"
        assert s.description == "Production AWS credentials"
        assert s.secret_type == "login"


class TestVaultSecretDetail:
    def test_from_dict(self):
        d = {**VAULT_SECRET_DETAIL_DICT, "encrypted_payload": "abc123"}
        s = VaultSecretDetail._from_dict(d)
        assert s.encrypted_payload == "abc123"
        assert s.name == "AWS Production"
        assert s.description == "Production AWS credentials"


class TestPayloadParsers:
    def test_login(self):
        raw = {"username": "admin", "password": "pw", "url": "https://x.com"}
        p = _parse_payload("login", raw)
        assert isinstance(p, LoginPayload)
        assert p.username == "admin"
        assert p.url == "https://x.com"

    def test_other(self):
        p = _parse_payload("other", {"data": "freeform content"})
        assert isinstance(p, OtherPayload)
        assert p.data == "freeform content"

    def test_ssh_key(self):
        p = _parse_payload("ssh_key", {"private_key": "-----BEGIN..."})
        assert isinstance(p, SSHKeyPayload)
        assert p.public_key is None

    def test_api_key(self):
        p = _parse_payload("api_key", {"api_key": "ak_123"})
        assert isinstance(p, APIKeyPayload)
        assert p.api_key == "ak_123"

    def test_key_pair(self):
        p = _parse_payload("key_pair", {"access_key": "ak_123", "secret_key": "sk_456"})
        assert isinstance(p, KeyPairPayload)
        assert p.access_key == "ak_123"
        assert p.secret_key == "sk_456"


class TestInferSecretType:
    def test_login(self):
        assert _infer_secret_type(LoginPayload(password="b", username="a")) == "login"

    def test_other(self):
        assert _infer_secret_type(OtherPayload(data="x")) == "other"

    def test_ssh_key(self):
        assert _infer_secret_type(SSHKeyPayload(private_key="...")) == "ssh_key"

    def test_api_key(self):
        assert _infer_secret_type(APIKeyPayload(api_key="k")) == "api_key"

    def test_key_pair(self):
        assert _infer_secret_type(KeyPairPayload(access_key="a", secret_key="s")) == "key_pair"


# Test VaultSecretType and VaultKeyType enums
class TestEnums:
    def test_secret_type_values(self):
        assert VaultSecretType.LOGIN == "login"
        assert VaultSecretType.SSH_KEY == "ssh_key"
        assert VaultSecretType.API_KEY == "api_key"
        assert VaultSecretType.OTHER == "other"

    def test_key_type_values(self):
        assert VaultKeyType.PRIMARY == "primary"
        assert VaultKeyType.RECOVERY == "recovery"

# Test notes field on payloads
class TestPayloadNotes:
    def test_login_with_notes(self):
        p = LoginPayload(password="b", username="a", notes="test note")
        d = p._to_dict()
        assert d["notes"] == "test note"
        roundtripped = LoginPayload._from_dict(d)
        assert roundtripped.notes == "test note"

    def test_other_with_notes(self):
        p = OtherPayload(data="stuff", notes="context")
        d = p._to_dict()
        assert d["notes"] == "context"
        roundtripped = OtherPayload._from_dict(d)
        assert roundtripped.notes == "context"

    def test_notes_default_none(self):
        p = LoginPayload(password="b", username="a")
        assert p.notes is None
        d = p._to_dict()
        assert "notes" not in d

# Test unknown secret type error
class TestUnknownSecretType:
    def test_parse_payload_unknown_raises(self):
        import pytest
        with pytest.raises(ValueError, match="is not a valid VaultSecretType"):
            _parse_payload("nonexistent", {"foo": "bar"})

    def test_parse_payload_valid_enum_but_no_registry_entry(self):
        """Cover types.py line 338: valid VaultSecretType but missing from registry."""
        import pytest
        from unittest.mock import patch
        from inkbox.vault.types import _PAYLOAD_REGISTRY, VaultSecretType

        # Remove "login" from the registry temporarily
        patched = {k: v for k, v in _PAYLOAD_REGISTRY.items() if k != VaultSecretType.LOGIN}
        with patch("inkbox.vault.types._PAYLOAD_REGISTRY", patched):
            with pytest.raises(ValueError, match="Unknown secret_type: 'login'"):
                _parse_payload("login", {"username": "a", "password": "b"})


class TestSSHKeyPayloadRoundtrip:
    """Cover SSHKeyPayload._to_dict and _from_dict with all optional fields."""

    def test_all_optional_fields(self):
        p = SSHKeyPayload(
            private_key="-----BEGIN OPENSSH PRIVATE KEY-----",
            public_key="ssh-ed25519 AAAA...",
            fingerprint="SHA256:abc123",
            passphrase="my-passphrase",
            notes="production bastion key",
        )
        d = p._to_dict()
        assert d == {
            "private_key": "-----BEGIN OPENSSH PRIVATE KEY-----",
            "public_key": "ssh-ed25519 AAAA...",
            "fingerprint": "SHA256:abc123",
            "passphrase": "my-passphrase",
            "notes": "production bastion key",
        }
        roundtripped = SSHKeyPayload._from_dict(d)
        assert roundtripped.private_key == p.private_key
        assert roundtripped.public_key == p.public_key
        assert roundtripped.fingerprint == p.fingerprint
        assert roundtripped.passphrase == p.passphrase
        assert roundtripped.notes == p.notes

    def test_no_optional_fields(self):
        p = SSHKeyPayload(private_key="-----BEGIN...")
        d = p._to_dict()
        assert d == {"private_key": "-----BEGIN..."}
        assert "public_key" not in d
        assert "fingerprint" not in d
        assert "passphrase" not in d
        assert "notes" not in d


class TestAPIKeyPayloadRoundtrip:
    """Cover APIKeyPayload._to_dict and _from_dict with all optional fields."""

    def test_all_optional_fields(self):
        p = APIKeyPayload(
            api_key="sk-prod-123",
            endpoint="https://api.example.com/v1",
            notes="rate-limited to 1000 req/min",
        )
        d = p._to_dict()
        assert d == {
            "api_key": "sk-prod-123",
            "endpoint": "https://api.example.com/v1",
            "notes": "rate-limited to 1000 req/min",
        }
        roundtripped = APIKeyPayload._from_dict(d)
        assert roundtripped.api_key == p.api_key
        assert roundtripped.endpoint == p.endpoint
        assert roundtripped.notes == p.notes

    def test_no_optional_fields(self):
        p = APIKeyPayload(api_key="sk-123")
        d = p._to_dict()
        assert d == {"api_key": "sk-123"}
        assert "endpoint" not in d
        assert "notes" not in d


class TestKeyPairPayloadRoundtrip:
    """Cover KeyPairPayload._to_dict and _from_dict."""

    def test_all_optional_fields(self):
        p = KeyPairPayload(
            access_key="AKIAIOSFODNN7EXAMPLE",
            secret_key="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            endpoint="https://s3.amazonaws.com",
            notes="AWS prod",
        )
        d = p._to_dict()
        assert d == {
            "access_key": "AKIAIOSFODNN7EXAMPLE",
            "secret_key": "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
            "endpoint": "https://s3.amazonaws.com",
            "notes": "AWS prod",
        }
        roundtripped = KeyPairPayload._from_dict(d)
        assert roundtripped.access_key == p.access_key
        assert roundtripped.secret_key == p.secret_key

    def test_no_optional_fields(self):
        p = KeyPairPayload(access_key="ak", secret_key="sk")
        d = p._to_dict()
        assert d == {"access_key": "ak", "secret_key": "sk"}
        assert "endpoint" not in d
        assert "notes" not in d


class TestLoginPayloadToDict:
    """Cover LoginPayload._to_dict url and notes branches."""

    def test_with_url_and_notes(self):
        p = LoginPayload(
            password="hunter2",
            username="admin",
            email="admin@example.com",
            url="https://app.example.com",
            notes="shared team login",
        )
        d = p._to_dict()
        assert d["url"] == "https://app.example.com"
        assert d["notes"] == "shared team login"
        assert d["username"] == "admin"
        assert d["email"] == "admin@example.com"
        assert d["password"] == "hunter2"

    def test_no_optional_fields(self):
        p = LoginPayload(password="pass")
        d = p._to_dict()
        assert d == {"password": "pass"}
        assert "username" not in d
        assert "email" not in d
        assert "url" not in d
        assert "notes" not in d


class TestOtherPayloadToDict:
    """Cover OtherPayload._to_dict notes branch."""

    def test_with_notes(self):
        p = OtherPayload(data="some secret blob", notes="expires 2026-12-31")
        d = p._to_dict()
        assert d == {"data": "some secret blob", "notes": "expires 2026-12-31"}

    def test_no_notes(self):
        p = OtherPayload(data="blob")
        d = p._to_dict()
        assert d == {"data": "blob"}
        assert "notes" not in d

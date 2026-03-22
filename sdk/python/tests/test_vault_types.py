"""
sdk/python/tests/test_vault_types.py

Tests for vault type parsing.
"""

from uuid import UUID

from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT, VAULT_SECRET_DETAIL_DICT
from inkbox.vault.types import (
    APIKeyPayload,
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
        p = _parse_payload("api_key", {"key": "ak_123", "secret": "sk_456"})
        assert isinstance(p, APIKeyPayload)
        assert p.secret == "sk_456"


class TestInferSecretType:
    def test_login(self):
        assert _infer_secret_type(LoginPayload(username="a", password="b")) == "login"

    def test_other(self):
        assert _infer_secret_type(OtherPayload(data="x")) == "other"

    def test_ssh_key(self):
        assert _infer_secret_type(SSHKeyPayload(private_key="...")) == "ssh_key"

    def test_api_key(self):
        assert _infer_secret_type(APIKeyPayload(key="k")) == "api_key"


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
        p = LoginPayload(username="a", password="b", notes="test note")
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
        p = LoginPayload(username="a", password="b")
        assert p.notes is None
        d = p._to_dict()
        assert "notes" not in d

# Test unknown secret type error
class TestUnknownSecretType:
    def test_parse_payload_unknown_raises(self):
        import pytest
        with pytest.raises(ValueError, match="is not a valid VaultSecretType"):
            _parse_payload("nonexistent", {"foo": "bar"})

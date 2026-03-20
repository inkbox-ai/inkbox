"""Tests for vault type parsing."""

from uuid import UUID

from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT, VAULT_SECRET_DETAIL_DICT
from inkbox.vault.types import (
    APIKeyPayload,
    CardPayload,
    LoginPayload,
    NotePayload,
    SSHKeyPayload,
    VaultInfo,
    VaultKey,
    VaultSecret,
    VaultSecretDetail,
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
        assert key.label == "Admin Key"


class TestVaultSecret:
    def test_from_dict(self):
        s = VaultSecret._from_dict(VAULT_SECRET_DICT)
        assert isinstance(s.id, UUID)
        assert s.label == "AWS Production"
        assert s.secret_type == "login"


class TestVaultSecretDetail:
    def test_from_dict(self):
        d = {**VAULT_SECRET_DETAIL_DICT, "encrypted_payload": "abc123"}
        s = VaultSecretDetail._from_dict(d)
        assert s.encrypted_payload == "abc123"
        assert s.label == "AWS Production"


class TestPayloadParsers:
    def test_login(self):
        raw = {"username": "admin", "password": "pw", "url": "https://x.com"}
        p = _parse_payload("login", raw)
        assert isinstance(p, LoginPayload)
        assert p.username == "admin"
        assert p.url == "https://x.com"

    def test_card(self):
        raw = {
            "cardholder_name": "Alice",
            "card_number": "4111111111111111",
            "expiry_month": "03",
            "expiry_year": "27",
            "cvv": "123",
        }
        p = _parse_payload("card", raw)
        assert isinstance(p, CardPayload)
        assert p.cardholder_name == "Alice"

    def test_note(self):
        p = _parse_payload("note", {"content": "hello"})
        assert isinstance(p, NotePayload)
        assert p.content == "hello"

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

    def test_card(self):
        assert _infer_secret_type(
            CardPayload(
                cardholder_name="A", card_number="4111", expiry_month="01",
                expiry_year="27", cvv="123"
            )
        ) == "card"

    def test_note(self):
        assert _infer_secret_type(NotePayload(content="x")) == "note"

    def test_ssh_key(self):
        assert _infer_secret_type(SSHKeyPayload(private_key="...")) == "ssh_key"

    def test_api_key(self):
        assert _infer_secret_type(APIKeyPayload(key="k")) == "api_key"

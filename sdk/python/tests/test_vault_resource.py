"""Tests for VaultResource and UnlockedVault."""

from unittest.mock import MagicMock

from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT
from inkbox.vault.crypto import (
    derive_master_key,
    derive_salt,
    encrypt_payload,
    generate_org_encryption_key,
    wrap_org_key,
)
from inkbox.vault.resources.vault import VaultResource, UnlockedVault
from inkbox.vault.types import LoginPayload, VaultInfo, VaultKey, VaultSecret


def _resource():
    http = MagicMock()
    return VaultResource(http), http


class TestVaultResourceInfo:
    def test_returns_vault_info(self):
        res, http = _resource()
        http.get.return_value = VAULT_INFO_DICT
        info = res.info()
        http.get.assert_called_once_with("/info")
        assert isinstance(info, VaultInfo)
        assert info.key_count == 1


class TestVaultResourceListKeys:
    def test_returns_list(self):
        res, http = _resource()
        http.get.return_value = [VAULT_KEY_DICT]
        keys = res.list_keys()
        http.get.assert_called_once_with("/keys", params={})
        assert len(keys) == 1
        assert isinstance(keys[0], VaultKey)

    def test_filters_by_type(self):
        res, http = _resource()
        http.get.return_value = []
        res.list_keys(key_type="recovery")
        http.get.assert_called_once_with("/keys", params={"type": "recovery"})


class TestVaultResourceListSecrets:
    def test_returns_list(self):
        res, http = _resource()
        http.get.return_value = [VAULT_SECRET_DICT]
        secrets = res.list_secrets()
        http.get.assert_called_once_with("/secrets", params={})
        assert len(secrets) == 1
        assert isinstance(secrets[0], VaultSecret)

    def test_filters_by_type(self):
        res, http = _resource()
        http.get.return_value = []
        res.list_secrets(secret_type="login")
        http.get.assert_called_once_with("/secrets", params={"secret_type": "login"})


class TestVaultResourceDeleteSecret:
    def test_calls_delete(self):
        res, http = _resource()
        res.delete_secret("some-uuid")
        http.delete.assert_called_once_with("/secrets/some-uuid")


class TestVaultResourceUnlock:
    def test_unlock_decrypts_secrets(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        password = "test-password"

        salt = derive_salt(org_id)
        mk = derive_master_key(password, salt)
        wrapped = wrap_org_key(mk, org_key)

        login_payload = {"username": "admin", "password": "s3cret"}
        encrypted = encrypt_payload(org_key, login_payload)

        res, http = _resource()
        # info() call
        http.get.side_effect = [
            VAULT_INFO_DICT,  # info()
            {  # unlock()
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [
                    {
                        **VAULT_SECRET_DICT,
                        "encrypted_payload": encrypted,
                    }
                ],
            },
        ]

        unlocked = res.unlock(password)
        assert isinstance(unlocked, UnlockedVault)
        assert len(unlocked.secrets) == 1
        s = unlocked.secrets[0]
        assert s.label == "AWS Production"
        assert s.payload.username == "admin"
        assert s.payload.password == "s3cret"


class TestUnlockedVaultCreateSecret:
    def test_encrypts_and_posts(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.post.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        result = unlocked.create_secret(
            "AWS Prod",
            LoginPayload(username="admin", password="pw"),
        )

        assert isinstance(result, VaultSecret)
        http.post.assert_called_once()
        body = http.post.call_args.kwargs["json"]
        assert body["label"] == "AWS Prod"
        assert body["secret_type"] == "login"
        assert "encrypted_payload" in body


class TestUnlockedVaultUpdateSecret:
    def test_sends_label_only(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret("some-id", label="New Name")

        body = http.patch.call_args[1]["json"]
        assert body == {"label": "New Name"}

    def test_sends_encrypted_payload(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret(
            "some-id",
            payload=LoginPayload(username="new", password="pw2"),
        )

        body = http.patch.call_args[1]["json"]
        assert "encrypted_payload" in body
        assert "label" not in body

"""
sdk/python/tests/test_vault_resource.py

Tests for VaultResource and UnlockedVault.
"""

from unittest.mock import MagicMock

import pytest
from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT
from inkbox.vault.crypto import (
    derive_master_key,
    derive_salt,
    encrypt_payload,
    generate_org_encryption_key,
    wrap_org_key,
)
from inkbox.vault.resources.vault import VaultResource, UnlockedVault
from inkbox.vault.types import LoginPayload, OtherPayload, VaultInfo, VaultKey, VaultSecret

VALID_VAULT_KEY = "Test-Passw0rd!xy"


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
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
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

        unlocked = res.unlock(vault_key)
        assert isinstance(unlocked, UnlockedVault)
        assert len(unlocked.secrets) == 1
        s = unlocked.secrets[0]
        assert s.name == "AWS Production"
        assert s.payload.username == "admin"
        assert s.payload.password == "s3cret"

    def test_unlock_stores_unlocked_state(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key)

        res, http = _resource()
        assert res._unlocked is None
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [],
            },
        ]
        unlocked = res.unlock(vault_key)
        assert res._unlocked is unlocked

    def test_unlock_with_identity_id_does_not_store_state(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key)

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [],
            },
        ]
        res.unlock(vault_key, identity_id="some-identity")
        assert res._unlocked is None

    def test_unlock_does_not_validate_key_strength(self):
        """unlock() should not reject recovery codes or short keys client-side;
        the server rejects bad auth hashes."""
        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,  # info()
            {},  # unlock() — no wrapped key ⇒ server rejected
        ]
        with pytest.raises(ValueError, match="No vault key matched"):
            res.unlock("short")


class TestUnlockedVaultCreateSecret:
    def test_encrypts_and_posts(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.post.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        result = unlocked.create_secret(
            "AWS Prod",
            LoginPayload(username="admin", password="pw"),
            description="Prod creds",
        )

        assert isinstance(result, VaultSecret)
        http.post.assert_called_once()
        body = http.post.call_args.kwargs["json"]
        assert body["name"] == "AWS Prod"
        assert body["description"] == "Prod creds"
        assert body["secret_type"] == "login"
        assert "encrypted_payload" in body


class TestUnlockedVaultUpdateSecret:
    def test_sends_name_only(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret("some-id", name="New Name")

        body = http.patch.call_args[1]["json"]
        assert body == {"name": "New Name"}

    def test_sends_encrypted_payload(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.get.return_value = VAULT_SECRET_DICT  # type check fetch
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret(
            "some-id",
            payload=LoginPayload(username="new", password="pw2"),
        )

        body = http.patch.call_args[1]["json"]
        assert "encrypted_payload" in body
        assert "name" not in body

    def test_rejects_mismatched_payload_type(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.get.return_value = VAULT_SECRET_DICT  # secret_type == "login"
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        with pytest.raises(TypeError, match="Cannot update a 'login' secret"):
            unlocked.update_secret(
                "some-id",
                payload=OtherPayload(data="wrong type"),
            )


class TestUnlockedVaultGetSecret:
    def test_fetches_and_decrypts(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()

        login_payload = {"username": "admin", "password": "s3cret"}
        encrypted = encrypt_payload(org_key, login_payload)

        http.get.return_value = {
            **VAULT_SECRET_DICT,
            "encrypted_payload": encrypted,
        }
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        secret = unlocked.get_secret("some-uuid")
        http.get.assert_called_once_with("/secrets/some-uuid")
        assert secret.name == "AWS Production"
        assert secret.payload.username == "admin"


class TestUnlockedVaultDeleteSecret:
    def test_calls_delete(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.delete_secret("some-uuid")
        http.delete.assert_called_once_with("/secrets/some-uuid")


class TestUnlockedVaultUpdateBoth:
    def test_sends_name_and_payload(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.get.return_value = VAULT_SECRET_DICT  # type check fetch
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret(
            "some-id",
            name="Updated",
            payload=LoginPayload(username="new", password="pw2"),
        )

        body = http.patch.call_args[1]["json"]
        assert body["name"] == "Updated"
        assert "encrypted_payload" in body


class TestUnlockedVaultUpdateDescription:
    """Cover vault.py line 315: description branch in update_secret."""

    def test_sends_description(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret("some-id", description="new description")

        body = http.patch.call_args[1]["json"]
        assert body == {"description": "new description"}

    def test_sends_description_none(self):
        """Explicitly setting description=None should send null."""
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.patch.return_value = VAULT_SECRET_DICT
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        unlocked.update_secret("some-id", description=None)

        body = http.patch.call_args[1]["json"]
        assert body == {"description": None}


class TestUnlockWrongKey:
    """Cover vault.py line 153: error when wrapped_org_encryption_key is None."""

    def test_raises_when_no_wrapped_key(self):
        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,  # info()
            {  # unlock() returns no wrapped key
                "wrapped_org_encryption_key": None,
                "encrypted_secrets": [],
            },
        ]

        with pytest.raises(ValueError, match="No vault key matched"):
            res.unlock(VALID_VAULT_KEY)

    def test_raises_when_wrapped_key_missing(self):
        """Key not present at all in the response dict."""
        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,  # info()
            {  # unlock() returns no wrapped key field
                "encrypted_secrets": [],
            },
        ]

        with pytest.raises(ValueError, match="No vault key matched"):
            res.unlock(VALID_VAULT_KEY)


class TestUnlockIdentityFiltering:
    """Cover vault.py lines 182-190: identity_id filtering path."""

    def test_filters_secrets_by_identity_access(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key)

        # Create two secrets with different IDs
        secret1_dict = {
            **VAULT_SECRET_DICT,
            "id": "cccc3333-0000-0000-0000-000000000001",
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin1", "password": "pw1"}
            ),
        }
        secret2_dict = {
            **VAULT_SECRET_DICT,
            "id": "cccc3333-0000-0000-0000-000000000002",
            "name": "AWS Staging",
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin2", "password": "pw2"}
            ),
        }

        identity = "dddd4444-0000-0000-0000-000000000001"

        res, http = _resource()

        # info() -> unlock() -> access for secret1 -> access for secret2
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [secret1_dict, secret2_dict],
            },
            # Access rules for secret1: this identity HAS access
            [{"identity_id": identity, "secret_id": "cccc3333-0000-0000-0000-000000000001"}],
            # Access rules for secret2: different identity, no match
            [{"identity_id": "eeee5555-0000-0000-0000-000000000099", "secret_id": "cccc3333-0000-0000-0000-000000000002"}],
        ]

        unlocked = res.unlock(vault_key, identity_id=identity)

        # Only secret1 should be in the result
        assert len(unlocked.secrets) == 1
        assert unlocked.secrets[0].payload.username == "admin1"

    def test_identity_filter_removes_all_when_no_access(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key)

        secret_dict = {
            **VAULT_SECRET_DICT,
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin", "password": "pw"}
            ),
        }

        identity = "dddd4444-0000-0000-0000-000000000001"

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [secret_dict],
            },
            # No matching access rules
            [{"identity_id": "other-identity", "secret_id": "cccc3333-0000-0000-0000-000000000001"}],
        ]

        unlocked = res.unlock(vault_key, identity_id=identity)
        assert len(unlocked.secrets) == 0

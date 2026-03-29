"""
sdk/python/tests/test_vault_resource.py

Tests for VaultResource and UnlockedVault.
"""

from unittest.mock import MagicMock

import pytest
from sample_data_vault import VAULT_INFO_DICT, VAULT_KEY_DICT, VAULT_SECRET_DICT
from inkbox.vault.crypto import (
    compute_auth_hash,
    derive_master_key,
    derive_salt,
    encrypt_payload,
    generate_org_encryption_key,
    unwrap_org_key,
    wrap_org_key,
)
from inkbox.vault.resources.vault import VaultResource, UnlockedVault
from inkbox.vault.types import (
    AccessRule,
    LoginPayload,
    OtherPayload,
    VaultInfo,
    VaultInitializeResult,
    VaultKey,
    VaultSecret,
)

VALID_VAULT_KEY = "Test-Passw0rd!xy"


def _resource():
    http = MagicMock()
    api_http = MagicMock()
    api_http.get.return_value = {"organization_id": "org_test_123"}
    return VaultResource(http, api_http=api_http), http


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


ACCESS_RULE_DICT = {
    "id": "aaaa0000-0000-0000-0000-000000000001",
    "vault_secret_id": "bbbb0000-0000-0000-0000-000000000002",
    "identity_id": "cccc0000-0000-0000-0000-000000000003",
    "created_at": "2026-03-18T12:00:00Z",
}


class TestVaultResourceAccessRules:
    def test_list_access_rules(self):
        res, http = _resource()
        http.get.return_value = [ACCESS_RULE_DICT]
        rules = res.list_access_rules("some-secret-id")
        http.get.assert_called_once_with("/secrets/some-secret-id/access")
        assert len(rules) == 1
        assert isinstance(rules[0], AccessRule)
        assert str(rules[0].identity_id) == ACCESS_RULE_DICT["identity_id"]

    def test_grant_access(self):
        res, http = _resource()
        http.post.return_value = ACCESS_RULE_DICT
        rule = res.grant_access("some-secret-id", "some-identity-id")
        http.post.assert_called_once_with(
            "/secrets/some-secret-id/access",
            json={"identity_id": "some-identity-id"},
        )
        assert isinstance(rule, AccessRule)

    def test_revoke_access(self):
        res, http = _resource()
        res.revoke_access("some-secret-id", "some-identity-id")
        http.delete.assert_called_once_with(
            "/secrets/some-secret-id/access/some-identity-id",
        )


class TestVaultResourceUnlock:
    def test_unlock_decrypts_secrets(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])

        login_payload = {"username": "admin", "password": "s3cret"}
        encrypted = encrypt_payload(org_key, login_payload, secret_id=VAULT_SECRET_DICT["id"])

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
            [VAULT_KEY_DICT],  # /keys
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
        wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])

        res, http = _resource()
        assert res._unlocked is None
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [],
            },
            [VAULT_KEY_DICT],  # /keys
        ]
        unlocked = res.unlock(vault_key)
        assert res._unlocked is unlocked

    def test_unlock_with_identity_id_stores_unfiltered_state(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        vault_key = VALID_VAULT_KEY

        salt = derive_salt(org_id)
        mk = derive_master_key(vault_key, salt)
        wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [],
            },
            [VAULT_KEY_DICT],  # /keys
        ]
        returned = res.unlock(vault_key, identity_id="some-identity")
        # _unlocked is always populated (unfiltered) so identity.credentials works
        assert res._unlocked is not None
        # But the returned vault is a separate filtered instance
        assert returned is not res._unlocked

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
        # get_secret is called after create to populate cache
        login_payload = {"password": "pw", "username": "admin"}
        encrypted = encrypt_payload(org_key, login_payload, secret_id=VAULT_SECRET_DICT["id"])
        http.get.return_value = {**VAULT_SECRET_DICT, "encrypted_payload": encrypted}
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        result = unlocked.create_secret(
            "AWS Prod",
            LoginPayload(password="pw", username="admin"),
            description="Prod creds",
        )

        assert isinstance(result, VaultSecret)
        http.post.assert_called_once()
        body = http.post.call_args.kwargs["json"]
        assert body["name"] == "AWS Prod"
        assert body["description"] == "Prod creds"
        assert body["secret_type"] == "login"
        assert "encrypted_payload" in body

    def test_create_appends_to_cache(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        http.post.return_value = VAULT_SECRET_DICT
        login_payload = {"password": "pw", "username": "admin"}
        encrypted = encrypt_payload(org_key, login_payload, secret_id=VAULT_SECRET_DICT["id"])
        http.get.return_value = {**VAULT_SECRET_DICT, "encrypted_payload": encrypted}
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        assert len(unlocked.secrets) == 0

        unlocked.create_secret("Test", LoginPayload(password="pw", username="admin"))

        assert len(unlocked.secrets) == 1
        assert unlocked.secrets[0].name == "AWS Production"
        assert unlocked.secrets[0].payload.username == "admin"


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
            payload=LoginPayload(password="pw2", username="new"),
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
        encrypted = encrypt_payload(org_key, login_payload, secret_id=VAULT_SECRET_DICT["id"])

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
            payload=LoginPayload(password="pw2", username="new"),
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
        wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])

        # Create two secrets with different IDs
        secret1_dict = {
            **VAULT_SECRET_DICT,
            "id": "cccc3333-0000-0000-0000-000000000001",
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin1", "password": "pw1"},
                secret_id="cccc3333-0000-0000-0000-000000000001",
            ),
        }
        secret2_dict = {
            **VAULT_SECRET_DICT,
            "id": "cccc3333-0000-0000-0000-000000000002",
            "name": "AWS Staging",
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin2", "password": "pw2"},
                secret_id="cccc3333-0000-0000-0000-000000000002",
            ),
        }

        identity = "dddd4444-0000-0000-0000-000000000001"

        res, http = _resource()

        # info() -> unlock() -> keys -> access for secret1 -> access for secret2
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [secret1_dict, secret2_dict],
            },
            [VAULT_KEY_DICT],  # /keys
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
        wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])

        secret_dict = {
            **VAULT_SECRET_DICT,
            "encrypted_payload": encrypt_payload(
                org_key, {"username": "admin", "password": "pw"},
                secret_id=VAULT_SECRET_DICT["id"],
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
            [VAULT_KEY_DICT],  # /keys
            # No matching access rules
            [{"identity_id": "other-identity", "secret_id": "cccc3333-0000-0000-0000-000000000001"}],
        ]

        unlocked = res.unlock(vault_key, identity_id=identity)
        assert len(unlocked.secrets) == 0


# ---- TOTP integration tests ----

SECRET_ID = "cccc3333-0000-0000-0000-000000000001"
TOTP_SECRET = "JBSWY3DPEHPK3PXP"


def _unlocked_with_login(*, totp_config=None):
    """Build an UnlockedVault with a login secret in the cache."""
    org_key = generate_org_encryption_key()
    http = MagicMock()
    login_dict = {"password": "s3cret", "username": "admin"}
    if totp_config is not None:
        login_dict["totp"] = totp_config
    encrypted = encrypt_payload(org_key, login_dict, secret_id=VAULT_SECRET_DICT["id"])
    # get_secret will return this when fetching the secret
    http.get.return_value = {
        **VAULT_SECRET_DICT,
        "encrypted_payload": encrypted,
    }
    http.patch.return_value = VAULT_SECRET_DICT

    from inkbox.vault.types import DecryptedVaultSecret, _parse_payload
    payload = _parse_payload("login", login_dict)
    from uuid import UUID
    from datetime import datetime
    cached_secret = DecryptedVaultSecret(
        id=UUID(VAULT_SECRET_DICT["id"]),
        name=VAULT_SECRET_DICT["name"],
        secret_type="login",
        status="active",
        created_at=datetime.fromisoformat(VAULT_SECRET_DICT["created_at"]),
        updated_at=datetime.fromisoformat(VAULT_SECRET_DICT["updated_at"]),
        payload=payload,
        description=VAULT_SECRET_DICT["description"],
    )
    unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[cached_secret])
    return unlocked, http


class TestUnlockedVaultSetTotp:
    def test_set_totp_with_config(self):
        from inkbox.vault.totp import TOTPConfig
        unlocked, http = _unlocked_with_login()
        config = TOTPConfig(secret=TOTP_SECRET)

        result = unlocked.set_totp(SECRET_ID, config)

        assert isinstance(result, VaultSecret)
        # Should have called patch with encrypted payload
        http.patch.assert_called_once()
        body = http.patch.call_args[1]["json"]
        assert "encrypted_payload" in body

    def test_set_totp_with_uri(self):
        unlocked, http = _unlocked_with_login()
        uri = f"otpauth://totp/Test?secret={TOTP_SECRET}&issuer=Test"

        result = unlocked.set_totp(SECRET_ID, uri)

        assert isinstance(result, VaultSecret)
        http.patch.assert_called_once()

    def test_set_totp_rejects_non_login(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        other_dict = {"data": "freeform"}
        encrypted = encrypt_payload(org_key, other_dict, secret_id=VAULT_SECRET_DICT["id"])
        other_secret_dict = {**VAULT_SECRET_DICT, "secret_type": "other", "encrypted_payload": encrypted}
        http.get.return_value = other_secret_dict
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        from inkbox.vault.totp import TOTPConfig
        with pytest.raises(TypeError, match="only login secrets support TOTP"):
            unlocked.set_totp(SECRET_ID, TOTPConfig(secret=TOTP_SECRET))


class TestUnlockedVaultRemoveTotp:
    def test_remove_totp(self):
        totp_dict = {"secret": TOTP_SECRET, "algorithm": "sha1", "digits": 6, "period": 30}
        unlocked, http = _unlocked_with_login(totp_config=totp_dict)

        result = unlocked.remove_totp(SECRET_ID)

        assert isinstance(result, VaultSecret)
        http.patch.assert_called_once()

    def test_remove_totp_rejects_non_login(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        other_dict = {"data": "freeform"}
        encrypted = encrypt_payload(org_key, other_dict, secret_id=VAULT_SECRET_DICT["id"])
        http.get.return_value = {**VAULT_SECRET_DICT, "secret_type": "other", "encrypted_payload": encrypted}
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        with pytest.raises(TypeError, match="only login secrets support TOTP"):
            unlocked.remove_totp(SECRET_ID)


class TestUnlockedVaultGetTotpCode:
    def test_generates_code(self):
        totp_dict = {"secret": TOTP_SECRET, "algorithm": "sha1", "digits": 6, "period": 30}
        unlocked, http = _unlocked_with_login(totp_config=totp_dict)

        from inkbox.vault.totp import TOTPCode
        code = unlocked.get_totp_code(SECRET_ID)

        assert isinstance(code, TOTPCode)
        assert len(code.code) == 6
        assert code.code.isdigit()
        assert code.seconds_remaining > 0

    def test_raises_when_no_totp(self):
        unlocked, http = _unlocked_with_login()

        with pytest.raises(ValueError, match="no TOTP configured"):
            unlocked.get_totp_code(SECRET_ID)

    def test_raises_for_non_login(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        other_dict = {"data": "freeform"}
        encrypted = encrypt_payload(org_key, other_dict, secret_id=VAULT_SECRET_DICT["id"])
        http.get.return_value = {**VAULT_SECRET_DICT, "secret_type": "other", "encrypted_payload": encrypted}
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])

        with pytest.raises(TypeError, match="only login secrets support TOTP"):
            unlocked.get_totp_code(SECRET_ID)


class TestUnlockedVaultCacheConsistency:
    def test_set_totp_updates_cache(self):
        """After set_totp, the secrets cache should reflect the new TOTP config."""
        from inkbox.vault.totp import TOTPConfig
        totp_dict = {"secret": TOTP_SECRET, "algorithm": "sha1", "digits": 6, "period": 30}
        unlocked, http = _unlocked_with_login()

        # Before: no TOTP in cache
        assert unlocked.secrets[0].payload.totp is None

        # set_totp triggers update_secret which calls _refresh_cached_secret
        # The mock http.get returns a secret with TOTP after the PATCH
        login_with_totp = {"password": "s3cret", "username": "admin", "totp": totp_dict}
        encrypted_with_totp = encrypt_payload(unlocked._org_key, login_with_totp, secret_id=VAULT_SECRET_DICT["id"])
        http.get.return_value = {**VAULT_SECRET_DICT, "encrypted_payload": encrypted_with_totp}

        unlocked.set_totp(SECRET_ID, TOTPConfig(secret=TOTP_SECRET))

        # After: cache should have the TOTP config
        assert unlocked.secrets[0].payload.totp is not None
        assert unlocked.secrets[0].payload.totp.secret == TOTP_SECRET

    def test_delete_secret_removes_from_cache(self):
        unlocked, http = _unlocked_with_login()
        assert len(unlocked.secrets) == 1

        unlocked.delete_secret(SECRET_ID)

        assert len(unlocked.secrets) == 0


class TestStrictAADEnforcement:
    def test_rejects_payload_encrypted_with_wrong_secret_id(self):
        org_key = generate_org_encryption_key()
        http = MagicMock()
        encrypted = encrypt_payload(org_key, {"password": "pw", "username": "u"}, secret_id="wrong-id")
        http.get.return_value = {**VAULT_SECRET_DICT, "encrypted_payload": encrypted}
        unlocked = UnlockedVault(http=http, org_key=org_key, secrets_cache=[])
        with pytest.raises(Exception):
            unlocked.get_secret("cccc3333-0000-0000-0000-000000000001")


# ---- VaultResource.initialize tests ----


class TestVaultResourceInitialize:
    def test_posts_crypto_material_and_returns_result(self):
        res, http = _resource()
        http.post.return_value = {
            "vault_id": "aaaa1111-0000-0000-0000-000000000099",
            "vault_key_id": "bbbb2222-0000-0000-0000-000000000099",
            "recovery_key_count": 4,
        }

        result = res.initialize(VALID_VAULT_KEY)

        assert isinstance(result, VaultInitializeResult)
        assert str(result.vault_id) == "aaaa1111-0000-0000-0000-000000000099"
        assert str(result.vault_key_id) == "bbbb2222-0000-0000-0000-000000000099"
        assert result.recovery_key_count == 4
        assert len(result.recovery_codes) == 4

        # Verify HTTP call
        http.post.assert_called_once()
        call_kwargs = http.post.call_args
        assert call_kwargs[0][0] == "/initialize"
        body = call_kwargs[1]["json"]

        # vault_key must be primary with all required fields
        vk = body["vault_key"]
        assert "id" in vk
        assert "wrapped_org_encryption_key" in vk
        assert "auth_hash" in vk
        assert vk["key_type"] == "primary"

        # recovery_keys must have 4 entries, all recovery type
        assert len(body["recovery_keys"]) == 4
        for rk in body["recovery_keys"]:
            assert "id" in rk
            assert "wrapped_org_encryption_key" in rk
            assert "auth_hash" in rk
            assert rk["key_type"] == "recovery"

    def test_recovery_codes_match_expected_pattern(self):
        import re

        res, http = _resource()
        http.post.return_value = {
            "vault_id": "aaaa1111-0000-0000-0000-000000000099", "vault_key_id": "bbbb2222-0000-0000-0000-000000000099", "recovery_key_count": 4,
        }

        result = res.initialize(VALID_VAULT_KEY)

        pattern = re.compile(r"^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$")
        for code in result.recovery_codes:
            assert pattern.match(code), f"Recovery code {code!r} does not match pattern"

    def test_all_key_ids_and_auth_hashes_unique(self):
        res, http = _resource()
        http.post.return_value = {
            "vault_id": "aaaa1111-0000-0000-0000-000000000099", "vault_key_id": "bbbb2222-0000-0000-0000-000000000099", "recovery_key_count": 4,
        }
        res.initialize(VALID_VAULT_KEY)

        body = http.post.call_args[1]["json"]
        all_keys = [body["vault_key"]] + body["recovery_keys"]
        ids = [k["id"] for k in all_keys]
        hashes = [k["auth_hash"] for k in all_keys]
        assert len(set(ids)) == 5, "All key IDs must be unique"
        assert len(set(hashes)) == 5, "All auth hashes must be unique"

    def test_wrapped_org_key_can_be_round_tripped(self):
        """Verify that the vault key in the POST body can actually unwrap
        the org encryption key — a crypto round-trip test."""
        res, http = _resource()
        http.post.return_value = {
            "vault_id": "aaaa1111-0000-0000-0000-000000000099", "vault_key_id": "bbbb2222-0000-0000-0000-000000000099", "recovery_key_count": 4,
        }
        res.initialize(VALID_VAULT_KEY)

        body = http.post.call_args[1]["json"]
        vk = body["vault_key"]
        salt = derive_salt("org_test_123")
        mk = derive_master_key(VALID_VAULT_KEY, salt)
        org_key = unwrap_org_key(mk, vk["wrapped_org_encryption_key"], vault_key_id=vk["id"])
        assert isinstance(org_key, bytes)
        assert len(org_key) == 32

    def test_all_recovery_codes_unwrap_same_org_key(self):
        """Each recovery code must unwrap to the identical org encryption key."""
        res, http = _resource()
        http.post.return_value = {
            "vault_id": "aaaa1111-0000-0000-0000-000000000099", "vault_key_id": "bbbb2222-0000-0000-0000-000000000099", "recovery_key_count": 4,
        }
        result = res.initialize(VALID_VAULT_KEY)

        body = http.post.call_args[1]["json"]
        salt = derive_salt("org_test_123")

        # Reference: unwrap via primary key
        vk = body["vault_key"]
        primary_mk = derive_master_key(VALID_VAULT_KEY, salt)
        reference_org_key = unwrap_org_key(
            primary_mk, vk["wrapped_org_encryption_key"], vault_key_id=vk["id"],
        )

        for i, code in enumerate(result.recovery_codes):
            rk = body["recovery_keys"][i]
            rc_mk = derive_master_key(code, salt)
            org_key = unwrap_org_key(
                rc_mk, rk["wrapped_org_encryption_key"], vault_key_id=rk["id"],
            )
            assert org_key == reference_org_key, f"Recovery code {i} unwrapped different org key"


# ---- VaultResource.update_key tests ----


def _setup_vault_crypto():
    """Create real crypto state for a vault with a known vault key."""
    org_key = generate_org_encryption_key()
    vault_key = VALID_VAULT_KEY
    org_id = "org_test_123"
    salt = derive_salt(org_id)
    mk = derive_master_key(vault_key, salt)
    auth_hash = compute_auth_hash(mk)
    wrapped = wrap_org_key(mk, org_key, vault_key_id=VAULT_KEY_DICT["id"])
    return org_key, vault_key, org_id, mk, auth_hash, wrapped


class TestVaultResourceUpdateKey:
    def test_normal_update_derives_auth_and_puts(self):
        org_key, vault_key, org_id, mk, auth_hash, wrapped = _setup_vault_crypto()
        new_vault_key = "New-Passw0rd!xyz"

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,                              # info()
            {                                             # /unlock
                "wrapped_org_encryption_key": wrapped,
                "encrypted_secrets": [],
            },
            [VAULT_KEY_DICT],                             # /keys
        ]
        http.put.return_value = {**VAULT_KEY_DICT, "id": "eeee5555-0000-0000-0000-000000000099"}

        result = res.update_key(new_vault_key, current_vault_key=vault_key)

        assert isinstance(result, VaultKey)
        assert str(result.id) == "eeee5555-0000-0000-0000-000000000099"

        http.put.assert_called_once()
        call_args = http.put.call_args
        assert call_args[0][0] == "/keys/primary"
        body = call_args[1]["json"]
        assert "id" in body
        assert "wrapped_org_encryption_key" in body
        assert "auth_hash" in body
        assert "current_auth_hash" in body
        assert "recovery_auth_hash" not in body

    def test_recovery_update_uses_recovery_auth_hash(self):
        org_key = generate_org_encryption_key()
        org_id = "org_test_123"
        recovery_code = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789"
        salt = derive_salt(org_id)
        recovery_mk = derive_master_key(recovery_code, salt)
        recovery_wrapped = wrap_org_key(recovery_mk, org_key, vault_key_id="recovery-key-id")

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {
                "wrapped_org_encryption_key": recovery_wrapped,
                "encrypted_secrets": [],
            },
            [
                {**VAULT_KEY_DICT, "id": "recovery-key-id", "key_type": "recovery"},
            ],
        ]
        http.put.return_value = {**VAULT_KEY_DICT, "id": "eeee5555-0000-0000-0000-000000000099"}

        result = res.update_key("New-Passw0rd!xyz", recovery_code=recovery_code)

        assert str(result.id) == "eeee5555-0000-0000-0000-000000000099"
        body = http.put.call_args[1]["json"]
        assert "recovery_auth_hash" in body
        assert "current_auth_hash" not in body

    def test_new_key_can_be_unlocked_with_new_vault_key(self):
        """Verify that the wrapped org key in the PUT body can be unwrapped
        with the new vault key — and yields the original org key."""
        org_key, vault_key, org_id, mk, auth_hash, wrapped = _setup_vault_crypto()
        new_vault_key = "New-Passw0rd!xyz"

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"wrapped_org_encryption_key": wrapped, "encrypted_secrets": []},
            [VAULT_KEY_DICT],
        ]
        http.put.return_value = VAULT_KEY_DICT

        res.update_key(new_vault_key, current_vault_key=vault_key)

        body = http.put.call_args[1]["json"]
        salt = derive_salt("org_test_123")
        new_mk = derive_master_key(new_vault_key, salt)
        unwrapped = unwrap_org_key(
            new_mk, body["wrapped_org_encryption_key"], vault_key_id=body["id"],
        )
        assert unwrapped == org_key

    def test_current_auth_hash_matches_derived_hash(self):
        org_key, vault_key, org_id, mk, auth_hash, wrapped = _setup_vault_crypto()

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"wrapped_org_encryption_key": wrapped, "encrypted_secrets": []},
            [VAULT_KEY_DICT],
        ]
        http.put.return_value = VAULT_KEY_DICT

        res.update_key("New-Passw0rd!xyz", current_vault_key=vault_key)

        body = http.put.call_args[1]["json"]
        assert body["current_auth_hash"] == auth_hash

    def test_sends_correct_auth_hash_to_unlock(self):
        org_key, vault_key, org_id, mk, auth_hash, wrapped = _setup_vault_crypto()

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"wrapped_org_encryption_key": wrapped, "encrypted_secrets": []},
            [VAULT_KEY_DICT],
        ]
        http.put.return_value = VAULT_KEY_DICT

        res.update_key("New-Passw0rd!xyz", current_vault_key=vault_key)

        # Second get call should be /unlock with the correct auth_hash
        unlock_call = http.get.call_args_list[1]
        assert unlock_call[0][0] == "/unlock"
        assert unlock_call[1]["params"] == {"auth_hash": auth_hash}

    def test_raises_when_neither_auth_method_provided(self):
        res, http = _resource()
        with pytest.raises(ValueError, match="Exactly one of"):
            res.update_key("New-Passw0rd!xyz")

    def test_raises_when_both_auth_methods_provided(self):
        res, http = _resource()
        with pytest.raises(ValueError, match="Exactly one of"):
            res.update_key(
                "New-Passw0rd!xyz",
                current_vault_key=VALID_VAULT_KEY,
                recovery_code="some-code",
            )

    def test_raises_when_no_vault_key_matches(self):
        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"wrapped_org_encryption_key": None, "encrypted_secrets": []},
        ]
        with pytest.raises(ValueError, match="No vault key matched"):
            res.update_key("New-Passw0rd!xyz", current_vault_key=VALID_VAULT_KEY)

    def test_raises_when_wrapped_key_missing(self):
        """Response has no wrapped_org_encryption_key field at all."""
        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"encrypted_secrets": []},
        ]
        with pytest.raises(ValueError, match="No vault key matched"):
            res.update_key("New-Passw0rd!xyz", current_vault_key=VALID_VAULT_KEY)

    def test_raises_when_org_key_cannot_be_unwrapped(self):
        """AAD mismatch: the key ID returned by /keys doesn't match the one
        used to wrap the org key."""
        _, vault_key, _, _, _, wrapped = _setup_vault_crypto()

        res, http = _resource()
        http.get.side_effect = [
            VAULT_INFO_DICT,
            {"wrapped_org_encryption_key": wrapped, "encrypted_secrets": []},
            [{**VAULT_KEY_DICT, "id": "wrong-key-id"}],
        ]
        with pytest.raises(ValueError, match="Failed to unwrap"):
            res.update_key("New-Passw0rd!xyz", current_vault_key=vault_key)


class TestVaultResourceDeleteKey:
    def test_deletes_key_by_auth_hash(self):
        res, http = _resource()

        res.delete_key("auth-hash-123")

        http.delete.assert_called_once_with("/keys/auth-hash-123")

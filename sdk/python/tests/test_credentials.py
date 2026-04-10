"""
sdk/python/tests/test_credentials.py

Tests for the Credentials class and AgentIdentity.credentials integration.
"""

from unittest.mock import MagicMock
from uuid import UUID

import pytest
from inkbox.credentials import Credentials
from inkbox.vault.types import (
    APIKeyPayload,
    DecryptedVaultSecret,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
)
from inkbox.agent_identity import AgentIdentity
from inkbox.identities.types import _AgentIdentityData
from inkbox.exceptions import InkboxError
from datetime import datetime


# -- Fixtures ---------------------------------------------------------------

LOGIN_SECRET = DecryptedVaultSecret(
    id=UUID("aaaa0000-0000-0000-0000-000000000001"),
    name="GitHub Login",
    secret_type="login",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=LoginPayload(password="s3cret", username="admin", url="https://github.com"),
)

API_KEY_SECRET = DecryptedVaultSecret(
    id=UUID("bbbb0000-0000-0000-0000-000000000002"),
    name="OpenAI Key",
    secret_type="api_key",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=APIKeyPayload(api_key="sk-abc123", endpoint="https://api.openai.com"),
)

SSH_KEY_SECRET = DecryptedVaultSecret(
    id=UUID("cccc0000-0000-0000-0000-000000000003"),
    name="Prod Server",
    secret_type="ssh_key",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=SSHKeyPayload(private_key="-----BEGIN OPENSSH PRIVATE KEY-----..."),
)

OTHER_SECRET = DecryptedVaultSecret(
    id=UUID("dddd0000-0000-0000-0000-000000000004"),
    name="Misc",
    secret_type="other",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=OtherPayload(data="something"),
)

ALL_SECRETS = [LOGIN_SECRET, API_KEY_SECRET, SSH_KEY_SECRET, OTHER_SECRET]


def _creds(secrets=None):
    return Credentials(secrets if secrets is not None else ALL_SECRETS)


# -- Credentials unit tests -------------------------------------------------


class TestCredentialsList:
    def test_list_returns_all(self):
        creds = _creds()
        assert len(creds.list()) == 4

    def test_list_logins(self):
        result = _creds().list_logins()
        assert len(result) == 1
        assert result[0].name == "GitHub Login"

    def test_list_api_keys(self):
        result = _creds().list_api_keys()
        assert len(result) == 1
        assert result[0].name == "OpenAI Key"

    def test_list_ssh_keys(self):
        result = _creds().list_ssh_keys()
        assert len(result) == 1
        assert result[0].name == "Prod Server"

    def test_list_returns_copy(self):
        creds = _creds()
        a = creds.list()
        b = creds.list()
        assert a is not b

    def test_empty_credentials(self):
        creds = _creds([])
        assert creds.list() == []
        assert creds.list_logins() == []
        assert len(creds) == 0


class TestCredentialsGet:
    def test_get_by_uuid(self):
        secret = _creds().get("aaaa0000-0000-0000-0000-000000000001")
        assert secret.name == "GitHub Login"

    def test_get_by_uuid_object(self):
        secret = _creds().get(UUID("aaaa0000-0000-0000-0000-000000000001"))
        assert secret.name == "GitHub Login"

    def test_get_unknown_raises_key_error(self):
        with pytest.raises(KeyError, match="No credential with id"):
            _creds().get("00000000-0000-0000-0000-000000000099")


class TestCredentialsGetTyped:
    def test_get_login(self):
        payload = _creds().get_login("aaaa0000-0000-0000-0000-000000000001")
        assert isinstance(payload, LoginPayload)
        assert payload.username == "admin"

    def test_get_api_key(self):
        payload = _creds().get_api_key("bbbb0000-0000-0000-0000-000000000002")
        assert isinstance(payload, APIKeyPayload)
        assert payload.api_key == "sk-abc123"

    def test_get_ssh_key(self):
        payload = _creds().get_ssh_key("cccc0000-0000-0000-0000-000000000003")
        assert isinstance(payload, SSHKeyPayload)

    def test_get_login_wrong_type_raises_type_error(self):
        with pytest.raises(TypeError, match="'api_key' secret, not 'login'"):
            _creds().get_login("bbbb0000-0000-0000-0000-000000000002")

    def test_get_api_key_wrong_type_raises_type_error(self):
        with pytest.raises(TypeError, match="'login' secret, not 'api_key'"):
            _creds().get_api_key("aaaa0000-0000-0000-0000-000000000001")

    def test_get_ssh_key_wrong_type_raises_type_error(self):
        with pytest.raises(TypeError, match="not 'ssh_key'"):
            _creds().get_ssh_key("aaaa0000-0000-0000-0000-000000000001")

    def test_get_typed_unknown_raises_key_error(self):
        with pytest.raises(KeyError):
            _creds().get_login("00000000-0000-0000-0000-000000000099")


class TestCredentialsDunder:
    def test_len(self):
        assert len(_creds()) == 4
        assert len(_creds([])) == 0

    def test_repr(self):
        assert repr(_creds()) == "Credentials(4 secrets)"


# -- AgentIdentity.credentials integration ----------------------------------

IDENTITY_ID = "ee000000-0000-0000-0000-000000000001"


def _identity(*, vault_unlocked=True, access_rules=None):
    """Build a mock AgentIdentity with wired-up Inkbox + VaultResource."""
    inkbox = MagicMock()
    identity_data = _AgentIdentityData(
        id=UUID(IDENTITY_ID),
        organization_id="org_test_123",
        agent_handle="test-bot",
    
        email_address="test-bot@inkboxmail.com",
        created_at=datetime(2026, 1, 1),
        updated_at=datetime(2026, 1, 1),
        mailbox=None,
        phone_number=None,
    )

    # Wire up VaultResource with stored unlocked vault
    vault = MagicMock()
    vault._unlocked = None
    if vault_unlocked:
        unlocked = MagicMock()
        unlocked.secrets = list(ALL_SECRETS)
        vault._unlocked = unlocked

    # Default: all secrets accessible by this identity
    if access_rules is None:
        access_rules = [{"identity_id": IDENTITY_ID}]
    vault._http.get.return_value = access_rules

    inkbox._vault_resource = vault
    return AgentIdentity(identity_data, inkbox)


class TestAgentIdentityCredentials:
    def test_raises_when_vault_not_unlocked(self):
        identity = _identity(vault_unlocked=False)
        with pytest.raises(InkboxError, match="Vault must be unlocked"):
            _ = identity.credentials

    def test_returns_all_unlocked_secrets(self):
        identity = _identity()
        creds = identity.credentials
        assert isinstance(creds, Credentials)
        assert len(creds) == 4

    def test_returns_all_secrets_regardless_of_access_rules(self):
        identity = _identity(access_rules=[])
        creds = identity.credentials
        assert len(creds) == 4

    def test_caches_credentials(self):
        identity = _identity()
        creds1 = identity.credentials
        creds2 = identity.credentials
        assert creds1 is creds2

    def test_refresh_clears_cache(self):
        identity = _identity()
        _ = identity.credentials
        assert identity._credentials is not None
        identity._inkbox._ids_resource.get.return_value = _AgentIdentityData(
            id=UUID(IDENTITY_ID),
            organization_id="org_test_123",
            agent_handle="test-bot",
        
            email_address="test-bot@inkboxmail.com",
            created_at=datetime(2026, 1, 1),
            updated_at=datetime(2026, 1, 1),
            mailbox=None,
            phone_number=None,
            )
        identity.refresh()
        assert identity._credentials is None

    def test_revoke_credential_access(self):
        identity = _identity()
        _ = identity.credentials
        assert identity._credentials is not None
        identity.revoke_credential_access("aaaa0000-0000-0000-0000-000000000001")
        vault = identity._inkbox._vault_resource
        vault.revoke_access.assert_called_once_with(
            "aaaa0000-0000-0000-0000-000000000001",
            identity_id=identity.id,
        )
        assert identity._credentials is None


# ---- Credentials.get_totp_code tests ----

TOTP_SECRET = "JBSWY3DPEHPK3PXP"

LOGIN_WITH_TOTP = DecryptedVaultSecret(
    id=UUID("ffff0000-0000-0000-0000-000000000006"),
    name="GitHub with 2FA",
    secret_type="login",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=LoginPayload(
        password="s3cret",
        username="admin",
        totp=__import__("inkbox.vault.totp", fromlist=["TOTPConfig"]).TOTPConfig(
            secret=TOTP_SECRET,
        ),
    ),
)

LOGIN_WITHOUT_TOTP = DecryptedVaultSecret(
    id=UUID("ffff0000-0000-0000-0000-000000000007"),
    name="GitHub no 2FA",
    secret_type="login",

    created_at=datetime(2026, 1, 1),
    updated_at=datetime(2026, 1, 1),
    payload=LoginPayload(password="s3cret", username="admin"),
)


class TestCredentialsGetTotpCode:
    def test_generates_code(self):
        from inkbox.vault.totp import TOTPCode
        creds = Credentials([LOGIN_WITH_TOTP])
        code = creds.get_totp_code("ffff0000-0000-0000-0000-000000000006")
        assert isinstance(code, TOTPCode)
        assert len(code.code) == 6
        assert code.code.isdigit()

    def test_raises_when_no_totp(self):
        creds = Credentials([LOGIN_WITHOUT_TOTP])
        with pytest.raises(ValueError, match="no TOTP configured"):
            creds.get_totp_code("ffff0000-0000-0000-0000-000000000007")

    def test_raises_for_non_login(self):
        creds = Credentials([API_KEY_SECRET])
        with pytest.raises(TypeError, match="not.*login"):
            creds.get_totp_code(str(API_KEY_SECRET.id))

    def test_raises_when_not_found(self):
        creds = Credentials([LOGIN_WITH_TOTP])
        with pytest.raises(KeyError):
            creds.get_totp_code("00000000-0000-0000-0000-000000000000")

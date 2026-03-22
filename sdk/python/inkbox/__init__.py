"""
inkbox — Python SDK for the Inkbox APIs.
"""

from inkbox.client import Inkbox
from inkbox.agent_identity import AgentIdentity

# Exceptions (canonical source: mail; identical in all submodules)
from inkbox.mail.exceptions import InkboxAPIError, InkboxError

# Mail types
from inkbox.mail.types import (
    Mailbox,
    Message,
    MessageDetail,
    Thread,
    ThreadDetail,
)

# Phone types
from inkbox.phone.types import (
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneNumber,
    PhoneTranscript,
    RateLimitInfo,
)

# Identity types
from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityAuthenticatorApp,
    IdentityMailbox,
    IdentityPhoneNumber,
)

# Authenticator types
from inkbox.authenticator.types import (
    AuthenticatorAccount,
    AuthenticatorApp,
    OTPCode,
)

# Vault types
from inkbox.vault.types import (
    APIKeyPayload,
    DecryptedVaultSecret,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
    VaultInfo,
    VaultKey,
    VaultSecret,
    VaultSecretDetail,
)
from inkbox.vault.crypto import (
    VaultKeyMaterial,
    generate_org_encryption_key,
    generate_recovery_code,
    generate_vault_key_material,
)

# Signing key + webhook verification
from inkbox.signing_keys import SigningKey, verify_webhook

__all__ = [
    # Entry points
    "Inkbox",
    "AgentIdentity",
    # Exceptions
    "InkboxError",
    "InkboxAPIError",
    # Mail types
    "Mailbox",
    "Message",
    "MessageDetail",
    "Thread",
    "ThreadDetail",
    # Phone types
    "PhoneCall",
    "PhoneCallWithRateLimit",
    "PhoneNumber",
    "PhoneTranscript",
    "RateLimitInfo",
    # Identity types
    "AgentIdentitySummary",
    "IdentityAuthenticatorApp",
    "IdentityMailbox",
    "IdentityPhoneNumber",
    # Authenticator types
    "AuthenticatorApp",
    "AuthenticatorAccount",
    "OTPCode",
    # Vault types
    "VaultInfo",
    "VaultKey",
    "VaultSecret",
    "VaultSecretDetail",
    "DecryptedVaultSecret",
    "LoginPayload",
    "SSHKeyPayload",
    "APIKeyPayload",
    "OtherPayload",
    "VaultKeyMaterial",
    "generate_org_encryption_key",
    "generate_vault_key_material",
    "generate_recovery_code",
    # Signing key + webhook verification
    "SigningKey",
    "verify_webhook",
]

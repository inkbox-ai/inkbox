"""
inkbox — Python SDK for the Inkbox APIs.
"""

from inkbox.client import Inkbox
from inkbox.agent_identity import AgentIdentity
from inkbox.credentials import Credentials

# Exceptions (canonical source)
from inkbox.exceptions import InkboxAPIError, InkboxError, InkboxVaultKeyError

# Mail types
from inkbox.mail.types import (
    Mailbox,
    Message,
    MessageDetail,
    MessageDirection,
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
    TextConversationSummary,
    TextMediaItem,
    TextMessage,
)

# Identity types
from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityMailbox,
    IdentityPhoneNumberCreateOptions,
    IdentityPhoneNumber,
    ResourceStatus,
)

# Vault types
from inkbox.vault.types import (
    AccessRule,
    APIKeyPayload,
    DecryptedVaultSecret,
    KeyPairPayload,
    LoginPayload,
    OtherPayload,
    SSHKeyPayload,
    VaultInfo,
    VaultInitializeResult,
    VaultKey,
    VaultKeyType,
    VaultSecret,
    VaultSecretDetail,
    VaultSecretType,
)
from inkbox.vault.totp import (
    TOTPAlgorithm,
    TOTPCode,
    TOTPConfig,
    generate_totp,
    parse_totp_uri,
)
from inkbox.vault.crypto import (
    VaultKeyMaterial,
    generate_org_encryption_key,
    generate_recovery_code,
    generate_vault_key_material,
)

# Agent signup types
from inkbox.agent_signup.types import (
    AgentSignupResponse,
    AgentSignupVerifyResponse,
    AgentSignupResendResponse,
    AgentSignupStatusResponse,
    SignupRestrictions,
)

# Signing key + webhook verification
from inkbox.signing_keys import SigningKey, verify_webhook

__all__ = [
    # Entry points
    "Inkbox",
    "AgentIdentity",
    "Credentials",
    # Exceptions
    "InkboxError",
    "InkboxAPIError",
    "InkboxVaultKeyError",
    # Mail types
    "Mailbox",
    "Message",
    "MessageDetail",
    "MessageDirection",
    "Thread",
    "ThreadDetail",
    # Phone types
    "PhoneCall",
    "PhoneCallWithRateLimit",
    "PhoneNumber",
    "PhoneTranscript",
    "RateLimitInfo",
    "TextConversationSummary",
    "TextMediaItem",
    "TextMessage",
    # Identity types
    "AgentIdentitySummary",
    "IdentityMailboxCreateOptions",
    "IdentityMailbox",
    "IdentityPhoneNumberCreateOptions",
    "IdentityPhoneNumber",
    "ResourceStatus",
    # Vault types
    "AccessRule",
    "VaultSecretType",
    "VaultKeyType",
    "VaultInfo",
    "VaultKey",
    "VaultSecret",
    "VaultSecretDetail",
    "DecryptedVaultSecret",
    "VaultInitializeResult",
    "LoginPayload",
    "SSHKeyPayload",
    "APIKeyPayload",
    "KeyPairPayload",
    "OtherPayload",
    "VaultKeyMaterial",
    "generate_org_encryption_key",
    "generate_vault_key_material",
    "generate_recovery_code",
    # TOTP
    "TOTPAlgorithm",
    "TOTPCode",
    "TOTPConfig",
    "generate_totp",
    "parse_totp_uri",
    # Agent signup types
    "AgentSignupResponse",
    "AgentSignupVerifyResponse",
    "AgentSignupResendResponse",
    "AgentSignupStatusResponse",
    "SignupRestrictions",
    # Signing key + webhook verification
    "SigningKey",
    "verify_webhook",
]

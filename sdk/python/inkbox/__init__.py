"""
inkbox — Python SDK for the Inkbox APIs.
"""

from inkbox.client import Inkbox
from inkbox.agent_identity import AgentIdentity
from inkbox.credentials import Credentials

# Exceptions (canonical source)
from inkbox.exceptions import (
    DuplicateContactRuleError,
    InkboxAPIError,
    InkboxError,
    InkboxVaultKeyError,
    RecipientBlockedError,
    RedundantContactAccessGrantError,
)

# Mail types
from inkbox.mail.types import (
    ContactRuleStatus,
    FilterMode,
    FilterModeChangeNotice,
    ForwardMode,
    MailContactRule,
    MailRuleAction,
    MailRuleMatchType,
    Mailbox,
    Message,
    MessageDetail,
    MessageDirection,
    Thread,
    ThreadDetail,
    ThreadFolder,
)

# Phone types
from inkbox.phone.types import (
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneContactRule,
    PhoneNumber,
    PhoneRuleAction,
    PhoneRuleMatchType,
    PhoneTranscript,
    RateLimitInfo,
    SmsDeliveryStatus,
    SmsStatus,
    TextConversationSummary,
    TextMediaItem,
    TextMessage,
    TextMessageOrigin,
)

# Identity types
from inkbox.identities.types import (
    AgentIdentitySummary,
    IdentityMailboxCreateOptions,
    IdentityMailbox,
    IdentityPhoneNumberCreateOptions,
    IdentityPhoneNumber,
)

# Contacts types
from inkbox.contacts.types import (
    Contact,
    ContactAccess,
    ContactAddress,
    ContactCustomField,
    ContactDate,
    ContactEmail,
    ContactImportResult,
    ContactImportResultItem,
    ContactPhone,
    ContactWebsite,
)

# Notes types
from inkbox.notes.types import Note, NoteAccess

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

# Whoami types and named auth_subtype constants
from inkbox.whoami.types import (
    AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED,
    AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED,
    AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED,
    WhoamiApiKeyResponse,
    WhoamiJwtResponse,
    WhoamiResponse,
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
    "DuplicateContactRuleError",
    "RecipientBlockedError",
    "RedundantContactAccessGrantError",
    # Mail types
    "ContactRuleStatus",
    "FilterMode",
    "FilterModeChangeNotice",
    "ForwardMode",
    "MailContactRule",
    "MailRuleAction",
    "MailRuleMatchType",
    "Mailbox",
    "Message",
    "MessageDetail",
    "MessageDirection",
    "Thread",
    "ThreadDetail",
    "ThreadFolder",
    # Phone types
    "PhoneCall",
    "PhoneCallWithRateLimit",
    "PhoneContactRule",
    "PhoneNumber",
    "PhoneRuleAction",
    "PhoneRuleMatchType",
    "PhoneTranscript",
    "RateLimitInfo",
    "SmsDeliveryStatus",
    "SmsStatus",
    "TextConversationSummary",
    "TextMediaItem",
    "TextMessage",
    "TextMessageOrigin",
    # Identity types
    "AgentIdentitySummary",
    "IdentityMailboxCreateOptions",
    "IdentityMailbox",
    "IdentityPhoneNumberCreateOptions",
    "IdentityPhoneNumber",
    # Contacts types
    "Contact",
    "ContactAccess",
    "ContactAddress",
    "ContactCustomField",
    "ContactDate",
    "ContactEmail",
    "ContactImportResult",
    "ContactImportResultItem",
    "ContactPhone",
    "ContactWebsite",
    # Notes types
    "Note",
    "NoteAccess",
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
    # Whoami types + auth_subtype constants
    "AUTH_SUBTYPE_API_KEY_ADMIN_SCOPED",
    "AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_CLAIMED",
    "AUTH_SUBTYPE_API_KEY_AGENT_SCOPED_UNCLAIMED",
    "WhoamiApiKeyResponse",
    "WhoamiJwtResponse",
    "WhoamiResponse",
    # Signing key + webhook verification
    "SigningKey",
    "verify_webhook",
]

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
    IdentityMailbox,
    IdentityPhoneNumber,
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
    "IdentityMailbox",
    "IdentityPhoneNumber",
    # Signing key + webhook verification
    "SigningKey",
    "verify_webhook",
]

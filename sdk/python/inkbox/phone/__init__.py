"""
inkbox.phone — phone types and exceptions.
"""

from inkbox.phone.exceptions import InkboxAPIError, InkboxError
from inkbox.phone.types import (
    CallMode,
    CallOrigin,
    HostedAgentConfig,
    IncomingCallAction,
    IncomingCallActionConfig,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneNumber,
    PhoneTranscript,
    PostCallAction,
    RateLimitInfo,
    SmsOptIn,
    SmsOptInSource,
    SmsOptInStatus,
    TextConversationSummary,
    TextConversationUpdateResult,
    TextMediaItem,
    TextMessage,
    TextMessageRecipient,
)
from inkbox.signing_keys import SigningKey

__all__ = [
    "InkboxError",
    "InkboxAPIError",
    "CallMode",
    "CallOrigin",
    "HostedAgentConfig",
    "IncomingCallAction",
    "IncomingCallActionConfig",
    "PhoneCall",
    "PhoneCallWithRateLimit",
    "PhoneNumber",
    "PhoneTranscript",
    "PostCallAction",
    "RateLimitInfo",
    "SigningKey",
    "SmsOptIn",
    "SmsOptInSource",
    "SmsOptInStatus",
    "TextConversationSummary",
    "TextConversationUpdateResult",
    "TextMediaItem",
    "TextMessage",
    "TextMessageRecipient",
]

"""
inkbox.phone — phone types and exceptions.
"""

from inkbox.phone.exceptions import InkboxAPIError, InkboxError
from inkbox.phone.types import (
    CallMode,
    CallOrigin,
    HostedAgentAuthorityMode,
    HostedAgentConfig,
    IncomingCallAction,
    IncomingCallActionConfig,
    PhoneCall,
    PhoneCallWithRateLimit,
    PhoneNumber,
    PhoneTranscript,
    PostCallActionItem,
    RateLimitInfo,
    SmsOptIn,
    SmsOptInSource,
    SmsOptInStatus,
    TextConversationSummary,
    TextConversationUpdateResult,
    TextMediaItem,
    TextMessage,
    TextMessageRecipient,
    VoicemailDetection,
)
from inkbox.signing_keys import SigningKey

__all__ = [
    "InkboxError",
    "InkboxAPIError",
    "CallMode",
    "CallOrigin",
    "HostedAgentAuthorityMode",
    "HostedAgentConfig",
    "IncomingCallAction",
    "IncomingCallActionConfig",
    "PhoneCall",
    "PhoneCallWithRateLimit",
    "PhoneNumber",
    "PhoneTranscript",
    "PostCallActionItem",
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
    "VoicemailDetection",
]

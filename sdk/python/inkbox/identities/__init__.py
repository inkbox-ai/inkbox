"""
inkbox.identities — identity types.
"""

from inkbox.identities.types import (
    AgentIdentitySummary,
    _AgentIdentityData,
    IdentityMailbox,
    IdentityIMessageNumber,
    IdentityPhoneNumber,
)

__all__ = [
    "AgentIdentitySummary",
    "_AgentIdentityData",
    "IdentityMailbox",
    "IdentityIMessageNumber",
    "IdentityPhoneNumber",
]

from inkbox.identities.hosting import HostingConfiguration, HostingUpdate, HostingDelivery, HostingHarness, HostingModel
__all__ += ["HostingConfiguration", "HostingUpdate", "HostingDelivery", "HostingHarness", "HostingModel"]

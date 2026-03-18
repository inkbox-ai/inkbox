"""
inkbox.authenticator — authenticator types and exceptions.
"""

from inkbox.authenticator.exceptions import InkboxAPIError, InkboxError
from inkbox.authenticator.types import (
    AuthenticatorAccount,
    AuthenticatorApp,
    OTPCode,
)

__all__ = [
    "InkboxError",
    "InkboxAPIError",
    "AuthenticatorApp",
    "AuthenticatorAccount",
    "OTPCode",
]

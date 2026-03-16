"""
inkbox.mail — mail types and exceptions.
"""

from inkbox.mail.exceptions import InkboxAPIError, InkboxError
from inkbox.mail.types import (
    Mailbox,
    Message,
    MessageDetail,
    Thread,
    ThreadDetail,
)
from inkbox.signing_keys import SigningKey

__all__ = [
    "InkboxError",
    "InkboxAPIError",
    "Mailbox",
    "Message",
    "MessageDetail",
    "SigningKey",
    "Thread",
    "ThreadDetail",
]

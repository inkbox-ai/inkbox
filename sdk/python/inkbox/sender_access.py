"""Admission of a specific inbound message, not sender trust or command permission."""

from typing import Literal

SenderAccess = Literal["direct", "sponsored"]

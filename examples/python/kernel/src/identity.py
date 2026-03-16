"""
kernel/src/identity.py

Creates a fresh Inkbox agent identity with email.
"""

from __future__ import annotations

import uuid

from inkbox import Inkbox
from inkbox.agent_identity import AgentIdentity


def create_agent_identity(client: Inkbox) -> AgentIdentity:
    """
    Create a fresh agent identity with a mailbox.

    Args:
        client: Authenticated Inkbox client.

    Returns:
        The newly created AgentIdentity with a mailbox attached.
    """
    handle = f"agent-{uuid.uuid4().hex[:8]}"
    identity = client.create_identity(handle)

    identity.create_mailbox(display_name="inkbox-kernel Agent")
    return identity

"""
inkbox_kernel/identity.py

Creates a fresh Inkbox agent identity with email and optional phone.
"""

from __future__ import annotations

import uuid

from inkbox import Inkbox
from inkbox.agent_identity import AgentIdentity


def create_agent_identity(
    client: Inkbox,
    *,
    with_phone: bool = False,
) -> AgentIdentity:
    """
    Create a fresh agent identity with a mailbox and optional phone number.

    Args:
        client: Authenticated Inkbox client.
        with_phone: If True, provision a toll-free phone number.

    Returns:
        The newly created AgentIdentity with channels attached.
    """
    handle = f"agent-{uuid.uuid4().hex[:8]}"
    identity = client.create_identity(handle)

    identity.create_mailbox(display_name="inkbox-kernel Agent")
    if with_phone:
        identity.provision_phone_number(type="toll_free")
    return identity

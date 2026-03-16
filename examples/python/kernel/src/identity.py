"""
kernel/src/identity.py

Identity selection and creation for the agent CLI.
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


def select_or_create_identity(client: Inkbox) -> tuple[AgentIdentity, bool]:
    """
    Interactive selector: pick an existing identity or create a new one.

    Returns:
        (identity, is_new) — is_new is True if a fresh identity was created.
    """
    summaries = client.list_identities()

    if not summaries:
        print("No existing identities found, creating a new one...")
        return create_agent_identity(client), True

    print("\nAgent identities:")
    for i, s in enumerate(summaries, 1):
        email = getattr(s, "email_address", None) or "no mailbox"
        print(f"  {i}. {s.agent_handle}  ({email})")
    create_idx = len(summaries) + 1
    print(f"  {create_idx}. Create new")

    while True:
        choice = input(f"\nSelect [1-{create_idx}]: ").strip()
        try:
            idx = int(choice)
        except ValueError:
            continue
        if idx == create_idx:
            return create_agent_identity(client), True
        if 1 <= idx <= len(summaries):
            handle = summaries[idx - 1].agent_handle
            identity = client.get_identity(handle)
            if not identity.mailbox:
                print(f"  '{handle}' has no mailbox — creating one...")
                identity.create_mailbox(display_name="inkbox-kernel Agent")
            return identity, False

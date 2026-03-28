"""
kernel/src/identity.py

Identity selection and creation for the agent CLI.
"""

from __future__ import annotations

import logging
import uuid

import questionary
from inkbox import Inkbox
from inkbox.agent_identity import AgentIdentity

logger = logging.getLogger(__name__)


def create_agent_identity(client: Inkbox, handle: str | None = None) -> AgentIdentity:
    """
    Create a fresh agent identity with a mailbox.

    Args:
        client: Authenticated Inkbox client.
        handle: Optional name for the identity. If not provided, a random one is generated.

    Returns:
        The newly created AgentIdentity with a mailbox attached.
    """
    if not handle:
        handle = f"agent-{uuid.uuid4().hex[:8]}"
    identity = client.create_identity(handle, display_name="inkbox-kernel Agent")
    return identity


def select_or_create_identity(client: Inkbox) -> tuple[AgentIdentity, bool]:
    """
    Interactive selector: pick an existing identity or create a new one.

    Returns:
        (identity, is_new) — is_new is True if a fresh identity was created.
    """
    CREATE_NEW = "Create new"

    summaries = client.list_identities()

    if not summaries:
        logger.info("No existing identities found, creating a new one...")
        name = questionary.text("Agent name (leave blank for random):").ask()
        return create_agent_identity(client, handle=name or None), True

    choices = []
    for s in summaries:
        # summary doesn't include mailbox info — fetch full identity to check
        try:
            full = client.get_identity(s.agent_handle)
            email = full.mailbox.email_address if full.mailbox else "no mailbox"
        except Exception:
            email = "unknown"
        choices.append(f"{s.agent_handle}  ({email})")
    choices.append(CREATE_NEW)

    picked = questionary.select("Select an identity:", choices=choices).ask()
    if picked is None:  # user hit Ctrl-C
        raise SystemExit(0)

    if picked == CREATE_NEW:
        name = questionary.text("Agent name (leave blank for random):").ask()
        return create_agent_identity(client, handle=name or None), True

    # map selection back to the summary
    idx = choices.index(picked)
    handle = summaries[idx].agent_handle
    identity = client.get_identity(handle)
    return identity, False

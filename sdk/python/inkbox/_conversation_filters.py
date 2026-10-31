"""Optional participant selectors shared by conversation list methods."""

from uuid import UUID


def conversation_filter_params(
    participants: list[str] | None, contact_id: UUID | str | None,
) -> dict[str, str | list[str]]:
    """Encode an exclusive selector without silently dropping an empty list."""
    if participants is not None and contact_id is not None:
        raise ValueError("participants and contact_id are mutually exclusive")
    if participants is not None:
        if not isinstance(participants, list) or not 1 <= len(participants) <= 100:
            raise ValueError("participants must contain between 1 and 100 addresses")
        return {"participants": participants.copy()}
    return {"contact_id": str(contact_id)} if contact_id is not None else {}

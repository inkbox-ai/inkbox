"""Inkbox serve-side A2A inbox resource."""

from __future__ import annotations

from typing import Any, Iterator

from inkbox._http import HttpTransport
from inkbox.a2a.types import (
    A2AContactRule,
    A2AContext,
    A2AContextPage,
    A2AReplyIntent,
    A2ARuleAction,
    A2ARuleDirection,
    A2ASettings,
    A2ASkill,
    A2ATask,
    A2ATaskPage,
    A2ATaskState,
    parse_context,
    parse_datetime,
    parse_skill,
    parse_task,
)


class A2AResource:
    """Internal transport wrapper used by :class:`AgentIdentity`."""

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    @staticmethod
    def _base(handle: str) -> str:
        return f"/identities/{handle}/a2a"

    def settings(self, handle: str) -> A2ASettings:
        data = self._http.get(f"{self._base(handle)}/settings")
        return A2ASettings(
            enabled=data["enabled"],
            filter_mode=data["filter_mode"],
            skills=(
                [parse_skill(item) for item in data["skills"]]
                if data.get("skills") is not None
                else None
            ),
            card_url=data["card_url"],
            updated_at=parse_datetime(data.get("updated_at")),
        )

    def update_settings(self, handle: str, **changes: Any) -> A2ASettings:
        data = self._http.put(f"{self._base(handle)}/settings", json=changes)
        return A2ASettings(
            enabled=data["enabled"],
            filter_mode=data["filter_mode"],
            skills=(
                [parse_skill(item) for item in data["skills"]]
                if data.get("skills") is not None
                else None
            ),
            card_url=data["card_url"],
            updated_at=parse_datetime(data.get("updated_at")),
        )

    def card(self, handle: str) -> dict[str, Any]:
        return self._http.get(f"{self._base(handle)}/card")

    def tasks(
        self,
        handle: str,
        *,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2ATaskPage:
        data = self._http.get(
            f"{self._base(handle)}/tasks",
            params={
                "state": state.value if isinstance(state, A2ATaskState) else state,
                "context_id": context_id,
                "cursor": cursor,
                "limit": limit,
            },
        )
        return A2ATaskPage(
            items=[parse_task(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def iter_tasks(
        self,
        handle: str,
        *,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        limit: int = 50,
    ) -> Iterator[A2ATask]:
        cursor = None
        while True:
            page = self.tasks(
                handle,
                state=state,
                context_id=context_id,
                cursor=cursor,
                limit=limit,
            )
            yield from page.items
            if not page.next_cursor:
                return
            cursor = page.next_cursor

    def task(self, handle: str, task_id: str) -> A2ATask:
        return parse_task(self._http.get(f"{self._base(handle)}/tasks/{task_id}"))

    def reply(
        self,
        handle: str,
        task_id: str,
        *,
        intent: A2AReplyIntent | str,
        text: str | None = None,
        parts: list[dict[str, Any]] | None = None,
    ) -> A2ATask:
        if (text is None) == (parts is None):
            raise ValueError("Pass exactly one of text or parts")
        reply_parts = [{"text": text}] if text is not None else parts
        data = self._http.post(
            f"{self._base(handle)}/tasks/{task_id}/reply",
            json={
                "intent": intent.value if isinstance(intent, A2AReplyIntent) else intent,
                "parts": reply_parts,
            },
        )
        return parse_task(data)

    def contexts(
        self,
        handle: str,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2AContextPage:
        data = self._http.get(
            f"{self._base(handle)}/contexts",
            params={"cursor": cursor, "limit": limit},
        )
        return A2AContextPage(
            items=[parse_context(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def context(self, handle: str, context_id: str) -> A2AContext:
        return parse_context(
            self._http.get(f"{self._base(handle)}/contexts/{context_id}")
        )

    def contact_rules(self, handle: str) -> list[A2AContactRule]:
        return [
            self._parse_rule(item)
            for item in self._http.get(f"{self._base(handle)}/contact-rules")
        ]

    def add_contact_rule(
        self,
        handle: str,
        *,
        peer_handle: str,
        action: A2ARuleAction | str,
        direction: A2ARuleDirection | str = A2ARuleDirection.INBOUND,
    ) -> A2AContactRule:
        data = self._http.post(
            f"{self._base(handle)}/contact-rules",
            json={
                "action": action.value if isinstance(action, A2ARuleAction) else action,
                "match_type": "handle",
                "match_target": peer_handle,
                "direction": (
                    direction.value
                    if isinstance(direction, A2ARuleDirection)
                    else direction
                ),
            },
        )
        return self._parse_rule(data)

    @staticmethod
    def _parse_rule(data: dict[str, Any]) -> A2AContactRule:
        return A2AContactRule(
            id=data["id"],
            action=A2ARuleAction(data["action"]),
            match_type=data["match_type"],
            match_target=data["match_target"],
            direction=A2ARuleDirection(data["direction"]),
            status=data["status"],
            created_at=parse_datetime(data["created_at"]),  # type: ignore[arg-type]
            updated_at=parse_datetime(data["updated_at"]),  # type: ignore[arg-type]
        )


def skills_wire(skills: list[A2ASkill]) -> list[dict[str, Any]]:
    return [skill.to_wire() for skill in skills]

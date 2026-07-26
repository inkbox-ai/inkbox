"""Inkbox serve-side A2A inbox resource."""

from __future__ import annotations

from typing import Any, Iterator

from inkbox._http import HttpTransport
from inkbox.a2a.types import (
    A2AContactRule,
    A2AContext,
    A2AContextPage,
    A2AHistoryDirection,
    A2AHistoryMessage,
    A2AHistoryMessagePage,
    A2AMessageRole,
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
    parse_history_message,
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

    @staticmethod
    def _rule_direction(
        direction: A2ARuleDirection | str,
    ) -> str:
        value = (
            direction.value
            if isinstance(direction, A2ARuleDirection)
            else direction
        )
        if value not in {"inbound", "outbound", "both"}:
            raise ValueError(
                "A2A rule direction must be 'inbound', 'outbound', or 'both'"
            )
        return value

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
            inbound_task_count=data.get("inbound_task_count", 0),
            outbound_task_count=data.get("outbound_task_count", 0),
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
            inbound_task_count=data.get("inbound_task_count", 0),
            outbound_task_count=data.get("outbound_task_count", 0),
            updated_at=parse_datetime(data.get("updated_at")),
        )

    def card(self, handle: str) -> dict[str, Any]:
        return self._http.get(f"{self._base(handle)}/card")

    def tasks(
        self,
        handle: str,
        *,
        direction: A2AHistoryDirection | str | None = None,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        q: str | None = None,
        since: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2ATaskPage:
        data = self._http.get(
            f"{self._base(handle)}/tasks",
            params={
                "direction": (
                    direction.value
                    if isinstance(direction, A2AHistoryDirection)
                    else direction
                ),
                "requester_handle": requester_handle,
                "worker_handle": worker_handle,
                "state": state.value if isinstance(state, A2ATaskState) else state,
                "context_id": context_id,
                "q": q,
                "since": since,
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
        direction: A2AHistoryDirection | str | None = None,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        q: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> Iterator[A2ATask]:
        cursor = None
        while True:
            page = self.tasks(
                handle,
                direction=direction,
                requester_handle=requester_handle,
                worker_handle=worker_handle,
                state=state,
                context_id=context_id,
                q=q,
                since=since,
                cursor=cursor,
                limit=limit,
            )
            yield from page.items
            if not page.next_cursor:
                return
            cursor = page.next_cursor

    def task(self, handle: str, task_id: str) -> A2ATask:
        return parse_task(self._http.get(f"{self._base(handle)}/tasks/{task_id}"))

    def sent_tasks(
        self,
        handle: str,
        *,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        q: str | None = None,
        since: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2ATaskPage:
        data = self._http.get(
            f"{self._base(handle)}/sent/tasks",
            params={
                "requester_handle": requester_handle,
                "worker_handle": worker_handle,
                "state": state.value if isinstance(state, A2ATaskState) else state,
                "context_id": context_id,
                "q": q,
                "since": since,
                "cursor": cursor,
                "limit": limit,
            },
        )
        return A2ATaskPage(
            items=[parse_task(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def iter_sent_tasks(
        self,
        handle: str,
        *,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        state: A2ATaskState | str | None = None,
        context_id: str | None = None,
        q: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> Iterator[A2ATask]:
        cursor = None
        while True:
            page = self.sent_tasks(
                handle,
                requester_handle=requester_handle,
                worker_handle=worker_handle,
                state=state,
                context_id=context_id,
                q=q,
                since=since,
                cursor=cursor,
                limit=limit,
            )
            yield from page.items
            if not page.next_cursor:
                return
            cursor = page.next_cursor

    def sent_task(self, handle: str, task_id: str) -> A2ATask:
        return parse_task(
            self._http.get(f"{self._base(handle)}/sent/tasks/{task_id}")
        )

    def messages(
        self,
        handle: str,
        *,
        direction: A2AHistoryDirection | str | None = None,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        task_id: str | None = None,
        context_id: str | None = None,
        role: A2AMessageRole | str | None = None,
        q: str | None = None,
        since: str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2AHistoryMessagePage:
        data = self._http.get(
            f"{self._base(handle)}/messages",
            params={
                "direction": (
                    direction.value
                    if isinstance(direction, A2AHistoryDirection)
                    else direction
                ),
                "requester_handle": requester_handle,
                "worker_handle": worker_handle,
                "task_id": task_id,
                "context_id": context_id,
                "role": role.value if isinstance(role, A2AMessageRole) else role,
                "q": q,
                "since": since,
                "cursor": cursor,
                "limit": limit,
            },
        )
        return A2AHistoryMessagePage(
            items=[parse_history_message(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def iter_messages(
        self,
        handle: str,
        *,
        direction: A2AHistoryDirection | str | None = None,
        requester_handle: str | None = None,
        worker_handle: str | None = None,
        task_id: str | None = None,
        context_id: str | None = None,
        role: A2AMessageRole | str | None = None,
        q: str | None = None,
        since: str | None = None,
        limit: int = 50,
    ) -> Iterator[A2AHistoryMessage]:
        cursor = None
        while True:
            page = self.messages(
                handle,
                direction=direction,
                requester_handle=requester_handle,
                worker_handle=worker_handle,
                task_id=task_id,
                context_id=context_id,
                role=role,
                q=q,
                since=since,
                cursor=cursor,
                limit=limit,
            )
            yield from page.items
            if not page.next_cursor:
                return
            cursor = page.next_cursor

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
        direction: A2AHistoryDirection | str | None = None,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2AContextPage:
        data = self._http.get(
            f"{self._base(handle)}/contexts",
            params={
                "direction": (
                    direction.value
                    if isinstance(direction, A2AHistoryDirection)
                    else direction
                ),
                "cursor": cursor,
                "limit": limit,
            },
        )
        return A2AContextPage(
            items=[parse_context(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def context(self, handle: str, context_id: str) -> A2AContext:
        return parse_context(
            self._http.get(f"{self._base(handle)}/contexts/{context_id}")
        )

    def sent_contexts(
        self,
        handle: str,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> A2AContextPage:
        data = self._http.get(
            f"{self._base(handle)}/sent/contexts",
            params={"cursor": cursor, "limit": limit},
        )
        return A2AContextPage(
            items=[parse_context(item) for item in data["items"]],
            next_cursor=data.get("next_cursor"),
        )

    def sent_context(self, handle: str, context_id: str) -> A2AContext:
        return parse_context(
            self._http.get(
                f"{self._base(handle)}/sent/contexts/{context_id}"
            )
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
                "direction": self._rule_direction(direction),
            },
        )
        return self._parse_rule(data)

    def update_contact_rule(
        self,
        handle: str,
        rule_id: str,
        *,
        action: A2ARuleAction | str | None = None,
        direction: A2ARuleDirection | str | None = None,
    ) -> A2AContactRule:
        body: dict[str, str] = {}
        if action is not None:
            body["action"] = (
                action.value if isinstance(action, A2ARuleAction) else action
            )
        if direction is not None:
            body["direction"] = self._rule_direction(direction)
        if not body:
            raise ValueError("Pass at least one of action or direction")
        data = self._http.patch(
            f"{self._base(handle)}/contact-rules/{rule_id}",
            json=body,
        )
        return self._parse_rule(data)

    def delete_contact_rule(self, handle: str, rule_id: str) -> None:
        self._http.delete(f"{self._base(handle)}/contact-rules/{rule_id}")

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

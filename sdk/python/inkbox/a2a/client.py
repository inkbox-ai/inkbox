"""Stateless A2A 1.0 client with strict credential-origin pinning."""

from __future__ import annotations

import time
import uuid
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from inkbox.a2a.types import (
    A2ACard,
    A2AResolvedTarget,
    A2ASendResult,
    A2AWireMessage,
    A2AWireTask,
    A2AWireTaskPage,
    A2AWireTaskState,
)
from inkbox.exceptions import InkboxError


class A2AProtocolError(InkboxError):
    """A standard A2A JSON-RPC error returned by the remote agent."""

    def __init__(self, code: int, message: str, data: Any = None) -> None:
        super().__init__(f"A2A error {code}: {message}")
        self.code = code
        self.data = data


def _canonical_url(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.username or parsed.password or parsed.fragment:
        raise ValueError("A2A URLs cannot contain credentials or fragments")
    local = parsed.hostname in {"localhost", "127.0.0.1"}
    if parsed.scheme != "https" and not (parsed.scheme == "http" and local):
        raise ValueError("A2A URLs must use HTTPS")
    if not parsed.hostname:
        raise ValueError("A2A URL must include a host")
    host = parsed.hostname.lower()
    port = parsed.port
    default_port = 443 if parsed.scheme == "https" else 80
    netloc = host if port in {None, default_port} else f"{host}:{port}"
    path = parsed.path or "/"
    return urlunsplit((parsed.scheme.lower(), netloc, path, parsed.query, ""))


def _origin(value: str) -> str:
    parsed = urlsplit(_canonical_url(value))
    return f"{parsed.scheme}://{parsed.netloc}"


class A2AClient:
    """Call standard A2A 1.0 agents without storing remote task state."""

    def __init__(
        self,
        *,
        api_key: str,
        platform_base_url: str,
        timeout: float = 30.0,
    ) -> None:
        self._api_key = api_key
        self._platform_origin = _origin(platform_base_url)
        self._client = httpx.Client(timeout=timeout, follow_redirects=False)
        self._next_id = 0

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> A2AClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    def fetch_card(
        self,
        card_url: str,
        *,
        credential: str | None = None,
    ) -> A2AResolvedTarget:
        canonical_card_url = _canonical_url(card_url)
        response = self._client.get(canonical_card_url)
        if 300 <= response.status_code < 400:
            raise InkboxError("A2A Agent Card redirects are refused")
        response.raise_for_status()
        card_data = response.json()
        interfaces = card_data.get("supportedInterfaces", [])
        selected = next(
            (
                item
                for item in interfaces
                if item.get("protocolVersion") == "1.0"
                and str(item.get("protocolBinding", "")).upper() == "JSONRPC"
            ),
            None,
        )
        if selected is None:
            raise ValueError("Agent Card does not advertise A2A 1.0 JSON-RPC")
        rpc_url = _canonical_url(selected["url"])
        card_origin = _origin(canonical_card_url)
        rpc_origin = _origin(rpc_url)
        if credential is not None and rpc_origin != card_origin:
            raise ValueError(
                "External A2A credentials require matching card and RPC origins"
            )
        pinned_credential = credential
        if card_origin == self._platform_origin:
            if rpc_origin != self._platform_origin:
                raise ValueError("Inkbox Agent Card points to a non-Inkbox RPC origin")
            pinned_credential = self._api_key
        return A2AResolvedTarget(
            card_url=canonical_card_url,
            rpc_url=rpc_url,
            protocol_version="1.0",
            card=A2ACard(card_data),
            credential=pinned_credential,
        )

    def send(
        self,
        target: A2AResolvedTarget,
        *,
        text: str | None = None,
        parts: list[dict[str, Any]] | None = None,
        message_id: str | None = None,
        context_id: str | None = None,
        task_id: str | None = None,
    ) -> A2ASendResult:
        if (text is None) == (parts is None):
            raise ValueError("Pass exactly one of text or parts")
        message: dict[str, Any] = {
            "messageId": message_id or str(uuid.uuid4()),
            "role": "ROLE_USER",
            "parts": [{"text": text}] if text is not None else parts,
        }
        if context_id:
            message["contextId"] = context_id
        if task_id:
            message["taskId"] = task_id
        result = self._rpc(
            target,
            "SendMessage",
            {
                "message": message,
                "configuration": {"returnImmediately": True},
            },
        )
        if "status" in result and "id" in result:
            return A2ASendResult(kind="task", task=A2AWireTask(result))
        return A2ASendResult(kind="message", message=A2AWireMessage(result))

    def get_task(
        self,
        target: A2AResolvedTarget,
        task_id: str,
        *,
        history_length: int | None = None,
    ) -> A2AWireTask:
        params: dict[str, Any] = {"id": task_id}
        if history_length is not None:
            params["historyLength"] = history_length
        return A2AWireTask(self._rpc(target, "GetTask", params))

    def list_tasks(
        self,
        target: A2AResolvedTarget,
        *,
        context_id: str | None = None,
        status: A2AWireTaskState | str | None = None,
        cursor: str | None = None,
        page_size: int = 50,
        history_length: int | None = None,
    ) -> A2AWireTaskPage:
        params: dict[str, Any] = {"pageSize": page_size}
        if context_id:
            params["contextId"] = context_id
        if status:
            params["status"] = status.value if isinstance(status, A2AWireTaskState) else status
        if cursor:
            params["pageToken"] = cursor
        if history_length is not None:
            params["historyLength"] = history_length
        data = self._rpc(target, "ListTasks", params)
        return A2AWireTaskPage(
            tasks=[A2AWireTask(item) for item in data.get("tasks", [])],
            next_page_token=data.get("nextPageToken") or None,
            page_size=int(data.get("pageSize", page_size)),
            total_size=int(data.get("totalSize", 0)),
        )

    def cancel(self, target: A2AResolvedTarget, task_id: str) -> A2AWireTask:
        return A2AWireTask(self._rpc(target, "CancelTask", {"id": task_id}))

    def wait(
        self,
        target: A2AResolvedTarget,
        task_id: str,
        *,
        timeout: float = 120.0,
        interval: float = 5.0,
    ) -> A2AWireTask:
        deadline = time.monotonic() + timeout
        while True:
            task = self.get_task(target, task_id)
            if task.state in {
                A2AWireTaskState.COMPLETED,
                A2AWireTaskState.FAILED,
                A2AWireTaskState.CANCELED,
                A2AWireTaskState.REJECTED,
                A2AWireTaskState.INPUT_REQUIRED,
                A2AWireTaskState.AUTH_REQUIRED,
            }:
                return task
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError(f"A2A task {task_id} did not stop before timeout")
            time.sleep(min(interval, remaining))

    def _rpc(
        self,
        target: A2AResolvedTarget,
        method: str,
        params: dict[str, Any],
    ) -> dict[str, Any]:
        if _canonical_url(target.rpc_url) != target.rpc_url:
            raise ValueError("A2A target RPC URL is not canonical")
        self._next_id += 1
        headers = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "A2A-Version": "1.0",
        }
        if target.credential:
            headers["X-API-Key"] = target.credential
        response = self._client.post(
            target.rpc_url,
            headers=headers,
            json={
                "jsonrpc": "2.0",
                "id": self._next_id,
                "method": method,
                "params": params,
            },
        )
        if 300 <= response.status_code < 400:
            raise InkboxError("A2A RPC redirects are refused")
        response.raise_for_status()
        payload = response.json()
        if "error" in payload:
            error = payload["error"]
            raise A2AProtocolError(
                int(error.get("code", -32603)),
                str(error.get("message", "Unknown A2A error")),
                error.get("data"),
            )
        return payload["result"]

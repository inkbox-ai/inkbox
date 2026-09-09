"""
inkbox/async_client.py

AsyncInkbox — async entry point for agent runtimes (FastAPI, tunnels, asyncio).

ponytail: REST I/O still runs on the sync ``Inkbox`` / ``httpx.Client`` via
``asyncio.to_thread``. That unblocks ``await`` call sites without cloning every
resource into async form. Upgrade path: ``AsyncHttpTransport`` (httpx.AsyncClient)
plus async resource methods, then drop the thread hop.
"""

from __future__ import annotations

import asyncio
import collections.abc
import functools
from typing import Any

from inkbox.agent_identity import AgentIdentity
from inkbox.client import Inkbox
from inkbox.credentials import Credentials

# Objects whose public methods hit the network (or wrap ones that do).
_PROXY_TYPES = (
    AgentIdentity,
    Credentials,
    Inkbox,
)


def _should_proxy(obj: Any) -> bool:
    if isinstance(obj, _PROXY_TYPES):
        return True
    cls = type(obj)
    if not cls.__module__.startswith("inkbox."):
        return False
    name = cls.__name__
    return (
        name.endswith("Resource")
        or name.endswith("Namespace")
        or name == "A2AClient"
        or name == "UnlockedVault"
    )


def _exhaust_if_iterator(result: Any) -> Any:
    # Sync helpers like ``iter_emails`` return lazy iterators that page over
    # HTTP. Drain them inside the worker thread so the event loop never blocks
    # on a subsequent ``next()``.
    if isinstance(result, collections.abc.Iterator) and not isinstance(
        result, (list, tuple, str, bytes, dict, type(None))
    ):
        return list(result)
    return result


def _wrap(obj: Any) -> Any:
    if isinstance(obj, AgentIdentity):
        return AsyncAgentIdentity(obj)
    if isinstance(obj, Inkbox):
        return AsyncInkbox.from_sync(obj)
    if _should_proxy(obj):
        return AsyncProxy(obj)
    return obj


def _as_async(fn: Any) -> Any:
    @functools.wraps(fn)
    async def wrapper(*args: Any, **kwargs: Any) -> Any:
        def run() -> Any:
            return _exhaust_if_iterator(fn(*args, **kwargs))

        return _wrap(await asyncio.to_thread(run))

    return wrapper


class AsyncProxy:
    """Awaitable view of a sync SDK object (resources, credentials, …)."""

    __slots__ = ("_target",)

    def __init__(self, target: Any) -> None:
        object.__setattr__(self, "_target", target)

    def __repr__(self) -> str:
        return f"AsyncProxy({self._target!r})"

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._target, name)
        if callable(attr):
            return _as_async(attr)
        return _wrap(attr)


class AsyncAgentIdentity:
    """Awaitable :class:`~inkbox.agent_identity.AgentIdentity`."""

    __slots__ = ("_identity",)

    def __init__(self, identity: AgentIdentity) -> None:
        object.__setattr__(self, "_identity", identity)

    @property
    def sync(self) -> AgentIdentity:
        """Underlying sync identity (escape hatch)."""
        return self._identity

    def __repr__(self) -> str:
        return f"AsyncAgentIdentity({self._identity!r})"

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._identity, name)
        if callable(attr):
            return _as_async(attr)
        return _wrap(attr)


class AsyncInkbox:
    """
    Async org-level entry point for all Inkbox APIs.

    Same constructor kwargs as :class:`~inkbox.client.Inkbox`. Use from async
    agents and ASGI handlers::

        async with AsyncInkbox(api_key="ApiKey_...") as inkbox:
            identity = await inkbox.create_identity("support-bot")
            await identity.send_email(
                to=["customer@example.com"],
                subject="Hello!",
                body_text="Hi there",
            )
    """

    __slots__ = ("_sync",)

    def __init__(
        self,
        api_key: str | None = None,
        *,
        base_url: str | None = None,
        timeout: float = 30.0,
        vault_key: str | None = None,
        user_agent_prefix: str | None = None,
    ) -> None:
        object.__setattr__(
            self,
            "_sync",
            Inkbox(
                api_key,
                base_url=base_url,
                timeout=timeout,
                vault_key=vault_key,
                user_agent_prefix=user_agent_prefix,
            ),
        )

    @classmethod
    def from_sync(cls, inkbox: Inkbox) -> AsyncInkbox:
        """Wrap an existing sync client (does not take ownership unless closed)."""
        self = object.__new__(cls)
        object.__setattr__(self, "_sync", inkbox)
        return self

    @property
    def sync(self) -> Inkbox:
        """Underlying sync client (escape hatch)."""
        return self._sync

    async def __aenter__(self) -> AsyncInkbox:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Close all underlying HTTP connection pools."""
        await asyncio.to_thread(self._sync.close)

    def __repr__(self) -> str:
        return f"AsyncInkbox({self._sync!r})"

    def __getattr__(self, name: str) -> Any:
        attr = getattr(self._sync, name)
        if callable(attr):
            return _as_async(attr)
        return _wrap(attr)

    # Classmethods on Inkbox are not visible via instance __getattr__.
    @classmethod
    async def preview_a2a_invitation(cls, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(Inkbox.preview_a2a_invitation, *args, **kwargs)

    @classmethod
    async def signup(cls, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(Inkbox.signup, *args, **kwargs)

    @classmethod
    async def verify_signup(cls, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(Inkbox.verify_signup, *args, **kwargs)

    @classmethod
    async def resend_signup_verification(cls, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(
            Inkbox.resend_signup_verification, *args, **kwargs
        )

    @classmethod
    async def get_signup_status(cls, *args: Any, **kwargs: Any) -> Any:
        return await asyncio.to_thread(Inkbox.get_signup_status, *args, **kwargs)

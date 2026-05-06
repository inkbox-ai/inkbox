"""
inkbox/tunnels/client/_listener.py

The public ``TunnelListener`` returned by ``inkbox.tunnels.connect(...)``,
plus the connect entry-point itself.

Sync API (``wait()`` / ``close()``) runs the runtime in a background
non-daemon thread with its own event loop. Async API
(``serve_forever()`` / ``aclose()``) is for callers already in an event
loop. The two APIs are mutually exclusive — pick one.
"""

from __future__ import annotations

import asyncio
import logging
import signal
import sys
import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any

from inkbox.tunnels.client._bootstrap import (
    TunnelBundle,
    bootstrap,
    validate_pool_size,
)
from inkbox.tunnels.client._runtime import (
    DEFAULT_INBOUND_BODY_BYTES,
    DEFAULT_OUTBOUND_BODY_BYTES,
    StatusCallback,
    TunnelRuntime,
)
from inkbox.tunnels.client._url_forward import validate_forward_target
from inkbox.tunnels.types import TLSMode, Tunnel

if TYPE_CHECKING:
    from inkbox.client import Inkbox


logger = logging.getLogger("inkbox.tunnels")


def _check_posix() -> None:
    if sys.platform.startswith("win"):
        raise NotImplementedError(
            "inkbox.tunnels.connect requires a POSIX platform; CRUD "
            "operations are supported on Windows",
        )


class TunnelListener:
    """A live tunnel.

    Returned by :meth:`inkbox.tunnels.connect`. Use :meth:`wait` for sync
    callers (blocks until ``close()`` or ``KeyboardInterrupt``) or
    :meth:`serve_forever` / :meth:`aclose` if you're already inside an
    event loop. Don't mix the two pairs.

    Attributes:
        public_url: ``https://{public_host}``.
        tunnel: A snapshot of the :class:`Tunnel` resource record taken
            at bootstrap. Not refreshed; call ``inkbox.tunnels.get(id)``
            for live state.
    """

    def __init__(
        self,
        *,
        bundle: TunnelBundle,
        runtime: TunnelRuntime,
    ) -> None:
        self._bundle = bundle
        self._runtime = runtime
        self._thread: threading.Thread | None = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._stopped = threading.Event()
        self._serve_task: asyncio.Task[Any] | None = None
        # Captured exception from the background runner; re-raised by
        # ``wait()`` after the runtime exits so a permanent auth failure
        # (or any other fatal) doesn't return a clean ``None``.
        self._runtime_error: BaseException | None = None

    # --- public surface -----------------------------------------------------

    @property
    def public_url(self) -> str:
        return f"https://{self._bundle.public_host}"

    @property
    def tunnel(self) -> Tunnel:
        return self._bundle.tunnel

    # --- sync API -----------------------------------------------------------

    def wait(self) -> None:
        """Block until shutdown.

        Catches ``KeyboardInterrupt``: drives a clean shutdown via
        :meth:`close`, then re-raises so callers can layer their own
        cleanup. Also installs a SIGTERM handler when invoked on the
        main thread.
        """
        self._start_thread_if_needed()
        sigterm_handler_installed = False
        original_sigterm = None
        if threading.current_thread() is threading.main_thread():
            try:
                original_sigterm = signal.signal(signal.SIGTERM, self._signal_handler)
                sigterm_handler_installed = True
            except (ValueError, OSError):
                pass
        try:
            try:
                while not self._stopped.wait(timeout=1.0):
                    pass
            except KeyboardInterrupt:
                self.close()
                raise
        finally:
            if sigterm_handler_installed:
                try:
                    signal.signal(signal.SIGTERM, original_sigterm)
                except (ValueError, OSError):
                    pass
        # The runtime thread captures fatal exceptions (e.g. permanent
        # auth failure from /_system/hello) and stores them here. We
        # surface them after _stopped fires so callers can't mistake a
        # bad-secret crash for a clean shutdown.
        if self._runtime_error is not None:
            err = self._runtime_error
            self._runtime_error = None
            raise err

    def close(self) -> None:
        """Sync graceful shutdown."""
        loop = self._loop
        if loop is not None and not loop.is_closed():
            loop.call_soon_threadsafe(self._schedule_async_close)
        if self._thread is not None:
            self._thread.join(timeout=30.0)

    # --- async API ----------------------------------------------------------

    async def serve_forever(self) -> None:
        """Async equivalent of running the runtime to completion.

        The caller should ``await`` this from their own event loop and
        call :meth:`aclose` to shut down.
        """
        if self._thread is not None:
            raise RuntimeError(
                "serve_forever() and wait() are mutually exclusive; this "
                "listener is already being driven from a sync wait().",
            )
        self._serve_task = asyncio.current_task()
        try:
            await self._runtime.serve_forever()
        finally:
            self._stopped.set()

    async def aclose(self) -> None:
        """Async graceful shutdown."""
        await self._runtime.aclose()
        if self._serve_task is not None and not self._serve_task.done():
            self._serve_task.cancel()
            try:
                await self._serve_task
            except (asyncio.CancelledError, Exception):
                pass

    # --- internals ----------------------------------------------------------

    def _signal_handler(self, signum: int, frame: object) -> None:
        logger.info("received signal %s; shutting down listener", signum)
        self.close()

    def _start_thread_if_needed(self) -> None:
        if self._thread is not None:
            return
        ready = threading.Event()

        def _runner() -> None:
            self._loop = asyncio.new_event_loop()
            asyncio.set_event_loop(self._loop)
            ready.set()
            try:
                self._loop.run_until_complete(self._runtime.serve_forever())
            except asyncio.CancelledError:
                logger.debug("runtime cancelled", exc_info=True)
            except Exception as err:
                # Capture for re-raise from wait(); covers permanent auth
                # failures (TunnelAuthError) and any other fatal that
                # serve_forever propagated rather than retrying.
                self._runtime_error = err
                logger.debug("runtime exited with error", exc_info=True)
            finally:
                try:
                    self._loop.run_until_complete(self._runtime.aclose())
                except Exception:
                    pass
                self._loop.close()
                self._stopped.set()

        self._thread = threading.Thread(
            target=_runner, name="inkbox-tunnel-runtime", daemon=False,
        )
        self._thread.start()
        ready.wait()

    def _schedule_async_close(self) -> None:
        loop = self._loop
        if loop is None:
            return
        async def _do_close() -> None:
            await self._runtime.aclose()
        asyncio.ensure_future(_do_close(), loop=loop)


def connect(
    inkbox: Inkbox,
    *,
    name: str,
    forward_to: str | Any,
    data_plane_zone: str | None = None,
    tls_mode: TLSMode | str = TLSMode.EDGE,
    state_dir: str | Path | None = None,
    description: str | None = None,
    pool_size: int | None = None,
    secret: str | None = None,
    on_status: StatusCallback | None = None,
    on_pending_removal: str = "auto_restore",
    max_inbound_body_bytes: int = DEFAULT_INBOUND_BODY_BYTES,
    max_outbound_body_bytes: int = DEFAULT_OUTBOUND_BODY_BYTES,
    allow_remote_forwarding: bool = False,
    print_secret_to_stderr: bool | None = None,
) -> TunnelListener:
    """Bring a tunnel online from this process.

    Args:
        inkbox: An :class:`Inkbox` SDK client.
        name: The tunnel name (server-side ``tunnel_name``).
        forward_to: Either a URL string (``"http://localhost:8080"``)
            or an in-process app callable matching
            ``async def app(scope, receive, send)``. URL forwarding is
            required for passthrough mode.
        data_plane_zone: Expert-only override for the data-plane h2
            endpoint. Most users should leave this unset.
        tls_mode: ``"edge"`` (default — Inkbox terminates TLS) or
            ``"passthrough"`` (you terminate TLS in this process).
        state_dir: Where ``state.json`` (and passthrough key/cert) live.
            Defaults to ``~/.inkbox/tunnels/{name}``.
        description: Free-form description, recorded server-side at
            create time.
        pool_size: Optional override for the parked-intake pool size
            (1-32). Omit to let the server decide.
        secret: Explicit override for the connect secret. Wins over the
            state file (recovery from ``rotate_secret``).
        on_status: Callback invoked with status strings
            (``"connecting"``, ``"connected"``, ``"reconnecting"``,
            ``"closed"``).
        on_pending_removal: ``"auto_restore"`` (default) or ``"error"``.
        max_inbound_body_bytes: Cap on materialized inbound bodies;
            oversize requests get a 413 to the third party.
        max_outbound_body_bytes: Cap on materialized outbound bodies;
            oversize responses get a 502 to the third party.
        allow_remote_forwarding: Bypass the loopback-only allowlist for
            ``forward_to``. Review the SSRF tradeoff before enabling.
        print_secret_to_stderr: Whether to print the one-shot secret to
            stderr on first create. ``None`` (default) is TTY-gated.
    """
    _check_posix()
    if isinstance(tls_mode, str):
        tls_mode = TLSMode(tls_mode)
    validate_pool_size(pool_size)

    if isinstance(forward_to, str):
        validate_forward_target(
            forward_to, allow_remote_forwarding=allow_remote_forwarding,
        )
    else:
        # In-process app dispatch — passthrough requires URL forwarding.
        if tls_mode == TLSMode.PASSTHROUGH:
            raise ValueError(
                "tls_mode='passthrough' requires forward_to=URL; "
                "in-process app dispatch is edge-only in v1",
            )

    if state_dir is None:
        state_path = Path.home() / ".inkbox" / "tunnels" / name
    else:
        state_path = Path(state_dir)

    bundle = bootstrap(
        inkbox=inkbox,
        name=name,
        tls_mode=tls_mode,
        state_dir=state_path,
        description=description,
        data_plane_zone_override=data_plane_zone,
        explicit_secret=secret,
        on_pending_removal=on_pending_removal,
        print_secret_to_stderr=print_secret_to_stderr,
    )

    runtime = TunnelRuntime(
        tunnel_id=bundle.tunnel.id,
        secret=bundle.secret,
        zone=bundle.zone,
        public_host=bundle.public_host,
        pool_size=pool_size,
        forward_to=forward_to,
        tls_terminator=bundle.tls_terminator,
        max_inbound_body_bytes=max_inbound_body_bytes,
        max_outbound_body_bytes=max_outbound_body_bytes,
        on_status=on_status,
    )
    return TunnelListener(bundle=bundle, runtime=runtime)

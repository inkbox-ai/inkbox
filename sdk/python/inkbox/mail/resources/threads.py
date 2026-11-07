"""
inkbox/mail/resources/threads.py

Thread operations: list (auto-paginated), get with messages, folder
listing, per-thread update, and delete.
"""

from __future__ import annotations

from inkbox._conversation_filters import conversation_filter_params

from typing import TYPE_CHECKING, Any, Iterator
from uuid import UUID

from inkbox.mail.types import Thread, ThreadDetail, ThreadFolder

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_DEFAULT_PAGE_SIZE = 50
_UNSET = object()


class ThreadsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        email_address: str,
        *,
        folder: ThreadFolder | str | None = None,
        page_size: int = _DEFAULT_PAGE_SIZE,
        participants: list[str] | None = None,
        contact_id: UUID | str | None = None,
    ) -> Iterator[Thread]:
        """Iterator over threads in a mailbox, most recent activity first.

        Pagination is handled automatically — just iterate.

        Args:
            participants: Match any email address (1–100 values).
            contact_id: Match all accessible active emails of this contact;
                mutually exclusive with participants.
            email_address: Full email address of the mailbox.
            folder: Optional folder filter (``inbox`` | ``spam`` |
                ``blocked`` | ``archive``). When omitted, the server returns
                all visible folders for the caller.
            page_size: Number of threads fetched per API call (1–100).
        """
        folder_value: str | None
        if folder is None:
            folder_value = None
        elif isinstance(folder, ThreadFolder):
            folder_value = folder.value
        else:
            folder_value = folder
        return self._paginate(email_address, folder=folder_value, page_size=page_size,
                              selectors=conversation_filter_params(participants, contact_id))

    def _paginate(
        self,
        email_address: str,
        *,
        folder: str | None,
        page_size: int,
        selectors: dict[str, str | list[str]],
    ) -> Iterator[Thread]:
        cursor: str | None = None
        while True:
            params: dict[str, Any] = {"limit": page_size, "cursor": cursor, **selectors}
            if folder is not None:
                params["folder"] = folder
            page = self._http.get(
                f"/mailboxes/{email_address}/threads",
                params=params,
            )
            for item in page["items"]:
                yield Thread._from_dict(item)
            if not page["has_more"]:
                break
            cursor = page["next_cursor"]

    def list_folders(self, email_address: str) -> list[ThreadFolder]:
        """Return the distinct folders that have at least one thread.

        Args:
            email_address: Full email address of the mailbox.

        Returns:
            Sorted list of :class:`ThreadFolder` values that currently hold
            at least one non-deleted thread in this mailbox.
        """
        data = self._http.get(f"/mailboxes/{email_address}/threads/folders")
        return [ThreadFolder(f) for f in data]

    def get(self, email_address: str, thread_id: UUID | str) -> ThreadDetail:
        """Get a thread with all its messages inlined.

        Args:
            email_address: Full email address of the owning mailbox.
            thread_id: UUID of the thread.

        Returns:
            Thread detail with all messages (oldest-first).
        """
        data = self._http.get(f"/mailboxes/{email_address}/threads/{thread_id}")
        return ThreadDetail._from_dict(data)

    def update(
        self,
        email_address: str,
        thread_id: UUID | str,
        *,
        folder: ThreadFolder | str = _UNSET,  # type: ignore[assignment]
    ) -> Thread:
        """Update mutable thread fields.

        Returns a bare :class:`Thread` (no inlined messages). Use
        :meth:`get` to refetch the thread with messages attached.

        Args:
            email_address: Full email address of the owning mailbox.
            thread_id: UUID of the thread.
            folder: New folder — ``inbox`` | ``spam`` | ``archive``. The
                ``blocked`` folder is server-assigned and cannot be set by
                clients; passing it raises ``ValueError`` without making an
                HTTP call.
        """
        body: dict[str, Any] = {}
        if folder is not _UNSET:
            folder_value = folder.value if isinstance(folder, ThreadFolder) else folder
            if folder_value == ThreadFolder.BLOCKED.value:
                raise ValueError(
                    "folder='blocked' is server-assigned and cannot be set by "
                    "clients — the server will reject this PATCH.",
                )
            body["folder"] = folder_value
        data = self._http.patch(
            f"/mailboxes/{email_address}/threads/{thread_id}",
            json=body,
        )
        return Thread._from_dict(data)

    def delete(self, email_address: str, thread_id: UUID | str) -> None:
        """Delete a thread."""
        self._http.delete(f"/mailboxes/{email_address}/threads/{thread_id}")

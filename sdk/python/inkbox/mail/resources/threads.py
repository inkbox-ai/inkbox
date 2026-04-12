"""
inkbox/mail/resources/threads.py

Thread operations: list (auto-paginated), get with messages, delete.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Iterator
from uuid import UUID

from inkbox.mail.types import Thread, ThreadDetail

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_DEFAULT_PAGE_SIZE = 50


class ThreadsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        email_address: str,
        *,
        page_size: int = _DEFAULT_PAGE_SIZE,
    ) -> Iterator[Thread]:
        """Iterator over all threads in a mailbox, most recent activity first.

        Pagination is handled automatically — just iterate.

        Args:
            email_address: Full email address of the mailbox.
            page_size: Number of threads fetched per API call (1–100).

        Example::

            for thread in client.threads.list(email_address):
                print(thread.subject, thread.message_count)
        """
        return self._paginate(email_address, page_size=page_size)

    def _paginate(
        self,
        email_address: str,
        *,
        page_size: int,
    ) -> Iterator[Thread]:
        cursor: str | None = None
        while True:
            page = self._http.get(
                f"/mailboxes/{email_address}/threads",
                params={"limit": page_size, "cursor": cursor},
            )
            for item in page["items"]:
                yield Thread._from_dict(item)
            if not page["has_more"]:
                break
            cursor = page["next_cursor"]

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

    def delete(self, email_address: str, thread_id: UUID | str) -> None:
        """Delete a thread."""
        self._http.delete(f"/mailboxes/{email_address}/threads/{thread_id}")

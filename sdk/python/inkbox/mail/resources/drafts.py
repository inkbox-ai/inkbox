"""Email draft operations."""

from __future__ import annotations

from email.message import Message as HeaderMessage
from typing import TYPE_CHECKING, Any, Iterator
from uuid import UUID

from inkbox.identities.types import _UNSET
from inkbox.mail.types import (
    DraftAttachmentContent,
    DraftDetail,
    DraftRecipients,
    DraftSummary,
    ForwardMode,
    Message,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport

_DEFAULT_PAGE_SIZE = 50


class DraftsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self, email_address: str, *, page_size: int = _DEFAULT_PAGE_SIZE
    ) -> Iterator[DraftSummary]:
        """Iterate over all drafts in a mailbox, newest first."""
        cursor: str | None = None
        while True:
            page = self._http.get(
                f"/mailboxes/{email_address}/drafts",
                params={"limit": page_size, "cursor": cursor},
            )
            for item in page["items"]:
                yield DraftSummary._from_dict(item)
            if not page["has_more"]:
                break
            cursor = page.get("next_cursor")
            if not cursor:
                break

    def create(
        self,
        email_address: str,
        *,
        to: list[str] | None = None,
        cc: list[str] | None = None,
        bcc: list[str] | None = None,
        subject: str | None = None,
        body_text: str | None = None,
        body_html: str | None = None,
        reply_to: str | None = None,
        thread_id: UUID | str | None = None,
        in_reply_to_message_id: str | None = None,
        references: list[str] | None = None,
        forward_message_id: UUID | str | None = None,
        forward_mode: ForwardMode | str | None = None,
        forward_note_text: str | None = None,
        forward_note_html: str | None = None,
        include_original_attachments: bool = True,
        attachments: list[dict[str, str]] | None = None,
        track_opens: bool = False,
    ) -> DraftDetail:
        """Create an email draft. All message fields may be incomplete."""
        recipients: dict[str, list[str]] = {}
        if to is not None:
            recipients["to"] = to
        if cc is not None:
            recipients["cc"] = cc
        if bcc is not None:
            recipients["bcc"] = bcc
        body: dict[str, Any] = {"recipients": recipients}
        optional = {
            "subject": subject,
            "body_text": body_text,
            "body_html": body_html,
            "reply_to": reply_to,
            "thread_id": thread_id,
            "in_reply_to_message_id": in_reply_to_message_id,
            "references": references,
            "attachments": attachments,
        }
        body.update(
            {
                key: str(value) if isinstance(value, UUID) else value
                for key, value in optional.items()
                if value is not None
            }
        )
        if track_opens:
            body["track_opens"] = True
        if forward_message_id is not None:
            body["forward_message_id"] = str(forward_message_id)
            body["include_original_attachments"] = include_original_attachments
            if forward_mode is not None:
                body["forward_mode"] = ForwardMode(forward_mode).value
            if forward_note_text is not None:
                body["forward_note_text"] = forward_note_text
            if forward_note_html is not None:
                body["forward_note_html"] = forward_note_html
        data = self._http.post(f"/mailboxes/{email_address}/drafts", json=body)
        return DraftDetail._from_dict(data)

    def get(self, email_address: str, draft_id: UUID | str) -> DraftDetail:
        """Get one draft with its bodies and attachment metadata."""
        data = self._http.get(f"/mailboxes/{email_address}/drafts/{draft_id}")
        return DraftDetail._from_dict(data)

    def update(
        self,
        email_address: str,
        draft_id: UUID | str,
        *,
        generation: int,
        recipients: Any = _UNSET,
        subject: Any = _UNSET,
        body_text: Any = _UNSET,
        body_html: Any = _UNSET,
        reply_to: Any = _UNSET,
        thread_id: Any = _UNSET,
        in_reply_to_message_id: Any = _UNSET,
        references: Any = _UNSET,
        track_opens: Any = _UNSET,
        forward_note_text: Any = _UNSET,
        forward_note_html: Any = _UNSET,
    ) -> DraftDetail:
        """Update supplied fields if the draft generation still matches."""
        body: dict[str, Any] = {"generation": generation}
        if recipients is not _UNSET:
            body["recipients"] = (
                recipients.to_wire()
                if isinstance(recipients, DraftRecipients)
                else recipients
            )
        fields = {
            "subject": subject,
            "body_text": body_text,
            "body_html": body_html,
            "reply_to": reply_to,
            "thread_id": thread_id,
            "in_reply_to_message_id": in_reply_to_message_id,
            "references": references,
            "track_opens": track_opens,
            "forward_note_text": forward_note_text,
            "forward_note_html": forward_note_html,
        }
        for key, value in fields.items():
            if value is not _UNSET:
                body[key] = str(value) if isinstance(value, UUID) else value
        data = self._http.patch(
            f"/mailboxes/{email_address}/drafts/{draft_id}", json=body
        )
        return DraftDetail._from_dict(data)

    def delete(
        self, email_address: str, draft_id: UUID | str, *, generation: int
    ) -> None:
        """Delete a draft if its generation still matches."""
        self._http.delete(
            f"/mailboxes/{email_address}/drafts/{draft_id}",
            params={"generation": generation},
        )

    def duplicate(
        self, email_address: str, draft_id: UUID | str, *, generation: int
    ) -> DraftDetail:
        """Create an independent copy of a draft."""
        data = self._http.post(
            f"/mailboxes/{email_address}/drafts/{draft_id}/duplicate",
            json={"generation": generation},
        )
        return DraftDetail._from_dict(data)

    def add_attachments(
        self,
        email_address: str,
        draft_id: UUID | str,
        *,
        generation: int,
        attachments: list[dict[str, str]],
    ) -> DraftDetail:
        """Append attachments to a draft."""
        data = self._http.post(
            f"/mailboxes/{email_address}/drafts/{draft_id}/attachments",
            json={"generation": generation, "attachments": attachments},
        )
        return DraftDetail._from_dict(data)

    def remove_attachment(
        self,
        email_address: str,
        draft_id: UUID | str,
        part_index: int,
        *,
        generation: int,
    ) -> DraftDetail:
        """Remove an attachment from a draft."""
        data = self._http.delete_with_response(
            f"/mailboxes/{email_address}/drafts/{draft_id}/attachments/{part_index}",
            params={"generation": generation},
        )
        return DraftDetail._from_dict(data)

    def download_attachment(
        self,
        email_address: str,
        draft_id: UUID | str,
        part_index: int,
        *,
        generation: int,
    ) -> DraftAttachmentContent:
        """Download attachment bytes from a specific draft generation."""
        response = self._http.get_raw(
            f"/mailboxes/{email_address}/drafts/{draft_id}/attachments/{part_index}",
            accept="application/octet-stream",
            params={"generation": generation},
        )
        header = HeaderMessage()
        header["Content-Disposition"] = response.headers.get(
            "Content-Disposition", ""
        )
        return DraftAttachmentContent(
            content=response.content,
            filename=header.get_filename() or "attachment",
            content_type=response.headers.get(
                "Content-Type", "application/octet-stream"
            ).partition(";")[0],
        )

    def send(
        self, email_address: str, draft_id: UUID | str, *, generation: int
    ) -> Message:
        """Send a draft if its generation still matches."""
        data = self._http.post(
            f"/mailboxes/{email_address}/drafts/{draft_id}/send",
            json={"generation": generation},
        )
        return Message._from_dict(data)

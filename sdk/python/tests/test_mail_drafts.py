"""Tests for email draft types, resource operations, and transport behavior."""

from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import httpx
import pytest

from inkbox import DraftDetail, DraftRecipients, DraftSendState, DraftSummary, Inkbox
from inkbox._http import HttpTransport
from inkbox.agent_identity import AgentIdentity
from inkbox.exceptions import InkboxAPIError, InkboxError
from inkbox.identities.types import _AgentIdentityData
from inkbox.mail.resources.drafts import DraftsResource
from inkbox.mail.types import DraftAttachmentContent
from sample_data_identities import IDENTITY_DETAIL_DICT
from sample_data_mail import MESSAGE_DICT

EMAIL = "drafts@example.com"
DRAFT_ID = "11111111-1111-1111-1111-111111111111"
MAILBOX_ID = "22222222-2222-2222-2222-222222222222"

DRAFT_SUMMARY = {
    "id": DRAFT_ID,
    "mailbox_id": MAILBOX_ID,
    "from_address": EMAIL,
    "to_addresses": ["recipient@example.com"],
    "cc_addresses": [],
    "bcc_addresses": [],
    "subject": "Draft subject",
    "snippet": "Draft body",
    "has_attachments": True,
    "attachment_count": 1,
    "generation": 3,
    "send_state": "draft",
    "track_opens": False,
    "created_at": "2026-08-17T10:00:00+00:00",
    "updated_at": "2026-08-17T11:00:00+00:00",
}

DRAFT_DETAIL = {
    **DRAFT_SUMMARY,
    "body_text": "Draft body",
    "body_html": "<p>Draft body</p>",
    "reply_to": "reply@example.com",
    "thread_id": "33333333-3333-3333-3333-333333333333",
    "message_id": "<draft@example.com>",
    "in_reply_to": "<parent@example.com>",
    "references": ["<root@example.com>", "<parent@example.com>"],
    "forward_source_message_id": "44444444-4444-4444-4444-444444444444",
    "forward_note_text": "For your review",
    "forward_note_html": "<p>For your review</p>",
    "attachment_metadata": [
        {
            "part_index": 2,
            "filename": "résumé.pdf",
            "content_type": "application/pdf",
            "size": 123,
            "content_id": None,
            "is_inline": False,
        }
    ],
}


def _resource() -> tuple[DraftsResource, MagicMock]:
    http = MagicMock()
    return DraftsResource(http), http


def test_draft_types_parse_uuid_datetime_enum_and_attachments():
    summary = DraftSummary._from_dict(DRAFT_SUMMARY)
    detail = DraftDetail._from_dict(DRAFT_DETAIL)

    assert isinstance(summary.id, UUID)
    assert isinstance(summary.created_at, datetime)
    assert summary.send_state is DraftSendState.DRAFT
    assert isinstance(detail.thread_id, UUID)
    assert isinstance(detail.forward_source_message_id, UUID)
    assert detail.attachment_metadata[0].filename == "résumé.pdf"


def test_list_auto_paginates_with_cursor_and_page_size():
    resource, http = _resource()
    second = {**DRAFT_SUMMARY, "id": "55555555-5555-5555-5555-555555555555"}
    http.get.side_effect = [
        {"items": [DRAFT_SUMMARY], "next_cursor": "next-page", "has_more": True},
        {"items": [second], "next_cursor": None, "has_more": False},
    ]

    drafts = list(resource.list(EMAIL, page_size=25))

    assert [str(draft.id) for draft in drafts] == [DRAFT_ID, second["id"]]
    assert http.get.call_args_list[0].args == (f"/mailboxes/{EMAIL}/drafts",)
    assert http.get.call_args_list[0].kwargs == {
        "params": {"limit": 25, "cursor": None}
    }
    assert http.get.call_args_list[1].kwargs == {
        "params": {"limit": 25, "cursor": "next-page"}
    }


def test_create_omits_optional_and_forward_only_defaults():
    resource, http = _resource()
    http.post.return_value = DRAFT_DETAIL

    resource.create(
        EMAIL,
        subject="Incomplete",
        references=["<root@example.com>", "<parent@example.com>"],
    )

    http.post.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts",
        json={
            "recipients": {},
            "subject": "Incomplete",
            "references": ["<root@example.com>", "<parent@example.com>"],
        },
    )


def test_create_omits_forward_fields_without_forward_message():
    resource, http = _resource()
    http.post.return_value = DRAFT_DETAIL

    resource.create(
        EMAIL,
        forward_mode="wrapped",
        forward_note_text="Not a forward",
        include_original_attachments=False,
    )

    assert http.post.call_args.kwargs["json"] == {"recipients": {}}


def test_create_forward_sends_forward_options_only_when_applicable():
    resource, http = _resource()
    http.post.return_value = DRAFT_DETAIL

    resource.create(
        EMAIL,
        to=["recipient@example.com"],
        subject="Fwd: subject",
        forward_message_id=UUID("44444444-4444-4444-4444-444444444444"),
        forward_mode="wrapped",
        forward_note_text="FYI",
        include_original_attachments=False,
        attachments=[
            {
                "filename": "note.txt",
                "content_type": "text/plain",
                "content_base64": "aGk=",
            }
        ],
        track_opens=True,
    )

    assert http.post.call_args.kwargs["json"] == {
        "recipients": {"to": ["recipient@example.com"]},
        "subject": "Fwd: subject",
        "attachments": [
            {
                "filename": "note.txt",
                "content_type": "text/plain",
                "content_base64": "aGk=",
            }
        ],
        "track_opens": True,
        "forward_message_id": "44444444-4444-4444-4444-444444444444",
        "include_original_attachments": False,
        "forward_mode": "wrapped",
        "forward_note_text": "FYI",
    }


def test_get_uses_exact_path():
    resource, http = _resource()
    http.get.return_value = DRAFT_DETAIL

    result = resource.get(EMAIL, DRAFT_ID)

    http.get.assert_called_once_with(f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}")
    assert result.generation == 3


def test_update_omits_unsupplied_fields():
    resource, http = _resource()
    http.patch.return_value = DRAFT_DETAIL

    resource.update(EMAIL, DRAFT_ID, generation=3, subject="Changed")

    http.patch.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}",
        json={"generation": 3, "subject": "Changed"},
    )


def test_update_preserves_explicit_null_and_false():
    resource, http = _resource()
    http.patch.return_value = DRAFT_DETAIL

    resource.update(
        EMAIL,
        DRAFT_ID,
        generation=3,
        recipients=None,
        subject=None,
        body_html=None,
        thread_id=None,
        track_opens=False,
        forward_note_text=None,
    )

    assert http.patch.call_args.kwargs["json"] == {
        "generation": 3,
        "recipients": None,
        "subject": None,
        "body_html": None,
        "thread_id": None,
        "track_opens": False,
        "forward_note_text": None,
    }


def test_update_serializes_uuid_values():
    resource, http = _resource()
    http.patch.return_value = DRAFT_DETAIL
    thread_id = UUID("33333333-3333-3333-3333-333333333333")

    resource.update(EMAIL, DRAFT_ID, generation=3, thread_id=thread_id)

    assert http.patch.call_args.kwargs["json"]["thread_id"] == str(thread_id)


def test_update_serializes_draft_recipients_value():
    resource, http = _resource()
    http.patch.return_value = DRAFT_DETAIL

    resource.update(
        EMAIL,
        DRAFT_ID,
        generation=3,
        recipients=DraftRecipients(to=["new@example.com"], cc=None, bcc=[]),
    )

    assert http.patch.call_args.kwargs["json"]["recipients"] == {
        "to": ["new@example.com"],
        "cc": None,
        "bcc": [],
    }


def test_generation_placement_for_mutations():
    resource, http = _resource()
    http.post.return_value = DRAFT_DETAIL
    http.delete_with_response.return_value = DRAFT_DETAIL

    resource.duplicate(EMAIL, DRAFT_ID, generation=3)
    http.post.assert_called_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}/duplicate",
        json={"generation": 3},
    )

    attachments = [
        {
            "filename": "note.txt",
            "content_type": "text/plain",
            "content_base64": "aGk=",
        }
    ]
    resource.add_attachments(
        EMAIL, DRAFT_ID, generation=3, attachments=attachments
    )
    http.post.assert_called_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}/attachments",
        json={"generation": 3, "attachments": attachments},
    )

    resource.delete(EMAIL, DRAFT_ID, generation=3)
    http.delete.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}", params={"generation": 3}
    )

    resource.remove_attachment(EMAIL, DRAFT_ID, 2, generation=4)
    http.delete_with_response.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}/attachments/2",
        params={"generation": 4},
    )


def test_download_attachment_parses_rfc5987_filename_and_headers():
    resource, http = _resource()
    http.get_raw.return_value = SimpleNamespace(
        content=b"pdf-bytes",
        headers={
            "Content-Disposition": "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf",
            "Content-Type": "application/pdf; charset=binary",
        },
    )

    result = resource.download_attachment(EMAIL, DRAFT_ID, 2, generation=3)

    http.get_raw.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}/attachments/2",
        accept="application/octet-stream",
        params={"generation": 3},
    )
    assert result == DraftAttachmentContent(
        content=b"pdf-bytes", filename="résumé.pdf", content_type="application/pdf"
    )


def test_send_returns_existing_message_type():
    resource, http = _resource()
    http.post.return_value = MESSAGE_DICT

    message = resource.send(EMAIL, DRAFT_ID, generation=3)

    http.post.assert_called_once_with(
        f"/mailboxes/{EMAIL}/drafts/{DRAFT_ID}/send",
        json={"generation": 3},
    )
    assert message.subject == MESSAGE_DICT["subject"]


def test_transport_delete_query_params_and_get_raw_preserve_headers_and_bytes():
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.method == "DELETE":
            return httpx.Response(204, request=request)
        return httpx.Response(
            200,
            content=b"raw-content",
            headers={"Content-Disposition": "attachment; filename=test.txt"},
            request=request,
        )

    transport = HttpTransport(api_key="test", base_url="https://example.com")
    transport._client = httpx.Client(
        base_url="https://example.com", transport=httpx.MockTransport(handler)
    )

    transport.delete("/draft", params={"generation": 7, "ignored": None})
    raw = transport.get_raw("/attachment", accept="text/plain")
    content = transport.get_bytes("/attachment", accept="text/plain")

    assert requests[0].url.query == b"generation=7"
    assert raw.content == b"raw-content"
    assert raw.headers["Content-Disposition"].endswith("test.txt")
    assert content == b"raw-content"
    transport.close()


@pytest.mark.parametrize(
    "code",
    [
        "draft_generation_conflict",
        "draft_send_in_progress",
        "draft_delivery_uncertain",
    ],
)
def test_transport_preserves_draft_conflict_codes(code: str):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            409,
            json={"detail": {"error": code, "message": "Draft conflict"}},
            request=request,
        )

    transport = HttpTransport(api_key="test", base_url="https://example.com")
    transport._client = httpx.Client(
        base_url="https://example.com", transport=httpx.MockTransport(handler)
    )

    with pytest.raises(InkboxAPIError) as exc_info:
        transport.post("/draft/send", json={"generation": 1})

    assert exc_info.value.detail["error"] == code
    transport.close()


def test_client_exposes_drafts_resource():
    client = Inkbox(api_key="test")

    assert client.drafts is client._drafts
    assert isinstance(client.drafts, DraftsResource)
    client.close()


def test_identity_draft_wrappers_delegate_to_mailbox_resource():
    identity = AgentIdentity(
        _AgentIdentityData._from_dict(IDENTITY_DETAIL_DICT), MagicMock()
    )
    drafts = identity._inkbox._drafts
    mailbox = "sales-agent@inkbox.ai"

    identity.iter_email_drafts(page_size=20)
    drafts.list.assert_called_once_with(mailbox, page_size=20)

    identity.create_email_draft(to=["recipient@example.com"], subject="Draft")
    assert drafts.create.call_args.args == (mailbox,)
    assert drafts.create.call_args.kwargs["subject"] == "Draft"

    identity.get_email_draft(DRAFT_ID)
    drafts.get.assert_called_once_with(mailbox, DRAFT_ID)

    identity.update_email_draft(DRAFT_ID, generation=3, subject=None)
    assert drafts.update.call_args.args == (mailbox, DRAFT_ID)
    assert drafts.update.call_args.kwargs["generation"] == 3
    assert drafts.update.call_args.kwargs["subject"] is None

    identity.duplicate_email_draft(DRAFT_ID, generation=3)
    drafts.duplicate.assert_called_once_with(mailbox, DRAFT_ID, generation=3)

    identity.delete_email_draft(DRAFT_ID, generation=3)
    drafts.delete.assert_called_once_with(mailbox, DRAFT_ID, generation=3)

    identity.send_email_draft(DRAFT_ID, generation=3)
    drafts.send.assert_called_once_with(mailbox, DRAFT_ID, generation=3)


def test_identity_draft_wrappers_require_mailbox():
    data = _AgentIdentityData._from_dict({**IDENTITY_DETAIL_DICT, "mailbox": None})
    identity = AgentIdentity(data, MagicMock())

    with pytest.raises(InkboxError, match="has no mailbox"):
        identity.get_email_draft(DRAFT_ID)

from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from inkbox import MailImportFormat, MailImportJobStatus, MailImportUploadError
from inkbox.mail.resources.imports import MailboxImportsResource
from inkbox.mail.types import MailImportUploadTarget

MAILBOX = "archive@example.com"
JOB_ID = "11111111-1111-1111-1111-111111111111"


def job(status: str = "running") -> dict:
    return {
        "id": JOB_ID,
        "mailbox_id": "22222222-2222-2222-2222-222222222222",
        "status": status,
        "source_format": "zip",
        "original_addresses": ["old@example.com"],
        "mark_as_read": True,
        "upload_size_bytes": 123,
        "messages_processed": 4,
        "messages_imported": 2,
        "messages_skipped_duplicate": 1,
        "messages_failed": 0,
        "messages_rejected_unsafe": 1,
        "error_detail": None,
        "created_at": "2026-07-24T12:00:00+00:00",
        "updated_at": "2026-07-24T12:01:00+00:00",
        "started_at": "2026-07-24T12:00:10+00:00",
        "finished_at": None,
    }


def test_lifecycle_paths_and_parsing():
    http = MagicMock()
    resource = MailboxImportsResource(http)
    http.post.return_value = {
        "job": job("pending_upload"),
        "upload": {
            "url": "https://uploads.example.test",
            "fields": {"key": "value"},
            "expires_in_seconds": 3600,
        },
    }

    result = resource.create(
        MAILBOX,
        source_format=MailImportFormat.ZIP,
        original_addresses=["old@example.com"],
        mark_as_read=False,
    )
    assert result.job.status is MailImportJobStatus.PENDING_UPLOAD
    assert result.job.messages_rejected_unsafe == 1
    http.post.assert_called_once_with(
        f"/mailboxes/{MAILBOX}/imports",
        json={
            "source_format": "zip",
            "original_addresses": ["old@example.com"],
            "mark_as_read": False,
        },
    )

    http.reset_mock()
    http.get.return_value = {"items": [job()], "next_cursor": "next", "has_more": True}
    page = resource.list(MAILBOX, cursor="cursor", limit=10)
    assert page.has_more and page.next_cursor == "next"
    http.get.assert_called_once_with(
        f"/mailboxes/{MAILBOX}/imports",
        params={"cursor": "cursor", "limit": 10},
    )


def test_wait_stops_on_every_terminal_status():
    for status in ("completed", "failed", "cancelled"):
        http = MagicMock()
        http.get.return_value = job(status)
        result = MailboxImportsResource(http).wait(MAILBOX, JOB_ID, poll_interval=0.01)
        assert result.status.value == status


def test_wait_polls_immediately_and_times_out_without_cancelling():
    http = MagicMock()
    http.get.return_value = job()
    resource = MailboxImportsResource(http)
    with (
        patch(
            "inkbox.mail.resources.imports.time.monotonic", side_effect=[0.0, 0.0, 1.0]
        ),
        patch("inkbox.mail.resources.imports.time.sleep"),
    ):
        with pytest.raises(TimeoutError):
            resource.wait(MAILBOX, JOB_ID, timeout=1.0, poll_interval=0.5)
    assert http.get.call_count == 1
    assert http.get.call_args.kwargs["timeout"] == 1.0
    http.post.assert_not_called()


def test_wait_normalizes_poll_request_timeout():
    http = MagicMock()
    http.get.side_effect = httpx.ReadTimeout("timed out")
    with pytest.raises(TimeoutError, match=JOB_ID):
        MailboxImportsResource(http).wait(MAILBOX, JOB_ID, timeout=1.0)


def test_upload_streams_file_without_api_transport(tmp_path: Path):
    path = tmp_path / "mail.mbox"
    path.write_bytes(b"From sender@example.com\n")
    target = MailImportUploadTarget(
        url="https://uploads.example.test",
        fields={"policy": "p", "key": "k"},
        expires_in_seconds=3600,
    )

    def fake_post(url, **kwargs):
        assert url == target.url
        assert kwargs["data"] == target.fields
        assert "headers" not in kwargs
        _, stream, _ = kwargs["files"]["file"]
        assert stream.read(4) == b"From"
        return httpx.Response(204)

    with patch("inkbox.mail.resources.imports.httpx.post", side_effect=fake_post):
        MailboxImportsResource(MagicMock()).upload(target, path)


def test_upload_error_is_distinct(tmp_path: Path):
    path = tmp_path / "mail.eml"
    path.write_bytes(b"Subject: Test\n\nBody")
    target = MailImportUploadTarget("https://uploads.example.test", {}, 3600)
    with (
        patch(
            "inkbox.mail.resources.imports.httpx.post",
            return_value=httpx.Response(403, text="denied"),
        ),
        pytest.raises(MailImportUploadError) as exc,
    ):
        MailboxImportsResource(MagicMock()).upload(target, path)
    assert exc.value.status_code == 403

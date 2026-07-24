from __future__ import annotations

import os
import time
from pathlib import Path
from typing import TYPE_CHECKING, BinaryIO

import httpx

from inkbox.exceptions import MailImportUploadError
from inkbox.mail.types import (
    MailImportCreateResult,
    MailImportFormat,
    MailImportJob,
    MailImportJobPage,
    MailImportUploadTarget,
)

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class MailboxImportsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    @staticmethod
    def _base(email_address: str) -> str:
        return f"/mailboxes/{email_address}/imports"

    def create(
        self,
        email_address: str,
        *,
        source_format: MailImportFormat | str = MailImportFormat.AUTO,
        original_addresses: list[str] | None = None,
        mark_as_read: bool = True,
    ) -> MailImportCreateResult:
        data = self._http.post(
            self._base(email_address),
            json={
                "source_format": source_format.value
                if isinstance(source_format, MailImportFormat)
                else source_format,
                "original_addresses": original_addresses,
                "mark_as_read": mark_as_read,
            },
        )
        return MailImportCreateResult._from_dict(data)

    def refresh_upload_target(
        self, email_address: str, job_id: str
    ) -> MailImportUploadTarget:
        data = self._http.post(f"{self._base(email_address)}/{job_id}/upload-url")
        return MailImportUploadTarget._from_dict(data)

    def upload(
        self,
        upload_target: MailImportUploadTarget,
        file: str | os.PathLike[str] | BinaryIO,
        *,
        filename: str | None = None,
        timeout: float | None = None,
    ) -> None:
        opened: BinaryIO | None = None
        if isinstance(file, (str, os.PathLike)):
            path = Path(file)
            opened = path.open("rb")
            stream = opened
            upload_name = filename or path.name
        else:
            stream = file
            upload_name = filename or Path(getattr(file, "name", "upload")).name
        try:
            try:
                response = httpx.post(
                    upload_target.url,
                    data=upload_target.fields,
                    files={"file": (upload_name, stream, "application/octet-stream")},
                    timeout=timeout,
                )
            except httpx.HTTPError as exc:
                raise MailImportUploadError(None, str(exc)) from exc
        finally:
            if opened is not None:
                opened.close()
        if response.is_error:
            raise MailImportUploadError(response.status_code, response.text)

    def start(self, email_address: str, job_id: str) -> MailImportJob:
        data = self._http.post(f"{self._base(email_address)}/{job_id}/start")
        return MailImportJob._from_dict(data)

    def get(self, email_address: str, job_id: str) -> MailImportJob:
        return self._get(email_address, job_id)

    def _get(
        self,
        email_address: str,
        job_id: str,
        *,
        timeout: float | None = None,
    ) -> MailImportJob:
        data = self._http.get(
            f"{self._base(email_address)}/{job_id}",
            timeout=timeout,
        )
        return MailImportJob._from_dict(data)

    def list(
        self,
        email_address: str,
        *,
        cursor: str | None = None,
        limit: int = 50,
    ) -> MailImportJobPage:
        data = self._http.get(
            self._base(email_address), params={"cursor": cursor, "limit": limit}
        )
        return MailImportJobPage._from_dict(data)

    def cancel(self, email_address: str, job_id: str) -> MailImportJob:
        data = self._http.post(f"{self._base(email_address)}/{job_id}/cancel")
        return MailImportJob._from_dict(data)

    def wait(
        self,
        email_address: str,
        job_id: str,
        *,
        timeout: float | None = None,
        poll_interval: float = 5.0,
    ) -> MailImportJob:
        if poll_interval <= 0:
            raise ValueError("poll_interval must be greater than zero")
        started = time.monotonic()
        while True:
            remaining = None
            if timeout is not None:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError(f"Timed out waiting for import job {job_id}")
            try:
                job = self._get(email_address, job_id, timeout=remaining)
            except httpx.TimeoutException as exc:
                if timeout is None:
                    raise
                raise TimeoutError(
                    f"Timed out waiting for import job {job_id}"
                ) from exc
            if job.is_terminal:
                return job
            if timeout is not None:
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise TimeoutError(f"Timed out waiting for import job {job_id}")
                time.sleep(min(poll_interval, remaining))
            else:
                time.sleep(poll_interval)

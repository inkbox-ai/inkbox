"""Bounded retries for one logical outbound message request."""

from __future__ import annotations

import time
import copy
from json import JSONDecodeError
from typing import TYPE_CHECKING, Any
from uuid import uuid4

import httpx

from inkbox.exceptions import InkboxAPIError

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


def send_key(value: str | None) -> str:
    """Generate one request key, or validate an explicitly supplied key."""
    key = str(uuid4()) if value is None else value
    if not key.strip() or len(key) > 255 or not key.isascii() or not key.isprintable():
        raise ValueError("idempotency_key must contain 1–255 printable ASCII characters")
    return key


def post_message(
    http: HttpTransport, path: str, *, json: dict[str, Any],
    idempotency_key: str | None = None, params: dict[str, Any] | None = None,
) -> Any:
    """Send with one key across bounded transport/in-progress retries.

    On failure, ``idempotency_key`` on the exception identifies this request.
    Repeated method calls are separate messages unless given the same explicit key.
    """
    key = send_key(idempotency_key)
    options: dict[str, Any] = {"json": copy.deepcopy(json), "headers": {
        "Idempotency-Key": key, "Prefer": "idempotency-replay",
    }}
    if params is not None:
        options["params"] = params
    for attempt in range(3):
        try:
            return http.post(path, **options)
        except (httpx.TransportError, JSONDecodeError, InkboxAPIError) as error:
            error.idempotency_key = key
            retryable = isinstance(error, (httpx.TransportError, JSONDecodeError))
            delay = 0.25 * 2**attempt
            if isinstance(error, InkboxAPIError):
                code = error.detail.get("error") if isinstance(error.detail, dict) else None
                retryable = error.status_code in (429, 502, 503, 504) or code == "idempotency_in_progress"
                retry_after = getattr(error, "retry_after_seconds", None)
                if retry_after is not None:
                    retryable = retryable and retry_after <= 5
                    delay = max(delay, retry_after)
            if not retryable or attempt == 2:
                raise
            time.sleep(delay)

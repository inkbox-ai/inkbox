"""Advisory HTTP response metadata, independent of resource return types."""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Callable, Generic, TypeVar

import httpx

T = TypeVar("T")


@dataclass(frozen=True)
class ResponseNotice:
    code: str
    level: str
    message: str


@dataclass(frozen=True)
class ResponseMetadata:
    notices: list[ResponseNotice] | None = None


@dataclass(frozen=True)
class APIResponse(Generic[T]):
    data: T
    notices: list[ResponseNotice] | None = None


ResponseObserver = Callable[[ResponseMetadata], None]


def _parse_notices(value: object) -> list[ResponseNotice] | None:
    if not isinstance(value, list):
        return None
    notices = []
    for item in value:
        if isinstance(item, dict) and all(
            isinstance(item.get(key), str) for key in ("code", "level", "message")
        ):
            notice = ResponseNotice(item["code"], item["level"], item["message"])
            if notice not in notices:
                notices.append(notice)
    return notices or None


# Only these object contracts declare top-level response notices.
_BODY_METADATA_PATH = re.compile(
    r"/api/v1/(?:identities(?:/[^/]+)?"
    r"|identities/[^/]+/contacts/[^/]+/(?:access|permissions)"
    r"|identities/[^/]+/(?:contact-permissions|contact-communication-policies)"
    r"|contacts/[^/]+/(?:communication-policy|communication-preview)"
    r"|mail/mailboxes/[^/]+|phone/numbers/[^/]+)/?"
)
_AVATAR_METADATA_PATH = re.compile(r"/api/v1/identities/[^/]+/avatar/?")


def _response_metadata(response: httpx.Response, *, allow_body: bool = True) -> ResponseMetadata:
    header = response.headers.get("Inkbox-Notices")
    if header is not None:
        try:
            value = json.loads(header)
        except (ValueError, TypeError):
            pass
        else:
            notices = _parse_notices(value)
            if notices or value is None or value == []:
                return ResponseMetadata(notices)
    if allow_body and response.is_success and (
        _BODY_METADATA_PATH.fullmatch(response.request.url.path)
        or (
            response.request.method == "PUT"
            and _AVATAR_METADATA_PATH.fullmatch(response.request.url.path)
        )
    ):
        try:
            body = response.json()
        except (ValueError, UnicodeError):
            pass
        else:
            if isinstance(body, dict):
                return ResponseMetadata(_parse_notices(body.get("notices")))
    return ResponseMetadata()


def _observe_response(response: httpx.Response, *observers: ResponseObserver | None, allow_body: bool = True) -> None:
    try:
        metadata = _response_metadata(response, allow_body=allow_body)
    except Exception:
        metadata = ResponseMetadata()
    for observer in observers:
        if observer is not None:
            try:
                observer(ResponseMetadata(list(metadata.notices) if metadata.notices else None))
            except Exception:
                try:
                    logging.getLogger(__name__).debug("Response observer failed")
                except Exception:
                    pass

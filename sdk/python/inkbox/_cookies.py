"""
inkbox/_cookies.py

Shared cookie parsing and matching helpers for the sync SDK transports.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timezone
from email.utils import parsedate_to_datetime
from typing import Mapping, Sequence
from urllib.parse import urlparse
import time


@dataclass
class Cookie:
    name: str
    value: str
    domain: str
    host_only: bool
    path: str
    secure: bool
    expires_at: float | None


class CookieJar:
    def __init__(self) -> None:
        self._cookies: dict[tuple[str, str, str], Cookie] = {}

    def header_for_url(self, url: str) -> str | None:
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        path = parsed.path or "/"
        is_secure = parsed.scheme == "https"
        now = time.time()

        pairs: list[str] = []
        expired: list[tuple[str, str, str]] = []
        for key, cookie in self._cookies.items():
            if cookie.expires_at is not None and cookie.expires_at <= now:
                expired.append(key)
                continue
            if cookie.secure and not is_secure:
                continue
            if cookie.host_only:
                if host != cookie.domain:
                    continue
            elif not _domain_matches(host, cookie.domain):
                continue
            if not _path_matches(path, cookie.path):
                continue
            pairs.append(f"{cookie.name}={cookie.value}")

        for key in expired:
            self._cookies.pop(key, None)

        return "; ".join(pairs) if pairs else None

    def store_from_headers(self, url: str, headers: Mapping[str, str] | object) -> None:
        for raw_cookie in _get_set_cookie_headers(headers):
            cookie = _parse_set_cookie(url, raw_cookie)
            if cookie is None:
                continue
            key = (cookie.domain, cookie.path, cookie.name)
            if cookie.expires_at is not None and cookie.expires_at <= time.time():
                self._cookies.pop(key, None)
                continue
            self._cookies[key] = cookie


def _get_set_cookie_headers(headers: Mapping[str, str] | object) -> Sequence[str]:
    get_list = getattr(headers, "get_list", None)
    if callable(get_list):
        return get_list("set-cookie")

    get = getattr(headers, "get", None)
    if callable(get):
        value = get("set-cookie")
        return [value] if value else []

    return []


def _parse_set_cookie(url: str, header: str) -> Cookie | None:
    parts = [part.strip() for part in header.split(";") if part.strip()]
    if not parts:
        return None

    name, sep, value = parts[0].partition("=")
    if not sep or not name:
        return None

    parsed = urlparse(url)
    domain = (parsed.hostname or "").lower()
    host_only = True
    path = _default_path(parsed.path or "/")
    secure = False
    expires_at: float | None = None

    for attr in parts[1:]:
        key, _, attr_value = attr.partition("=")
        key = key.strip().lower()
        attr_value = attr_value.strip()
        if key == "domain" and attr_value:
            domain = attr_value.lstrip(".").lower()
            host_only = False
        elif key == "path" and attr_value.startswith("/"):
            path = attr_value
        elif key == "secure":
            secure = True
        elif key == "max-age":
            try:
                expires_at = time.time() + int(attr_value)
            except ValueError:
                pass
        elif key == "expires" and attr_value:
            try:
                expires_at = parsedate_to_datetime(attr_value).astimezone(tz=timezone.utc).timestamp()
            except (TypeError, ValueError, IndexError):
                pass

    return Cookie(
        name=name,
        value=value,
        domain=domain,
        host_only=host_only,
        path=path,
        secure=secure,
        expires_at=expires_at,
    )


def _default_path(path: str) -> str:
    if not path or not path.startswith("/"):
        return "/"
    if path == "/":
        return "/"
    return path.rsplit("/", 1)[0] or "/"


def _domain_matches(host: str, domain: str) -> bool:
    return host == domain or host.endswith(f".{domain}")


def _path_matches(request_path: str, cookie_path: str) -> bool:
    if request_path == cookie_path:
        return True
    if request_path.startswith(cookie_path):
        return cookie_path.endswith("/") or request_path[len(cookie_path)] == "/"
    return False

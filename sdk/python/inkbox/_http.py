"""
inkbox/_http.py

Sync HTTP transport (internal). Shared by all resource packages.
"""

from __future__ import annotations

import importlib.metadata
from typing import Any

import httpx

from inkbox._cookies import CookieJar
from inkbox.exceptions import (
    DedicatedIMessageLineInventoryPendingError,
    DedicatedIMessageLineQuotaExceededError,
    DuplicateContactRuleError,
    InkboxAPIError,
    RecipientBlockedError,
    RedundantContactAccessGrantError,
    StorageLimitExceededError,
)

_DEFAULT_TIMEOUT = 30.0


def _sdk_version() -> str:
    try:
        return importlib.metadata.version("inkbox")
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0"


def sdk_user_agent(prefix: str | None = None) -> str:
    """``User-Agent`` announcing the SDK (e.g. ``inkbox-python/0.4.17``); an
    optional caller token goes first (``inkbox-cli/1.2.3 inkbox-python/...``)."""
    base = f"inkbox-python/{_sdk_version()}"
    return f"{prefix} {base}" if prefix else base


class HttpTransport:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = _DEFAULT_TIMEOUT,
        cookie_jar: CookieJar | None = None,
        user_agent: str | None = None,
    ) -> None:
        headers = {
            "X-API-Key": api_key,
            "Accept": "application/json",
        }
        if user_agent:
            headers["User-Agent"] = user_agent
        self._client = httpx.Client(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
        )
        self._cookie_jar = cookie_jar or CookieJar()

    def get(
        self,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        cleaned = {k: v for k, v in (params or {}).items() if v is not None}
        resp = self._send("GET", path, params=cleaned, timeout=timeout)
        _raise_for_status(resp)
        return resp.json()

    def post(
        self,
        path: str,
        *,
        json: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        timeout: float | None = None,
    ) -> Any:
        cleaned = {k: v for k, v in (params or {}).items() if v is not None}
        resp = self._send("POST", path, json=json, params=cleaned, timeout=timeout)
        _raise_for_status(resp)
        if resp.status_code == 204:
            return None
        return resp.json()

    def put(
        self,
        path: str,
        *,
        json: dict[str, Any],
        timeout: float | None = None,
    ) -> Any:
        resp = self._send("PUT", path, json=json, timeout=timeout)
        _raise_for_status(resp)
        return resp.json()

    def patch(
        self,
        path: str,
        *,
        json: dict[str, Any],
        timeout: float | None = None,
    ) -> Any:
        resp = self._send("PATCH", path, json=json, timeout=timeout)
        _raise_for_status(resp)
        return resp.json()

    def delete(self, path: str, *, timeout: float | None = None) -> None:
        resp = self._send("DELETE", path, timeout=timeout)
        _raise_for_status(resp)

    def delete_with_response(
        self, path: str, *, timeout: float | None = None,
    ) -> Any:
        """``DELETE`` that returns a parsed JSON body.

        Used by endpoints (e.g. tunnels) that respond with a representation
        of the deleted resource rather than 204 No Content.
        """
        resp = self._send("DELETE", path, timeout=timeout)
        _raise_for_status(resp)
        if resp.status_code == 204 or not resp.content:
            return None
        return resp.json()

    def post_multipart(
        self,
        path: str,
        *,
        field_name: str,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> Any:
        """POST one file as multipart/form-data.

        Used for media uploads. The response is decoded as JSON.
        """
        files = {field_name: (filename, content, content_type)}
        resp = self._send("POST", path, files=files)
        _raise_for_status(resp)
        if resp.status_code == 204:
            return None
        return resp.json()

    def post_bytes(
        self,
        path: str,
        *,
        content: bytes,
        content_type: str,
        accept: str = "application/json",
    ) -> Any:
        """POST arbitrary bytes with a caller-supplied Content-Type.

        Used for non-JSON payloads like vCard imports. The response is
        still decoded as JSON.
        """
        headers = {"Content-Type": content_type, "Accept": accept}
        resp = self._send("POST", path, content=content, headers=headers)
        _raise_for_status(resp)
        if resp.status_code == 204:
            return None
        return resp.json()

    def get_bytes(
        self,
        path: str,
        *,
        accept: str,
        params: dict[str, Any] | None = None,
    ) -> bytes:
        """GET a non-JSON response and return the raw body.

        Used for vCard export and any other binary/text endpoints.
        """
        cleaned = {k: v for k, v in (params or {}).items() if v is not None}
        headers = {"Accept": accept}
        resp = self._send("GET", path, params=cleaned, headers=headers)
        _raise_for_status(resp)
        return resp.content

    def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        # Drop a None timeout so httpx falls back to the client-level default
        # rather than disabling timeouts entirely.
        if kwargs.get("timeout") is None:
            kwargs.pop("timeout", None)
        request = self._client.build_request(method, path, **kwargs)
        cookie = self._cookie_jar.header_for_url(str(request.url))
        if cookie:
            request.headers["Cookie"] = cookie
        resp = self._client.send(request)
        self._cookie_jar.store_from_headers(str(request.url), resp.headers)
        return resp

    def close(self) -> None:
        self._client.close()

    def __enter__(self) -> HttpTransport:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()


def _raise_for_status(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    raw_detail: Any
    try:
        raw_detail = resp.json().get("detail", resp.text)
    except Exception:
        raw_detail = resp.text

    if resp.status_code == 409 and isinstance(raw_detail, dict):
        if "existing_rule_id" in raw_detail:
            raise DuplicateContactRuleError(
                status_code=resp.status_code, detail=raw_detail,
            )
        if raw_detail.get("error") == "redundant_grant":
            raise RedundantContactAccessGrantError(
                status_code=resp.status_code, detail=raw_detail,
            )

    if (
        resp.status_code == 403
        and isinstance(raw_detail, dict)
        and raw_detail.get("error") == "recipient_blocked"
    ):
        raise RecipientBlockedError(
            status_code=resp.status_code, detail=raw_detail,
        )

    # Older servers send a plain-string 402 detail; those fall through to the
    # generic error rather than being mistyped.
    if (
        resp.status_code == 402
        and isinstance(raw_detail, dict)
        and raw_detail.get("error") == "storage_limit_exceeded"
    ):
        raise StorageLimitExceededError(
            status_code=resp.status_code, detail=raw_detail,
        )

    if (
        resp.status_code == 402
        and isinstance(raw_detail, dict)
        and raw_detail.get("error") == "dedicated_imessage_line_quota_exceeded"
    ):
        raise DedicatedIMessageLineQuotaExceededError(
            status_code=resp.status_code, detail=raw_detail,
        )

    if (
        resp.status_code == 503
        and isinstance(raw_detail, dict)
        and raw_detail.get("error") == "dedicated_imessage_line_inventory_pending"
    ):
        raise DedicatedIMessageLineInventoryPendingError(
            status_code=resp.status_code,
            detail=raw_detail,
            retry_after=resp.headers.get("Retry-After"),
        )

    raise InkboxAPIError(status_code=resp.status_code, detail=raw_detail)

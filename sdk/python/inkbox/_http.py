"""
inkbox/_http.py

Sync HTTP transport (internal). Shared by all resource packages.
"""

from __future__ import annotations

from typing import Any

import httpx

from inkbox._cookies import CookieJar
from inkbox.exceptions import InkboxAPIError

_DEFAULT_TIMEOUT = 30.0


class HttpTransport:
    def __init__(
        self,
        api_key: str,
        base_url: str,
        timeout: float = _DEFAULT_TIMEOUT,
        cookie_jar: CookieJar | None = None,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "X-Service-Token": api_key,
                "Accept": "application/json",
            },
            timeout=timeout,
        )
        self._cookie_jar = cookie_jar or CookieJar()

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        cleaned = {k: v for k, v in (params or {}).items() if v is not None}
        resp = self._send("GET", path, params=cleaned)
        _raise_for_status(resp)
        return resp.json()

    def post(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        resp = self._send("POST", path, json=json)
        _raise_for_status(resp)
        if resp.status_code == 204:
            return None
        return resp.json()

    def put(self, path: str, *, json: dict[str, Any]) -> Any:
        resp = self._send("PUT", path, json=json)
        _raise_for_status(resp)
        return resp.json()

    def patch(self, path: str, *, json: dict[str, Any]) -> Any:
        resp = self._send("PATCH", path, json=json)
        _raise_for_status(resp)
        return resp.json()

    def delete(self, path: str) -> None:
        resp = self._send("DELETE", path)
        _raise_for_status(resp)

    def _send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
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
    try:
        detail = resp.json().get("detail", resp.text)
    except Exception:
        detail = resp.text
    raise InkboxAPIError(status_code=resp.status_code, detail=str(detail))

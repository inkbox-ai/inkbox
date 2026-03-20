"""
inkbox/authenticator/_http.py

Sync HTTP transport (internal).
"""

from __future__ import annotations

from typing import Any

import httpx

from inkbox.mail.exceptions import InkboxAPIError

_DEFAULT_TIMEOUT = 30.0


class HttpTransport:
    def __init__(self, api_key: str, base_url: str, timeout: float = _DEFAULT_TIMEOUT) -> None:
        self._client = httpx.Client(
            base_url=base_url,
            headers={
                "X-Service-Token": api_key,
                "Accept": "application/json",
            },
            timeout=timeout,
        )

    def get(self, path: str, *, params: dict[str, Any] | None = None) -> Any:
        cleaned = {k: v for k, v in (params or {}).items() if v is not None}
        resp = self._client.get(path, params=cleaned)
        _raise_for_status(resp)
        return resp.json()

    def post(self, path: str, *, json: dict[str, Any] | None = None) -> Any:
        resp = self._client.post(path, json=json)
        _raise_for_status(resp)
        if resp.status_code == 204:
            return None
        return resp.json()

    def patch(self, path: str, *, json: dict[str, Any]) -> Any:
        resp = self._client.patch(path, json=json)
        _raise_for_status(resp)
        return resp.json()

    def delete(self, path: str) -> None:
        resp = self._client.delete(path)
        _raise_for_status(resp)

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

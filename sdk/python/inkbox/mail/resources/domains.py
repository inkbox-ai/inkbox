"""
inkbox/mail/resources/domains.py

Custom sending-domain operations exposed via ``client.domains``.

Limited to the read-and-default surface: list, set the org default.
Domain registration, DNS-record retrieval, verification, DKIM rotation,
and deletion stay in the console.
"""

from __future__ import annotations

from typing import TYPE_CHECKING
from urllib.parse import quote

from inkbox.mail.types import Domain, SendingDomainStatus

if TYPE_CHECKING:
    from inkbox._http import HttpTransport


class DomainsResource:

    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def list(
        self,
        *,
        status: SendingDomainStatus | None = None,
    ) -> list[Domain]:
        """List custom sending domains registered to your organisation.

        Args:
            status: Optional status filter (e.g. only verified).

        Returns:
            All domains the caller's org owns, optionally filtered by
            status.
        """
        params: dict | None = (
            {"status": status.value}
            if status is not None
            else None
        )
        data = self._http.get(
            "/",
            params=params,
        )
        return [Domain._from_dict(d) for d in data]

    def set_default(self, domain_name: str) -> str | None:
        """Set the organisation's default sending domain.

        Pass the **bare domain name** (e.g. ``"mail.acme.com"``), not the
        row id. Pass the platform sending domain for the target environment
        (e.g. ``"inkboxmail.com"`` in production) to clear the org default
        and revert to the platform domain.

        Requires an **admin-scoped API key**. Non-admin keys receive 403.

        Args:
            domain_name: The bare domain name to set as default.

        Returns:
            The bare new default domain name, or ``None`` when the org
            has reverted to the platform default. Never a row id.
        """
        path = f"/{quote(domain_name, safe='')}/set-default"
        data = self._http.post(path, json={})
        return data.get("default_domain")

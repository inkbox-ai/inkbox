"""Domain control verification for organization administrators."""

from urllib.parse import quote

from inkbox._http import HttpTransport
from inkbox.organization_domains.types import OrganizationDomain, OrganizationDomainPage, parse_organization_domain


class OrganizationDomainsResource:
    def __init__(self, http: HttpTransport) -> None:
        self._http = http

    def create(self, domain: str) -> OrganizationDomain:
        return parse_organization_domain(self._http.post("/organization-domains", json={"domain": domain}))

    def list(self, *, cursor: str | None = None, limit: int = 50) -> OrganizationDomainPage:
        data = self._http.get("/organization-domains", params={"cursor": cursor, "limit": limit})
        return OrganizationDomainPage(items=[parse_organization_domain(row) for row in data["items"]],
                                      next_cursor=data.get("next_cursor"))

    def get(self, claim_id: str) -> OrganizationDomain:
        return parse_organization_domain(self._http.get(f"/organization-domains/{quote(claim_id, safe='')}"))

    def verify(self, claim_id: str) -> OrganizationDomain:
        return parse_organization_domain(self._http.post(f"/organization-domains/{quote(claim_id, safe='')}/verify"))

    def transfer(self, claim_id: str) -> OrganizationDomain:
        return parse_organization_domain(self._http.post(f"/organization-domains/{quote(claim_id, safe='')}/transfer"))

    def delete(self, claim_id: str) -> None:
        self._http.delete(f"/organization-domains/{quote(claim_id, safe='')}")

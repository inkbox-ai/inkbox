"""Verified-domain assertions supplied by Inkbox."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

DOMAIN_AFFILIATION_EXTENSION = "https://inkbox.ai/a2a/extensions/domain-affiliation/v1"


@dataclass(frozen=True)
class DomainAffiliation:
    domain: str
    verifier: str
    last_success_at: datetime
    valid_until: datetime


def parse_domain_affiliation(data: dict[str, Any] | None) -> DomainAffiliation | None:
    if data is None:
        return None
    return DomainAffiliation(
        domain=data["domain"], verifier=data["verifier"],
        last_success_at=datetime.fromisoformat(data["last_success_at"].replace("Z", "+00:00")),
        valid_until=datetime.fromisoformat(data["valid_until"].replace("Z", "+00:00")),
    )

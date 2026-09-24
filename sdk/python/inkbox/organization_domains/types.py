"""Organization-domain management types."""

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from inkbox.a2a.types import ForwardCompatibleStrEnum, parse_datetime
from inkbox.domain_affiliation import DomainAffiliation, parse_domain_affiliation


class DomainClaimState(ForwardCompatibleStrEnum):
    PENDING = "pending"
    VERIFIED = "verified"
    GRACE = "grace"
    EXPIRED = "expired"
    PENDING_EXPIRED = "pending_expired"
    RELEASED = "released"


@dataclass(frozen=True)
class DomainTxtRecord:
    type: str
    name: str
    value: str


@dataclass(frozen=True)
class OrganizationDomain:
    id: str
    domain: str
    state: DomainClaimState
    dns_record: DomainTxtRecord
    verified_at: datetime | None
    last_checked_at: datetime | None
    last_success_at: datetime | None
    valid_until: datetime | None
    pending_expires_at: datetime | None
    next_check_at: datetime | None
    last_check_result: str | None
    ownership_conflict: bool
    transfer_eligible: bool
    recovery_action: str | None
    created_at: datetime


@dataclass(frozen=True)
class OrganizationDomainPage:
    items: list[OrganizationDomain]
    next_cursor: str | None


@dataclass(frozen=True)
class IdentityDomainAffiliation:
    domain_claim_id: str | None
    domain: str | None
    publish_publicly: bool
    affiliation: DomainAffiliation | None


def parse_organization_domain(data: dict[str, Any]) -> OrganizationDomain:
    return OrganizationDomain(
        id=data["id"], domain=data["domain"], state=DomainClaimState(data["state"]),
        dns_record=DomainTxtRecord(**data["dns_record"]),
        verified_at=parse_datetime(data.get("verified_at")),
        last_checked_at=parse_datetime(data.get("last_checked_at")),
        last_success_at=parse_datetime(data.get("last_success_at")),
        valid_until=parse_datetime(data.get("valid_until")),
        pending_expires_at=parse_datetime(data.get("pending_expires_at")),
        next_check_at=parse_datetime(data.get("next_check_at")), last_check_result=data.get("last_check_result"),
        ownership_conflict=data.get("ownership_conflict", False), transfer_eligible=data.get("transfer_eligible", False),
        recovery_action=data.get("recovery_action"),
        created_at=datetime.fromisoformat(data["created_at"].replace("Z", "+00:00")),
    )


def parse_identity_domain_affiliation(data: dict[str, Any]) -> IdentityDomainAffiliation:
    return IdentityDomainAffiliation(domain_claim_id=data.get("domain_claim_id"), domain=data.get("domain"),
                                    publish_publicly=data.get("publish_publicly", False),
                                    affiliation=parse_domain_affiliation(data.get("affiliation")))

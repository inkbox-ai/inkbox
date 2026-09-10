export interface DomainAffiliation {
  domain: string;
  verifier: string;
  lastSuccessAt: string;
  validUntil: string;
}

export type DomainClaimState = "pending" | "verified" | "grace" | "expired" | "pending_expired" | "released" | (string & {});

export interface DomainTxtRecord {
  type: "TXT";
  name: string;
  value: string;
}

export interface OrganizationDomain {
  id: string;
  domain: string;
  state: DomainClaimState;
  dnsRecord: DomainTxtRecord;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  validUntil: string | null;
  pendingExpiresAt: string | null;
  nextCheckAt: string | null;
  lastCheckResult: string | null;
  ownershipConflict: boolean;
  transferEligible: boolean;
  recoveryAction: string | null;
  createdAt: string;
}

export interface OrganizationDomainPage {
  items: OrganizationDomain[];
  nextCursor: string | null;
}

export interface IdentityDomainAffiliation {
  domainClaimId: string | null;
  domain: string | null;
  publishPublicly: boolean;
  affiliation: DomainAffiliation | null;
}

export interface SetDomainAffiliationOptions {
  domainClaimId: string;
  publishPublicly: boolean;
}

type Raw = Record<string, any>;

export function parseDomainAffiliation(raw: Raw | null | undefined): DomainAffiliation | null {
  return raw == null ? null : { domain: raw.domain, verifier: raw.verifier,
    lastSuccessAt: raw.last_success_at, validUntil: raw.valid_until };
}

export function parseOrganizationDomain(raw: Raw): OrganizationDomain {
  return {
    id: raw.id, domain: raw.domain, state: raw.state, dnsRecord: raw.dns_record,
    verifiedAt: raw.verified_at ?? null, lastCheckedAt: raw.last_checked_at ?? null,
    lastSuccessAt: raw.last_success_at ?? null, validUntil: raw.valid_until ?? null,
    pendingExpiresAt: raw.pending_expires_at ?? null, nextCheckAt: raw.next_check_at ?? null,
    lastCheckResult: raw.last_check_result ?? null, ownershipConflict: raw.ownership_conflict ?? false,
    transferEligible: raw.transfer_eligible ?? false, recoveryAction: raw.recovery_action ?? null,
    createdAt: raw.created_at,
  };
}

export function parseIdentityDomainAffiliation(raw: Raw): IdentityDomainAffiliation {
  return { domainClaimId: raw.domain_claim_id ?? null, domain: raw.domain ?? null,
    publishPublicly: raw.publish_publicly ?? false, affiliation: parseDomainAffiliation(raw.affiliation) };
}

import { HttpTransport } from "../../_http.js";
import { type Contact, type RawContact, type ContactReviewStatus, parseContact, parseContactEmail, parseContactPhone } from "../types.js";

/** An entry contributes to the identity's active whitelist or blacklist. */
export type ContactDecision = "inherit" | "allow" | "block";
/** Phone includes SMS, calls, and iMessage. */
export interface ContactChannelDecisions { email: ContactDecision; phone: ContactDecision }
export interface ContactIdentityDecisions extends ContactChannelDecisions { identityId: string }
/** Independent profile and memory visibility decisions. */
export interface ContactVisibilityDecisions { profile: ContactDecision; memories: ContactDecision }
/** One identity's visibility overrides. */
export interface ContactIdentityVisibilityDecisions extends ContactVisibilityDecisions { identityId: string }
/** Complete visibility settings; omission on replacement preserves these settings. */
export interface ContactVisibilityPolicy {
  defaults: ContactVisibilityDecisions;
  identities: ContactIdentityVisibilityDecisions[];
}
/** Effective access, independent of whether the group has stored data. */
export interface ContactVisibilityResult { profile: boolean; memories: boolean }
export interface ContactCommunicationPolicy {
  contactId: string;
  revision: number;
  defaults: ContactChannelDecisions;
  identities: ContactIdentityDecisions[];
  visibility: ContactVisibilityPolicy;
}
export interface ReplaceContactCommunicationPolicy {
  expectedRevision: number;
  defaults: ContactChannelDecisions;
  identities: ContactIdentityDecisions[];
  visibility?: ContactVisibilityPolicy;
}
export interface ContactCommunicationPreview {
  identityId: string;
  contact: Contact | null;
  email: boolean;
  phone: boolean;
  fullProfile: boolean;
  visibility: ContactVisibilityResult;
}
export interface ContactCommunicationPolicyPage {
  items: ContactCommunicationPreview[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
export type IdentifierPermission = "all" | "some" | "none" | "no_identifiers";
export type ContactPermissionSummary = Pick<Contact, "id" | "preferredName" | "givenName" | "familyName" | "companyName" | "reviewStatus" | "emails" | "phones">;
export interface ContactPermissionVisibility {
  defaults: ContactVisibilityDecisions;
  identityOverride: ContactVisibilityDecisions;
}
export interface ContactPermissionEffective extends ContactVisibilityResult {
  email: IdentifierPermission;
  phone: IdentifierPermission;
}
export interface ContactPermissionEntry {
  contact: ContactPermissionSummary;
  revision: number;
  defaults: ContactChannelDecisions;
  identityOverride: ContactChannelDecisions;
  visibility: ContactPermissionVisibility;
  effective: ContactPermissionEffective;
}
export interface ContactPermissionPage {
  items: ContactPermissionEntry[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
export interface ListContactPermissionsOptions {
  q?: string;
  order?: "name" | "recent";
  limit?: number;
  offset?: number;
  reviewStatus?: ContactReviewStatus[];
}
interface RawPermissionEntry {
  contact: Pick<RawContact, "id" | "preferred_name" | "given_name" | "family_name" | "company_name" | "emails" | "phones"> & { review_status: ContactReviewStatus };
  revision: number;
  defaults: ContactChannelDecisions;
  identity_override: ContactChannelDecisions;
  visibility: { defaults: ContactVisibilityDecisions; identity_override: ContactVisibilityDecisions };
  effective: ContactPermissionEffective;
}
interface RawPolicy {
  contact_id: string;
  revision: number;
  defaults: ContactChannelDecisions;
  identities: (ContactChannelDecisions & { identity_id: string })[];
  visibility: { defaults: ContactVisibilityDecisions; identities: (ContactVisibilityDecisions & { identity_id: string })[] };
}
interface RawPreview {
  identity_id: string;
  contact: RawContact | null;
  email: boolean;
  phone: boolean;
  full_profile: boolean;
  visibility: ContactVisibilityResult;
}
/** Parse both required policy portions. */
function parsePolicy(raw: RawPolicy): ContactCommunicationPolicy {
  return { contactId: raw.contact_id, revision: raw.revision, defaults: raw.defaults,
    identities: raw.identities.map((row) => ({ identityId: row.identity_id, email: row.email, phone: row.phone })),
    visibility: { defaults: raw.visibility.defaults,
      identities: raw.visibility.identities.map((row) => ({ identityId: row.identity_id, profile: row.profile, memories: row.memories })) } };
}
/** Parse a filtered contact and independently reported visibility. */
function parsePreview(raw: RawPreview): ContactCommunicationPreview {
  return { identityId: raw.identity_id, contact: raw.contact ? parseContact(raw.contact) : null,
    email: raw.email, phone: raw.phone, fullProfile: raw.full_profile,
    visibility: raw.visibility };
}

/** Administrative communication settings and identity-scoped contact views. */
export class ContactCommunicationPolicyResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read the current policy and revision using admin credentials. */
  async get(contactId: string): Promise<ContactCommunicationPolicy> {
    return parsePolicy(await this.http.get<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`));
  }

  /** Replace settings; omitted visibility is preserved and stale revisions return 409. */
  async replace(contactId: string, options: ReplaceContactCommunicationPolicy): Promise<ContactCommunicationPolicy> {
    if (options.visibility === null) throw new TypeError("visibility cannot be null; omit it to preserve existing settings");
    return parsePolicy(await this.http.put<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`, {
      expected_revision: options.expectedRevision, defaults: options.defaults,
      identities: options.identities.map((row) => ({ identity_id: row.identityId, email: row.email, phone: row.phone })),
      ...(options.visibility !== undefined ? { visibility: {
        defaults: options.visibility.defaults,
        identities: options.visibility.identities.map((row) => ({ identity_id: row.identityId, profile: row.profile, memories: row.memories })),
      } } : {}),
    }));
  }

  /** Preview a selected identity's contact view using admin credentials. */
  async preview(contactId: string, identityId: string): Promise<ContactCommunicationPreview> {
    return parsePreview(await this.http.get<RawPreview>(`/contacts/${encodeURIComponent(contactId)}/communication-preview`, { identity_id: identityId }));
  }

  /** List the contact permissions visible to the selected identity. */
  async listForIdentity(handle: string, options: { limit?: number; offset?: number } = {}): Promise<ContactCommunicationPolicyPage> {
    const raw = await this.http.get<{ items: RawPreview[]; limit: number; offset: number; has_more: boolean }>(
      `/identities/${encodeURIComponent(handle)}/contact-communication-policies`, options,
    );
    return { items: raw.items.map(parsePreview), limit: raw.limit, offset: raw.offset, hasMore: raw.has_more };
  }

  /** Manage contact permissions, including hidden contacts, using admin credentials. */
  async listManagementForIdentity(handle: string, options: ListContactPermissionsOptions = {}): Promise<ContactPermissionPage> {
    const raw = await this.http.get<{ items: RawPermissionEntry[]; limit: number; offset: number; has_more: boolean }>(
      `/identities/${encodeURIComponent(handle)}/contact-permissions`, {
        q: options.q, order: options.order, limit: options.limit, offset: options.offset, review_status: options.reviewStatus,
      },
    );
    return { limit: raw.limit, offset: raw.offset, hasMore: raw.has_more, items: raw.items.map((row) => ({
      contact: { id: row.contact.id, preferredName: row.contact.preferred_name,
        givenName: row.contact.given_name, familyName: row.contact.family_name, companyName: row.contact.company_name,
        reviewStatus: row.contact.review_status, emails: (row.contact.emails ?? []).map(parseContactEmail), phones: (row.contact.phones ?? []).map(parseContactPhone) },
      revision: row.revision, defaults: row.defaults, identityOverride: row.identity_override,
      visibility: { defaults: row.visibility.defaults, identityOverride: row.visibility.identity_override },
      effective: row.effective,
    })) };
  }
}

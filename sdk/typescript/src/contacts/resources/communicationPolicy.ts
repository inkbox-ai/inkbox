import { HttpTransport } from "../../_http.js";
import { type ContactAccessSettings, type RawContactAccessSettings, parseContactAccessSettings } from "./contactAccess.js";
import type { RuleDirection } from "../../contact_rules.js";
import { type Contact, type RawContact, type ContactReviewStatus, parseContact, parseContactEmail, parseContactPhone } from "../types.js";

/** An explicit exact-address choice overrides the agent's channel mode. */
export type ContactDecision = "inherit" | "allow" | "block";
export interface ContactAddressPermission {
  inboundAction?: ContactDecision;
  outboundAction?: ContactDecision;
  allowedInbound?: boolean;
  allowedOutbound?: boolean;
  kind: "email" | "phone";
  value: string;
  label: string | null;
  action: ContactDecision;
  allowed: boolean;
}
export interface ContactAddressUpdate {
  direction?: RuleDirection;
  expectedInboundAction?: ContactDecision;
  expectedOutboundAction?: ContactDecision;
  kind: "email" | "phone";
  value: string;
  action: ContactDecision;
  expectedAction?: ContactDecision;
}
/** Profile and dependent memory visibility decisions. */
export interface ContactVisibilityDecisions { profile: ContactDecision; memories: ContactDecision }
/** One identity's visibility overrides. */
export interface ContactIdentityVisibilityDecisions extends ContactVisibilityDecisions { identityId: string }
/** Complete visibility settings; omission on replacement preserves these settings. */
export interface ContactVisibilityPolicy {
  defaults: ContactVisibilityDecisions;
  identities: ContactIdentityVisibilityDecisions[];
}
/** Effective access, including groups without stored data. */
export interface ContactVisibilityResult { profile: boolean; memories: boolean }
export interface ContactCommunicationPolicy {
  contactId: string;
  revision: number;
  identityId: string | null;
  addresses: ContactAddressPermission[];
  effectiveVisibility: ContactVisibilityResult | null;
  visibility: ContactVisibilityPolicy;
}
export interface ReplaceContactCommunicationPolicy {
  expectedRevision: number;
  identityId: string;
  addresses: ContactAddressUpdate[];
  visibility?: ContactVisibilityPolicy;
}
export interface ContactCommunicationPreview {
  inboundEmail?: boolean;
  outboundEmail?: boolean;
  inboundPhone?: boolean;
  outboundPhone?: boolean;
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
  inboundEmail?: IdentifierPermission;
  outboundEmail?: IdentifierPermission;
  inboundPhone?: IdentifierPermission;
  outboundPhone?: IdentifierPermission;
  email: IdentifierPermission;
  phone: IdentifierPermission;
}
export interface ContactPermissionEntry {
  contact: ContactPermissionSummary;
  revision: number;
  visibility: ContactPermissionVisibility;
  effective: ContactPermissionEffective;
  access?: ContactAccessSettings | null;
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
interface RawPermissionEffective extends ContactPermissionEffective {
  inbound_email?: IdentifierPermission;
  outbound_email?: IdentifierPermission;
  inbound_phone?: IdentifierPermission;
  outbound_phone?: IdentifierPermission;
}
interface RawPermissionEntry {
  contact: Pick<RawContact, "id" | "preferred_name" | "given_name" | "family_name" | "company_name" | "emails" | "phones"> & { review_status: ContactReviewStatus };
  revision: number;
  visibility: { defaults: ContactVisibilityDecisions; identity_override: ContactVisibilityDecisions };
  effective: RawPermissionEffective;
  access?: RawContactAccessSettings | null;
}
interface RawPolicy {
  contact_id: string;
  revision: number;
  identity_id: string | null;
  addresses: (ContactAddressPermission & {
    inbound_action?: ContactDecision; outbound_action?: ContactDecision;
    allowed_inbound?: boolean; allowed_outbound?: boolean;
  })[];
  effective_visibility: ContactVisibilityResult | null;
  visibility: { defaults: ContactVisibilityDecisions; identities: (ContactVisibilityDecisions & { identity_id: string })[] };
}
interface RawPreview {
  inbound_email?: boolean;
  outbound_email?: boolean;
  inbound_phone?: boolean;
  outbound_phone?: boolean;
  identity_id: string;
  contact: RawContact | null;
  email: boolean;
  phone: boolean;
  full_profile: boolean;
  visibility: ContactVisibilityResult;
}
/** Parse both required policy portions. */
function parsePolicy(raw: RawPolicy): ContactCommunicationPolicy {
  return { contactId: raw.contact_id, revision: raw.revision, identityId: raw.identity_id,
    addresses: raw.addresses.map(({ inbound_action, outbound_action, allowed_inbound, allowed_outbound, ...row }) => ({
      ...row, inboundAction: inbound_action ?? row.action, outboundAction: outbound_action ?? row.action,
      allowedInbound: allowed_inbound ?? row.allowed, allowedOutbound: allowed_outbound ?? row.allowed,
    })), effectiveVisibility: raw.effective_visibility,
    visibility: { defaults: raw.visibility.defaults,
      identities: raw.visibility.identities.map((row) => ({ identityId: row.identity_id, profile: row.profile, memories: row.memories })) } };
}
/** Parse a filtered contact and independently reported visibility. */
function parsePreview(raw: RawPreview): ContactCommunicationPreview {
  return { identityId: raw.identity_id, contact: raw.contact ? parseContact(raw.contact) : null,
    inboundEmail: raw.inbound_email, outboundEmail: raw.outbound_email,
    inboundPhone: raw.inbound_phone, outboundPhone: raw.outbound_phone,
    email: raw.email, phone: raw.phone, fullProfile: raw.full_profile,
    visibility: raw.visibility };
}

/** Administrative communication settings and identity-scoped contact views. */
export class ContactCommunicationPolicyResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read the current policy and revision using admin credentials. */
  async get(contactId: string, identityId?: string): Promise<ContactCommunicationPolicy> {
    return parsePolicy(await this.http.get<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`, { identity_id: identityId }));
  }

  /** Replace settings; omitted visibility is preserved and stale revisions return 409. */
  async replace(contactId: string, options: ReplaceContactCommunicationPolicy): Promise<ContactCommunicationPolicy> {
    if (options.visibility === null) throw new TypeError("visibility cannot be null; omit it to preserve existing settings");
    if (options.visibility !== undefined) {
      const defaultsProfile = options.visibility.defaults.profile !== "block";
      if (!defaultsProfile && options.visibility.defaults.memories !== "block") {
        throw new Error("Profile cannot be disabled while memories is enabled");
      }
      const profiles = new Map<string, boolean>();
      for (const row of options.visibility.identities) {
        const profile = row.profile === "inherit" ? defaultsProfile : row.profile === "allow";
        const memories = row.memories === "inherit"
          ? options.visibility.defaults.memories !== "block"
          : row.memories === "allow";
        if (!profile && memories) throw new Error("Profile cannot be disabled while memories is enabled");
        profiles.set(row.identityId, profile);
      }
      if (!(profiles.get(options.identityId) ?? defaultsProfile) && options.addresses.some((row) => row.action === "allow")) {
        throw new Error("Profile cannot be disabled while email or phone is enabled");
      }
    }
    return parsePolicy(await this.http.put<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`, {
      expected_revision: options.expectedRevision, identity_id: options.identityId,
      addresses: options.addresses.map((row) => ({ kind: row.kind, value: row.value, action: row.action, expected_action: row.expectedAction,
        ...(row.direction !== undefined ? { direction: row.direction } : {}),
        ...(row.expectedInboundAction !== undefined ? { expected_inbound_action: row.expectedInboundAction } : {}),
        ...(row.expectedOutboundAction !== undefined ? { expected_outbound_action: row.expectedOutboundAction } : {}),
      })),
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
      revision: row.revision,
      visibility: { defaults: row.visibility.defaults, identityOverride: row.visibility.identity_override },
      effective: {
        profile: row.effective.profile, memories: row.effective.memories,
        email: row.effective.email, phone: row.effective.phone,
        inboundEmail: row.effective.inbound_email ?? row.effective.email,
        outboundEmail: row.effective.outbound_email ?? row.effective.email,
        inboundPhone: row.effective.inbound_phone ?? row.effective.phone,
        outboundPhone: row.effective.outbound_phone ?? row.effective.phone,
      },
      ...(row.access !== undefined ? { access: row.access === null ? null : parseContactAccessSettings(row.access) } : {}),
    })) };
  }
}

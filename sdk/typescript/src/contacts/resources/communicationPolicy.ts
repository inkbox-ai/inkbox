import { HttpTransport } from "../../_http.js";
import { type Contact, type RawContact, parseContact } from "../types.js";

/** An entry contributes to the identity's active whitelist or blacklist. */
export type ContactDecision = "inherit" | "allow" | "block";
/** Phone includes SMS, calls, and iMessage. */
export interface ContactChannelDecisions { email: ContactDecision; phone: ContactDecision }
export interface ContactIdentityDecisions extends ContactChannelDecisions { identityId: string }
export interface ContactCommunicationPolicy {
  contactId: string;
  revision: number;
  defaults: ContactChannelDecisions;
  identities: ContactIdentityDecisions[];
}
export interface ReplaceContactCommunicationPolicy {
  expectedRevision: number;
  defaults: ContactChannelDecisions;
  identities: ContactIdentityDecisions[];
}
export interface ContactCommunicationPreview {
  identityId: string;
  contact: Contact | null;
  email: boolean;
  phone: boolean;
  fullProfile: boolean;
}
export interface ContactCommunicationPolicyPage {
  items: ContactCommunicationPreview[];
  limit: number;
  offset: number;
  hasMore: boolean;
}
interface RawPolicy {
  contact_id: string;
  revision: number;
  defaults: ContactChannelDecisions;
  identities: (ContactChannelDecisions & { identity_id: string })[];
}
interface RawPreview {
  identity_id: string;
  contact: RawContact | null;
  email: boolean;
  phone: boolean;
  full_profile: boolean;
}
function parsePolicy(raw: RawPolicy): ContactCommunicationPolicy {
  return { contactId: raw.contact_id, revision: raw.revision, defaults: raw.defaults,
    identities: raw.identities.map((row) => ({ identityId: row.identity_id, email: row.email, phone: row.phone })) };
}
function parsePreview(raw: RawPreview): ContactCommunicationPreview {
  return { identityId: raw.identity_id, contact: raw.contact ? parseContact(raw.contact) : null,
    email: raw.email, phone: raw.phone, fullProfile: raw.full_profile };
}

/** Administrative communication settings and identity-scoped contact views. */
export class ContactCommunicationPolicyResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read the current policy and revision using admin credentials. */
  async get(contactId: string): Promise<ContactCommunicationPolicy> {
    return parsePolicy(await this.http.get<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`));
  }

  /** Replace the complete document; a stale revision returns HTTP 409. */
  async replace(contactId: string, options: ReplaceContactCommunicationPolicy): Promise<ContactCommunicationPolicy> {
    return parsePolicy(await this.http.put<RawPolicy>(`/contacts/${encodeURIComponent(contactId)}/communication-policy`, {
      expected_revision: options.expectedRevision, defaults: options.defaults,
      identities: options.identities.map((row) => ({ identity_id: row.identityId, email: row.email, phone: row.phone })),
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
}

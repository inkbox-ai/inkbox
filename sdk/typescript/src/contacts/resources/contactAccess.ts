/**
 * inkbox-contacts/resources/contactAccess.ts
 *
 * Selected-agent visibility and communication access, plus compatibility metadata.
 */

import { HttpTransport } from "../../_http.js";
import {
  ContactAccess,
  RawContactAccess,
  parseContactAccess,
} from "../types.js";

const BASE = "/contacts";

export interface ContactChannelAccess {
  visible: boolean;
  contactable: string[];
}

export interface ContactAccessSettings {
  email: ContactChannelAccess;
  phone: ContactChannelAccess;
  profile: boolean;
  memories: boolean;
}

/** Omit unchanged fields; an empty contactable list blocks all current addresses. */
export type ContactChannelAccessUpdate = Partial<ContactChannelAccess>;

export interface UpdateContactAccess {
  email?: ContactChannelAccessUpdate;
  phone?: ContactChannelAccessUpdate;
  profile?: boolean;
  memories?: boolean;
}

export class ContactAccessResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read group visibility and contactable addresses using admin credentials. */
  async get(handle: string, contactId: string): Promise<ContactAccessSettings> {
    return this.http.get(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/access`);
  }

  /** Save partial access choices; hiding Profile also hides omitted groups. */
  async update(handle: string, contactId: string, options: UpdateContactAccess): Promise<ContactAccessSettings> {
    return this.http.patch(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/access`, options);
  }

  /**
   * List deprecated read-only compatibility metadata for a contact.
   * Communication policies, not these records, control contact visibility.
   */
  async list(contactId: string): Promise<ContactAccess[]> {
    const data = await this.http.get<
      { items: RawContactAccess[] } | RawContactAccess[]
    >(`${BASE}/${contactId}/access`);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContactAccess);
  }
}

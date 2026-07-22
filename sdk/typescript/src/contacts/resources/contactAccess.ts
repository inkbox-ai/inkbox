/**
 * inkbox-contacts/resources/contactAccess.ts
 *
 * Deprecated read-only compatibility metadata that does not restrict
 * organization-wide contact visibility.
 */

import { HttpTransport } from "../../_http.js";
import {
  ContactAccess,
  RawContactAccess,
  parseContactAccess,
} from "../types.js";

const BASE = "/contacts";

export class ContactAccessResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List deprecated read-only compatibility metadata for a contact.
   * These records do not restrict organization-wide contact visibility.
   */
  async list(contactId: string): Promise<ContactAccess[]> {
    const data = await this.http.get<
      { items: RawContactAccess[] } | RawContactAccess[]
    >(`${BASE}/${contactId}/access`);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContactAccess);
  }
}

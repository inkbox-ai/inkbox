/**
 * inkbox-contacts/resources/contactAccess.ts
 *
 * Per-contact access information.
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

  async list(contactId: string): Promise<ContactAccess[]> {
    const data = await this.http.get<
      { items: RawContactAccess[] } | RawContactAccess[]
    >(`${BASE}/${contactId}/access`);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContactAccess);
  }
}

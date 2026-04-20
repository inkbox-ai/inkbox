/**
 * inkbox-contacts/resources/contactAccess.ts
 *
 * Per-contact access grant management.
 */

import { HttpTransport } from "../../_http.js";
import {
  ContactAccess,
  RawContactAccess,
  parseContactAccess,
} from "../types.js";

const BASE = "/contacts";

export interface GrantContactAccessOptions {
  /** Identity UUID to grant. Mutually exclusive with `wildcard`. */
  identityId?: string;
  /** When true, reset to a wildcard grant (every active identity sees it). */
  wildcard?: boolean;
}

export class ContactAccessResource {
  constructor(private readonly http: HttpTransport) {}

  async list(contactId: string): Promise<ContactAccess[]> {
    const data = await this.http.get<
      { items: RawContactAccess[] } | RawContactAccess[]
    >(`${BASE}/${contactId}/access`);
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContactAccess);
  }

  async grant(
    contactId: string,
    options: GrantContactAccessOptions,
  ): Promise<ContactAccess> {
    if (options.wildcard && options.identityId !== undefined) {
      throw new Error("Pass either identityId or wildcard: true, not both.");
    }
    const body: Record<string, unknown> = {
      identity_id: options.wildcard ? null : options.identityId ?? null,
    };
    const data = await this.http.post<RawContactAccess>(
      `${BASE}/${contactId}/access`,
      body,
    );
    return parseContactAccess(data);
  }

  async revoke(contactId: string, identityId: string): Promise<void> {
    await this.http.delete(`${BASE}/${contactId}/access/${identityId}`);
  }
}

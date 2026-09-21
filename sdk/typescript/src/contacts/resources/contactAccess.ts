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
  /** Legacy read projection: addresses the agent may send to. */
  contactable: string[];
  inboundContactable?: string[];
  outboundContactable?: string[];
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

/** @internal */
export interface RawContactAccessSettings extends Omit<ContactAccessSettings, "email" | "phone"> {
  email: ContactChannelAccess & { inbound_contactable?: string[]; outbound_contactable?: string[] };
  phone: ContactChannelAccess & { inbound_contactable?: string[]; outbound_contactable?: string[] };
}

/** @internal */
export function parseContactAccessSettings(raw: RawContactAccessSettings): ContactAccessSettings {
  const group = (value: RawContactAccessSettings["email"]): ContactChannelAccess => ({
    visible: value.visible,
    contactable: value.contactable,
    inboundContactable: value.inbound_contactable ?? value.contactable,
    outboundContactable: value.outbound_contactable ?? value.contactable,
  });
  return { profile: raw.profile, memories: raw.memories, email: group(raw.email), phone: group(raw.phone) };
}

/** @internal */
export function contactAccessToWire(options: UpdateContactAccess): Record<string, unknown> {
  const result: Record<string, unknown> = { ...options };
  let enabled = options.memories === true;
  for (const channel of ["email", "phone"] as const) {
    const group = options[channel];
    if (group === undefined) continue;
    if (group === null || Object.values(group).some((value) => value === null)) {
      throw new TypeError("Contact access settings cannot be null");
    }
    if (group.contactable !== undefined && (group.inboundContactable !== undefined || group.outboundContactable !== undefined)) {
      throw new TypeError("contactable cannot be combined with directional contactable lists");
    }
    const contactable = [group.contactable, group.inboundContactable, group.outboundContactable].some((values) => Boolean(values?.length));
    if (group.visible === false && contactable) throw new TypeError("Hidden addresses cannot be contactable");
    enabled ||= group.visible === true || contactable;
    const { inboundContactable, outboundContactable, ...shared } = group;
    result[channel] = {
      ...shared,
      ...(inboundContactable !== undefined ? { inbound_contactable: inboundContactable } : {}),
      ...(outboundContactable !== undefined ? { outbound_contactable: outboundContactable } : {}),
    };
  }
  if (options.profile === null || options.memories === null) throw new TypeError("Contact access settings cannot be null");
  if (options.profile === false && enabled) throw new Error("Profile cannot be disabled while email, phone, or memories is enabled");
  return result;
}

export class ContactAccessResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read group visibility and contactable addresses using admin credentials. */
  async get(handle: string, contactId: string): Promise<ContactAccessSettings> {
    return parseContactAccessSettings(await this.http.get(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/access`));
  }

  /** Save partial access choices; hiding Profile also hides omitted groups. */
  async update(handle: string, contactId: string, options: UpdateContactAccess): Promise<ContactAccessSettings> {
    const body = contactAccessToWire(options);
    return parseContactAccessSettings(await this.http.patch(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/access`, body));
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

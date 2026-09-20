import { HttpTransport } from "../../_http.js";

/** Effective yes/no access for one agent and contact. Phone covers SMS, calls, and iMessage. */
export interface ContactPermissions {
  emails: Record<string, boolean>;
  phones: Record<string, boolean>;
  inboundEmails?: Record<string, boolean>;
  outboundEmails?: Record<string, boolean>;
  inboundPhones?: Record<string, boolean>;
  outboundPhones?: Record<string, boolean>;
  profile: boolean;
  memories: boolean;
}

/** Omitted fields and addresses keep their existing settings. */
export type UpdateContactPermissions = Partial<ContactPermissions>;

interface RawContactPermissions {
  emails: Record<string, boolean>;
  phones: Record<string, boolean>;
  inbound_emails?: Record<string, boolean>;
  outbound_emails?: Record<string, boolean>;
  inbound_phones?: Record<string, boolean>;
  outbound_phones?: Record<string, boolean>;
  profile: boolean;
  memories: boolean;
}

function parseContactPermissions(raw: RawContactPermissions): ContactPermissions {
  return {
    emails: { ...(raw.outbound_emails ?? raw.emails) },
    phones: { ...(raw.outbound_phones ?? raw.phones) },
    inboundEmails: { ...(raw.inbound_emails ?? raw.emails) },
    outboundEmails: { ...(raw.outbound_emails ?? raw.emails) },
    inboundPhones: { ...(raw.inbound_phones ?? raw.phones) },
    outboundPhones: { ...(raw.outbound_phones ?? raw.phones) },
    profile: raw.profile,
    memories: raw.memories,
  };
}

/** @internal Used for updates and atomic initial permissions. */
export function contactPermissionsToWire(options: UpdateContactPermissions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  let enabled = options.memories === true;
  for (const [shared, inbound, outbound] of [
    ["emails", "inboundEmails", "outboundEmails"],
    ["phones", "inboundPhones", "outboundPhones"],
  ] as const) {
    if (options[shared] !== undefined && (options[inbound] !== undefined || options[outbound] !== undefined)) {
      throw new TypeError(`Cannot combine shared and directional ${shared}`);
    }
    for (const [key, wire] of [[shared, shared], [inbound, `inbound_${shared}`], [outbound, `outbound_${shared}`]] as const) {
      const values = options[key];
      if (values === undefined) continue;
      if (values === null || typeof values !== "object" || Array.isArray(values)
        || Object.values(values).some((value) => typeof value !== "boolean")) {
        throw new TypeError(`${key} must be an address-to-boolean object`);
      }
      if (Object.keys(values).length > 50) throw new RangeError(`${key} cannot exceed 50 entries`);
      enabled ||= Object.values(values).some(Boolean);
      body[wire] = values;
    }
  }
  for (const key of ["profile", "memories"] as const) {
    if (options[key] === undefined) continue;
    if (typeof options[key] !== "boolean") throw new TypeError(`${key} must be true or false`);
    body[key] = options[key];
  }
  if (options.profile === false && enabled) throw new Error("Profile cannot be disabled while email, phone, or memories is enabled");
  return body;
}

export class ContactPermissionsResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read effective access using admin credentials. */
  async get(handle: string, contactId: string): Promise<ContactPermissions> {
    return parseContactPermissions(await this.http.get(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/permissions`));
  }

  /** Save explicit yes/no choices using admin credentials. */
  async update(handle: string, contactId: string, options: UpdateContactPermissions): Promise<ContactPermissions> {
    const body = contactPermissionsToWire(options);
    return parseContactPermissions(await this.http.patch(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/permissions`, body));
  }
}

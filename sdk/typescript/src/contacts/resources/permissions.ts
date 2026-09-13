import { HttpTransport } from "../../_http.js";

/** Effective yes/no access for one agent and contact. Phone covers SMS, calls, and iMessage. */
export interface ContactPermissions {
  emails: Record<string, boolean>;
  phones: Record<string, boolean>;
  profile: boolean;
  memories: boolean;
}

/** Omitted fields and addresses keep their existing settings. */
export type UpdateContactPermissions = Partial<ContactPermissions>;

export class ContactPermissionsResource {
  constructor(private readonly http: HttpTransport) {}

  /** Read effective access using admin credentials. */
  async get(handle: string, contactId: string): Promise<ContactPermissions> {
    return this.http.get(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/permissions`);
  }

  /** Save explicit yes/no choices using admin credentials. */
  async update(handle: string, contactId: string, options: UpdateContactPermissions): Promise<ContactPermissions> {
    return this.http.patch(`/identities/${encodeURIComponent(handle)}/contacts/${encodeURIComponent(contactId)}/permissions`, options);
  }
}

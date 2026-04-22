/**
 * inkbox-contacts/resources/contacts.ts
 *
 * Contacts CRUD + search + lookup.
 */

import { HttpTransport } from "../../_http.js";
import { ContactAccessResource } from "./contactAccess.js";
import { VCardsResource } from "./vcards.js";
import {
  Contact,
  ContactAddress,
  ContactCustomField,
  ContactDate,
  ContactEmail,
  ContactPhone,
  ContactWebsite,
  RawContact,
  contactAddressToWire,
  contactCustomFieldToWire,
  contactDateToWire,
  contactEmailToWire,
  contactPhoneToWire,
  contactWebsiteToWire,
  parseContact,
} from "../types.js";

const BASE = "/contacts";

export interface ListContactsOptions {
  q?: string;
  order?: "name" | "recent" | string;
  limit?: number;
  offset?: number;
}

export interface LookupContactsOptions {
  email?: string;
  emailContains?: string;
  emailDomain?: string;
  phone?: string;
  phoneContains?: string;
}

export interface CreateContactOptions {
  preferredName?: string;
  namePrefix?: string;
  givenName?: string;
  middleName?: string;
  familyName?: string;
  nameSuffix?: string;
  companyName?: string;
  jobTitle?: string;
  /** ISO date (YYYY-MM-DD). */
  birthday?: string;
  notes?: string;
  emails?: ContactEmail[];
  phones?: ContactPhone[];
  websites?: ContactWebsite[];
  dates?: ContactDate[];
  addresses?: ContactAddress[];
  customFields?: ContactCustomField[];
  /**
   * Access control at create time.
   *   - `undefined` (default) / `"wildcard"` — one wildcard row, every active
   *     identity sees the contact.
   *   - `[]` — zero grants (only admin + human callers see it).
   *   - Explicit list of identity UUIDs — one per-identity grant each. Capped
   *     at 500 entries server-side.
   */
  accessIdentityIds?: string[] | "wildcard" | null;
}

export interface UpdateContactOptions {
  preferredName?: string | null;
  namePrefix?: string | null;
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  nameSuffix?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  /** ISO date (YYYY-MM-DD) or null to clear. */
  birthday?: string | null;
  notes?: string | null;
  emails?: ContactEmail[] | null;
  phones?: ContactPhone[] | null;
  websites?: ContactWebsite[] | null;
  dates?: ContactDate[] | null;
  addresses?: ContactAddress[] | null;
  customFields?: ContactCustomField[] | null;
}

export class ContactsResource {
  readonly access: ContactAccessResource;
  readonly vcards: VCardsResource;

  constructor(private readonly http: HttpTransport) {
    this.access = new ContactAccessResource(http);
    this.vcards = new VCardsResource(http);
  }

  async list(options: ListContactsOptions = {}): Promise<Contact[]> {
    const params: Record<string, string | number | undefined> = {};
    if (options.q !== undefined) params.q = options.q;
    if (options.order !== undefined) params.order = options.order;
    if (options.limit !== undefined) params.limit = options.limit;
    if (options.offset !== undefined) params.offset = options.offset;
    const data = await this.http.get<{ items: RawContact[] } | RawContact[]>(
      BASE,
      params,
    );
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContact);
  }

  async lookup(options: LookupContactsOptions): Promise<Contact[]> {
    const supplied: Record<string, string | undefined> = {
      email: options.email,
      email_contains: options.emailContains,
      email_domain: options.emailDomain,
      phone: options.phone,
      phone_contains: options.phoneContains,
    };
    const nonNil = Object.entries(supplied).filter(([, v]) => v !== undefined);
    if (nonNil.length !== 1) {
      throw new Error(
        "lookup() requires exactly one of: email, emailContains, emailDomain, phone, phoneContains.",
      );
    }
    const params = Object.fromEntries(nonNil);
    const data = await this.http.get<{ items: RawContact[] } | RawContact[]>(
      `${BASE}/lookup`,
      params,
    );
    const items = Array.isArray(data) ? data : data.items;
    return items.map(parseContact);
  }

  async get(contactId: string): Promise<Contact> {
    const data = await this.http.get<RawContact>(`${BASE}/${contactId}`);
    return parseContact(data);
  }

  async create(options: CreateContactOptions = {}): Promise<Contact> {
    const body: Record<string, unknown> = {};
    if (options.preferredName !== undefined) body.preferred_name = options.preferredName;
    if (options.namePrefix !== undefined) body.name_prefix = options.namePrefix;
    if (options.givenName !== undefined) body.given_name = options.givenName;
    if (options.middleName !== undefined) body.middle_name = options.middleName;
    if (options.familyName !== undefined) body.family_name = options.familyName;
    if (options.nameSuffix !== undefined) body.name_suffix = options.nameSuffix;
    if (options.companyName !== undefined) body.company_name = options.companyName;
    if (options.jobTitle !== undefined) body.job_title = options.jobTitle;
    if (options.birthday !== undefined) body.birthday = options.birthday;
    if (options.notes !== undefined) body.notes = options.notes;
    if (options.emails !== undefined) body.emails = options.emails.map(contactEmailToWire);
    if (options.phones !== undefined) body.phones = options.phones.map(contactPhoneToWire);
    if (options.websites !== undefined) body.websites = options.websites.map(contactWebsiteToWire);
    if (options.dates !== undefined) body.dates = options.dates.map(contactDateToWire);
    if (options.addresses !== undefined) body.addresses = options.addresses.map(contactAddressToWire);
    if (options.customFields !== undefined) body.custom_fields = options.customFields.map(contactCustomFieldToWire);
    if (options.accessIdentityIds === undefined || options.accessIdentityIds === "wildcard") {
      // omit — server wildcards by default
    } else if (options.accessIdentityIds === null) {
      body.access_identity_ids = null;
    } else {
      body.access_identity_ids = options.accessIdentityIds;
    }
    const data = await this.http.post<RawContact>(BASE, body);
    return parseContact(data);
  }

  async update(contactId: string, options: UpdateContactOptions): Promise<Contact> {
    const body: Record<string, unknown> = {};
    for (const [key, wire] of [
      ["preferredName", "preferred_name"],
      ["namePrefix", "name_prefix"],
      ["givenName", "given_name"],
      ["middleName", "middle_name"],
      ["familyName", "family_name"],
      ["nameSuffix", "name_suffix"],
      ["companyName", "company_name"],
      ["jobTitle", "job_title"],
      ["birthday", "birthday"],
      ["notes", "notes"],
    ] as const) {
      if (key in options) body[wire] = (options as Record<string, unknown>)[key];
    }
    if ("emails" in options) {
      body.emails = options.emails === null ? null : options.emails!.map(contactEmailToWire);
    }
    if ("phones" in options) {
      body.phones = options.phones === null ? null : options.phones!.map(contactPhoneToWire);
    }
    if ("websites" in options) {
      body.websites = options.websites === null ? null : options.websites!.map(contactWebsiteToWire);
    }
    if ("dates" in options) {
      body.dates = options.dates === null ? null : options.dates!.map(contactDateToWire);
    }
    if ("addresses" in options) {
      body.addresses = options.addresses === null ? null : options.addresses!.map(contactAddressToWire);
    }
    if ("customFields" in options) {
      body.custom_fields =
        options.customFields === null ? null : options.customFields!.map(contactCustomFieldToWire);
    }
    const data = await this.http.patch<RawContact>(`${BASE}/${contactId}`, body);
    return parseContact(data);
  }

  async delete(contactId: string): Promise<void> {
    await this.http.delete(`${BASE}/${contactId}`);
  }
}

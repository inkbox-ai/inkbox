/**
 * inkbox-contacts TypeScript SDK — public types.
 */

export interface ContactEmail {
  label: string | null;
  value: string;
  isPrimary: boolean;
}

export interface ContactPhone {
  label: string | null;
  value: string;
  isPrimary: boolean;
}

export interface ContactWebsite {
  label: string | null;
  value: string;
}

export interface ContactDate {
  label: string | null;
  /** ISO date (YYYY-MM-DD). */
  value: string;
}

export interface ContactAddress {
  label: string | null;
  street: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  country: string | null;
}

export interface ContactCustomField {
  label: string;
  value: string;
}

export interface ContactAccess {
  id: string;
  contactId: string;
  /** null = wildcard grant (every active identity sees the contact) */
  identityId: string | null;
  createdAt: Date;
}

export interface Contact {
  id: string;
  organizationId: string | null;
  preferredName: string | null;
  namePrefix: string | null;
  givenName: string | null;
  middleName: string | null;
  familyName: string | null;
  nameSuffix: string | null;
  companyName: string | null;
  jobTitle: string | null;
  /** ISO date (YYYY-MM-DD), or null. */
  birthday: string | null;
  notes: string | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  websites: ContactWebsite[];
  dates: ContactDate[];
  addresses: ContactAddress[];
  customFields: ContactCustomField[];
  access: ContactAccess[];
  status: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * One card's result inside a bulk vCard import response.
 *
 * `contact` is populated when `status === "created"` (and `error` is null);
 * `error` is populated when `status === "error"` (and `contact` is null).
 */
export interface ContactImportResultItem {
  /** 0-based position within the uploaded vCard stream. */
  index: number;
  status: "created" | "error";
  contact: Contact | null;
  error: string | null;
}

export interface ContactImportResult {
  createdCount: number;
  errorCount: number;
  /** Per-card outcome in submission order. */
  results: ContactImportResultItem[];
  /** Convenience: IDs of contacts that were created, in submission order. */
  readonly createdIds: string[];
  /** Convenience: per-card entries where `status === "error"`. */
  readonly errors: ContactImportResultItem[];
}

// ---- wire types ----

export interface RawContactEmail {
  label?: string | null;
  value: string;
  is_primary?: boolean;
}

export interface RawContactPhone {
  label?: string | null;
  value_e164: string;
  is_primary?: boolean;
}

export interface RawContactWebsite {
  label?: string | null;
  url: string;
}

export interface RawContactDate {
  label?: string | null;
  date: string;
}

export interface RawContactAddress {
  label?: string | null;
  street?: string | null;
  city?: string | null;
  region?: string | null;
  postal?: string | null;
  country?: string | null;
}

export interface RawContactCustomField {
  label: string;
  value: string;
}

export interface RawContactAccess {
  id: string;
  contact_id: string;
  identity_id: string | null;
  created_at: string;
}

export interface RawContact {
  id: string;
  organization_id?: string | null;
  preferred_name: string | null;
  name_prefix?: string | null;
  given_name: string | null;
  middle_name?: string | null;
  family_name: string | null;
  name_suffix?: string | null;
  company_name: string | null;
  job_title: string | null;
  birthday?: string | null;
  notes: string | null;
  emails: RawContactEmail[] | null;
  phones: RawContactPhone[] | null;
  websites: RawContactWebsite[] | null;
  dates: RawContactDate[] | null;
  addresses: RawContactAddress[] | null;
  custom_fields: RawContactCustomField[] | null;
  access: RawContactAccess[] | null;
  status?: string | null;
  created_at: string;
  updated_at: string;
}

export interface RawContactImportResultItem {
  index: number;
  status: "created" | "error";
  contact?: RawContact | null;
  error?: string | null;
}

export interface RawContactImportResult {
  created_count: number;
  error_count: number;
  results?: RawContactImportResultItem[] | null;
}

// ---- parsers ----

export function parseContactEmail(r: RawContactEmail): ContactEmail {
  return {
    label: r.label ?? null,
    value: r.value,
    isPrimary: Boolean(r.is_primary),
  };
}

export function parseContactPhone(r: RawContactPhone): ContactPhone {
  return {
    label: r.label ?? null,
    value: r.value_e164,
    isPrimary: Boolean(r.is_primary),
  };
}

export function parseContactWebsite(r: RawContactWebsite): ContactWebsite {
  return { label: r.label ?? null, value: r.url };
}

export function parseContactDate(r: RawContactDate): ContactDate {
  return { label: r.label ?? null, value: r.date };
}

export function parseContactAddress(r: RawContactAddress): ContactAddress {
  return {
    label: r.label ?? null,
    street: r.street ?? null,
    city: r.city ?? null,
    region: r.region ?? null,
    postalCode: r.postal ?? null,
    country: r.country ?? null,
  };
}

export function parseContactCustomField(
  r: RawContactCustomField,
): ContactCustomField {
  return { label: r.label, value: r.value };
}

export function parseContactAccess(r: RawContactAccess): ContactAccess {
  return {
    id: r.id,
    contactId: r.contact_id,
    identityId: r.identity_id,
    createdAt: new Date(r.created_at),
  };
}

export function parseContact(r: RawContact): Contact {
  return {
    id: r.id,
    organizationId: r.organization_id ?? null,
    preferredName: r.preferred_name,
    namePrefix: r.name_prefix ?? null,
    givenName: r.given_name,
    middleName: r.middle_name ?? null,
    familyName: r.family_name,
    nameSuffix: r.name_suffix ?? null,
    companyName: r.company_name,
    jobTitle: r.job_title,
    birthday: r.birthday ?? null,
    notes: r.notes,
    emails: (r.emails ?? []).map(parseContactEmail),
    phones: (r.phones ?? []).map(parseContactPhone),
    websites: (r.websites ?? []).map(parseContactWebsite),
    dates: (r.dates ?? []).map(parseContactDate),
    addresses: (r.addresses ?? []).map(parseContactAddress),
    customFields: (r.custom_fields ?? []).map(parseContactCustomField),
    access: (r.access ?? []).map(parseContactAccess),
    status: r.status ?? null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseContactImportResultItem(
  r: RawContactImportResultItem,
): ContactImportResultItem {
  return {
    index: r.index,
    status: r.status,
    contact: r.contact ? parseContact(r.contact) : null,
    error: r.error ?? null,
  };
}

export function parseContactImportResult(
  r: RawContactImportResult,
): ContactImportResult {
  const results = (r.results ?? []).map(parseContactImportResultItem);
  return {
    createdCount: r.created_count,
    errorCount: r.error_count,
    results,
    get createdIds() {
      return results
        .filter((i) => i.status === "created" && i.contact !== null)
        .map((i) => i.contact!.id);
    },
    get errors() {
      return results.filter((i) => i.status === "error");
    },
  };
}

// ---- wire encoders ----

export function contactEmailToWire(e: ContactEmail): RawContactEmail {
  const out: RawContactEmail = { value: e.value };
  if (e.label !== null) out.label = e.label;
  if (e.isPrimary) out.is_primary = true;
  return out;
}

export function contactPhoneToWire(p: ContactPhone): RawContactPhone {
  const out: RawContactPhone = { value_e164: p.value };
  if (p.label !== null) out.label = p.label;
  if (p.isPrimary) out.is_primary = true;
  return out;
}

export function contactWebsiteToWire(w: ContactWebsite): RawContactWebsite {
  const out: RawContactWebsite = { url: w.value };
  if (w.label !== null) out.label = w.label;
  return out;
}

export function contactDateToWire(d: ContactDate): RawContactDate {
  const out: RawContactDate = { date: d.value };
  if (d.label !== null) out.label = d.label;
  return out;
}

export function contactAddressToWire(a: ContactAddress): RawContactAddress {
  const out: RawContactAddress = {};
  if (a.label !== null) out.label = a.label;
  if (a.street !== null) out.street = a.street;
  if (a.city !== null) out.city = a.city;
  if (a.region !== null) out.region = a.region;
  if (a.postalCode !== null) out.postal = a.postalCode;
  if (a.country !== null) out.country = a.country;
  return out;
}

export function contactCustomFieldToWire(
  c: ContactCustomField,
): RawContactCustomField {
  return { label: c.label, value: c.value };
}

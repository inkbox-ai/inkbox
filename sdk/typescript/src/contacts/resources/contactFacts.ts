import { HttpTransport } from "../../_http.js";
import {
  ContactFact,
  ContactFactCitationDetail,
  ContactFactDeleteResult,
  ContactFactKind,
  RawContactFact,
  RawContactFactCitationDetail,
  RawContactFactDeleteResult,
  parseContactFact,
  parseContactFactCitationDetail,
  parseContactFactDeleteResult,
} from "../facts.js";

const BASE = "/contacts";

export interface ListContactFactsOptions {
  /** Also return expired context facts. Locked facts remain active and are returned by default. */
  includeExpired?: boolean;
}

export interface CreateContactFactOptions {
  content: string;
  kind: ContactFactKind;
}

export interface UpdateContactFactOptions {
  content?: string;
  kind?: ContactFactKind;
}

export class ContactFactsResource {
  constructor(private readonly http: HttpTransport) {}

  async list(
    contactId: string,
    options: ListContactFactsOptions = {},
  ): Promise<ContactFact[]> {
    const data = await this.http.get<RawContactFact[]>(
      `${BASE}/${contactId}/facts`,
      options.includeExpired ? { include_expired: true } : undefined,
    );
    return data.map(parseContactFact);
  }

  /**
   * Record a fact by hand. Requires an admin-scoped API key; an agent-scoped
   * key is rejected with 403.
   *
   * Hand-written facts never expire, whatever their kind. The call fails with
   * 409 when the contact is already at its limit for that kind.
   */
  async create(
    contactId: string,
    options: CreateContactFactOptions,
  ): Promise<ContactFact> {
    const data = await this.http.post<RawContactFact>(`${BASE}/${contactId}/facts`, {
      content: options.content,
      kind: options.kind,
    });
    return parseContactFact(data);
  }

  /**
   * Edit a fact's content or kind. Requires an admin-scoped API key; an
   * agent-scoped key is rejected with 403.
   *
   * At least one of `content` and `kind` is required. Any edit makes the fact
   * user-authored, clears its expiry, and revives it if it had expired. Editing
   * content also drops the citations and confidence recorded for the old
   * wording; editing only the kind leaves them in place.
   */
  async update(
    contactId: string,
    factId: string,
    options: UpdateContactFactOptions,
  ): Promise<ContactFact> {
    const body: Record<string, unknown> = {};
    if (options.content !== undefined) body.content = options.content;
    if (options.kind !== undefined) body.kind = options.kind;
    if (Object.keys(body).length === 0) {
      throw new Error("update() requires content or kind");
    }
    const data = await this.http.patch<RawContactFact>(
      `${BASE}/${contactId}/facts/${factId}`,
      body,
    );
    return parseContactFact(data);
  }

  async get(contactId: string, factId: string): Promise<ContactFact> {
    const data = await this.http.get<RawContactFact>(
      `${BASE}/${contactId}/facts/${factId}`,
    );
    return parseContactFact(data);
  }

  async resolveCitation(
    contactId: string,
    factId: string,
    citationId: string,
  ): Promise<ContactFactCitationDetail> {
    const data = await this.http.get<RawContactFactCitationDetail>(
      `${BASE}/${contactId}/facts/${factId}/citations/${citationId}`,
    );
    return parseContactFactCitationDetail(data);
  }

  async resolveCitationUrl(sourceUrl: string): Promise<ContactFactCitationDetail> {
    const path = sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://")
      ? (() => {
          const parsed = new URL(sourceUrl);
          return `${parsed.pathname}${parsed.search}`;
        })()
      : sourceUrl;
    const relativePath = path.startsWith("/api/v1/") ? path.slice("/api/v1".length) : path;
    if (!relativePath.startsWith("/contacts/")) {
      throw new Error("sourceUrl must be a contact citation URL");
    }
    const data = await this.http.get<RawContactFactCitationDetail>(relativePath);
    return parseContactFactCitationDetail(data);
  }

  /** Delete a fact using an admin-scoped API key. */
  async delete(contactId: string, factId: string): Promise<ContactFactDeleteResult> {
    const data = await this.http.deleteWithResponse<RawContactFactDeleteResult>(
      `${BASE}/${contactId}/facts/${factId}`,
    );
    return parseContactFactDeleteResult(data);
  }
}

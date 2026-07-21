import { HttpTransport } from "../../_http.js";
import {
  ContactFact,
  ContactFactCitationDetail,
  ContactFactDeleteResult,
  RawContactFact,
  RawContactFactCitationDetail,
  RawContactFactDeleteResult,
  parseContactFact,
  parseContactFactCitationDetail,
  parseContactFactDeleteResult,
} from "../facts.js";

const BASE = "/contacts";

export class ContactFactsResource {
  constructor(private readonly http: HttpTransport) {}

  async list(contactId: string): Promise<ContactFact[]> {
    const data = await this.http.get<RawContactFact[]>(`${BASE}/${contactId}/facts`);
    return data.map(parseContactFact);
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

  async delete(contactId: string, factId: string): Promise<ContactFactDeleteResult> {
    const data = await this.http.deleteWithResponse<RawContactFactDeleteResult>(
      `${BASE}/${contactId}/facts/${factId}`,
    );
    return parseContactFactDeleteResult(data);
  }
}

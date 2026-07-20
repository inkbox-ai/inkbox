import { HttpTransport } from "../../_http.js";
import {
  ContactFact,
  ContactFactCitationDetail,
  RawContactFact,
  RawContactFactCitationDetail,
  parseContactFact,
  parseContactFactCitationDetail,
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
}

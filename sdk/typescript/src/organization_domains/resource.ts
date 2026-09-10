import type { HttpTransport } from "../_http.js";
import { parseOrganizationDomain } from "./types.js";
import type { OrganizationDomain, OrganizationDomainPage } from "./types.js";

type Raw = Record<string, any>;

export class OrganizationDomainsResource {
  constructor(private readonly http: HttpTransport) {}

  async create(domain: string): Promise<OrganizationDomain> {
    return parseOrganizationDomain(await this.http.post<Raw>("/organization-domains", { domain }));
  }

  async list(options: { cursor?: string; limit?: number } = {}): Promise<OrganizationDomainPage> {
    const data = await this.http.get<Raw>("/organization-domains", { cursor: options.cursor, limit: options.limit ?? 50 });
    return { items: data.items.map(parseOrganizationDomain), nextCursor: data.next_cursor ?? null };
  }

  async get(claimId: string): Promise<OrganizationDomain> {
    return parseOrganizationDomain(await this.http.get<Raw>(`/organization-domains/${encodeURIComponent(claimId)}`));
  }

  async verify(claimId: string): Promise<OrganizationDomain> {
    return parseOrganizationDomain(await this.http.post<Raw>(`/organization-domains/${encodeURIComponent(claimId)}/verify`));
  }

  async transfer(claimId: string): Promise<OrganizationDomain> {
    return parseOrganizationDomain(await this.http.post<Raw>(`/organization-domains/${encodeURIComponent(claimId)}/transfer`));
  }

  async delete(claimId: string): Promise<void> {
    await this.http.delete(`/organization-domains/${encodeURIComponent(claimId)}`);
  }
}

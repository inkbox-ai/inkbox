/**
 * inkbox-mail/resources/domains.ts
 *
 * Custom sending-domain operations exposed via `inkbox.domains`.
 *
 * Limited to the read-and-default surface: list, set the org default.
 * Domain registration, DNS-record retrieval, verification, DKIM
 * rotation, and deletion stay in the console.
 */

import { HttpTransport } from "../../_http.js";
import {
  Domain,
  RawDomain,
  RawSetDefaultDomainResponse,
  SendingDomainStatus,
  parseDomain,
} from "../types.js";

export class DomainsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * List custom sending domains registered to your organisation.
   *
   * @param options.status - Optional status filter (e.g. only verified).
   */
  async list(options?: { status?: SendingDomainStatus }): Promise<Domain[]> {
    const data = await this.http.get<RawDomain[]>(
      "/",
      options?.status !== undefined ? { status: options.status } : undefined,
    );
    return data.map(parseDomain);
  }

  /**
   * Set the organisation's default sending domain.
   *
   * Pass the **bare domain name** (e.g. `"mail.acme.com"`), not the row id.
   * Pass the platform sending domain for the target environment
   * (e.g. `"inkboxmail.com"` in production) to clear the org default and
   * revert to the platform domain.
   *
   * Requires an **admin-scoped API key**. Non-admin keys receive 403.
   *
   * @returns The bare new default domain name, or `null` when the org has
   *   reverted to the platform default. Never a row id.
   */
  async setDefault(domainName: string): Promise<string | null> {
    const path = `/${encodeURIComponent(domainName)}/set-default`;
    const data = await this.http.post<RawSetDefaultDomainResponse>(path, {});
    return data.default_domain;
  }
}

// sdk/typescript/tests/mail/domains.test.ts
import { describe, it, expect, vi } from "vitest";
import { DomainsResource } from "../../src/mail/resources/domains.js";
import type { HttpTransport } from "../../src/_http.js";
import { SendingDomainStatus, parseDomain } from "../../src/mail/types.js";
import { RAW_DOMAIN_VERIFIED, RAW_DOMAIN_PENDING } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

describe("DomainsResource.list", () => {
  it("returns array of parsed domains", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_DOMAIN_VERIFIED, RAW_DOMAIN_PENDING]);
    const res = new DomainsResource(http);

    const domains = await res.list();

    expect(http.get).toHaveBeenCalledWith("/", undefined);
    expect(domains).toHaveLength(2);
    expect(domains[0].domain).toBe("mail.acme.com");
    expect(domains[0].status).toBe(SendingDomainStatus.VERIFIED);
    expect(domains[0].isDefault).toBe(true);
    expect(domains[0].verifiedAt).toBeInstanceOf(Date);
    expect(domains[1].verifiedAt).toBeNull();
  });

  it("passes ?status= filter through", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_DOMAIN_VERIFIED]);
    const res = new DomainsResource(http);

    await res.list({ status: SendingDomainStatus.VERIFIED });

    expect(http.get).toHaveBeenCalledWith("/", { status: "verified" });
  });
});

describe("DomainsResource.setDefault", () => {
  it("posts to URL-encoded path and returns bare domain string", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({ default_domain: "mail.acme.com" });
    const res = new DomainsResource(http);

    const result = await res.setDefault("mail.acme.com");

    expect(http.post).toHaveBeenCalledWith("/mail.acme.com/set-default", {});
    expect(result).toBe("mail.acme.com");
  });

  it("returns null when reverting to platform default", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({ default_domain: null });
    const res = new DomainsResource(http);

    const result = await res.setDefault("inkboxmail.com");

    expect(result).toBeNull();
  });

  it("URL-encodes the domain segment", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({ default_domain: null });
    const res = new DomainsResource(http);

    await res.setDefault("weird name@thing");

    expect(http.post).toHaveBeenCalledWith(
      `/${encodeURIComponent("weird name@thing")}/set-default`,
      {},
    );
  });
});

describe("parseDomain", () => {
  it("handles null verified_at", () => {
    const domain = parseDomain(RAW_DOMAIN_PENDING);
    expect(domain.verifiedAt).toBeNull();
    expect(domain.status).toBe(SendingDomainStatus.PENDING);
    expect(domain.isDefault).toBe(false);
  });

  it("parses verified_at to a Date", () => {
    const domain = parseDomain(RAW_DOMAIN_VERIFIED);
    expect(domain.verifiedAt).toBeInstanceOf(Date);
    expect(domain.verifiedAt?.toISOString()).toBe("2026-03-09T00:00:00.000Z");
  });
});

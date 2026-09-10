import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { Inkbox } from "../src/inkbox.js";
import { OrganizationDomainsResource } from "../src/organization_domains/resource.js";
import { parseDomainAffiliation } from "../src/organization_domains/types.js";
import { A2AResource } from "../src/a2a/resource.js";
import type { HttpTransport } from "../src/_http.js";

const fixture = JSON.parse(readFileSync(new URL("../../../tests/fixtures/domain-certification.json", import.meta.url), "utf8"));

describe("organization domains", () => {
  it("preserves unknown states and uses encoded management paths", async () => {
    const http = { get: vi.fn(), post: vi.fn(), delete: vi.fn() };
    http.get.mockResolvedValue(fixture.claim);
    http.post.mockResolvedValue({ ...fixture.claim, state: "future_state" });
    const resource = new OrganizationDomainsResource(http as unknown as HttpTransport);
    expect((await resource.create("example.com")).state).toBe("future_state");
    expect(http.post).toHaveBeenCalledWith("/organization-domains", { domain: "example.com" });
    expect((await resource.get("claim/id")).dnsRecord.name).toBe("_inkbox.example.com");
    expect(http.get).toHaveBeenCalledWith("/organization-domains/claim%2Fid");
    for (const action of ["verify", "transfer"] as const) {
      await resource[action]("claim/id");
      expect(http.post).toHaveBeenCalledWith(`/organization-domains/claim%2Fid/${action}`);
    }
    await resource.delete("claim/id");
    expect(http.delete).toHaveBeenCalledWith("/organization-domains/claim%2Fid");
    http.get.mockResolvedValue({ items: [fixture.claim], next_cursor: "next" });
    expect((await resource.list({ cursor: "before" })).nextCursor).toBe("next");
  });

  it("exposes identity management without fetching an identity first", async () => {
    const client = new Inkbox({ apiKey: "test-key" });
    const http = { get: vi.fn(), put: vi.fn(), delete: vi.fn() };
    const config = { domain_claim_id: "claim", domain: "example.com", publish_publicly: false, affiliation: fixture.affiliation };
    http.get.mockResolvedValue(config); http.put.mockResolvedValue(config);
    Object.assign(client.identities, { http });
    expect((await client.identities.getDomainAffiliation("@helper")).affiliation?.validUntil).toBe(fixture.affiliation.valid_until);
    await client.identities.setDomainAffiliation("@helper", { domainClaimId: "claim", publishPublicly: false });
    expect(http.put).toHaveBeenCalledWith("/%40helper/domain-affiliation", { domain_claim_id: "claim", publish_publicly: false });
    await client.identities.removeDomainAffiliation("@helper");
    expect(http.delete).toHaveBeenCalledWith("/%40helper/domain-affiliation");
  });

  it("carries the public filter across pages and rejects organization filtering", async () => {
    const item = { card_url: "https://inkbox.ai/a2a/helper/card", visibility: "public", card: {
      name: "@helper", capabilities: { extensions: [{ uri: "https://inkbox.ai/a2a/extensions/domain-affiliation/v1", params: fixture.affiliation }] },
    } };
    const http = { get: vi.fn().mockResolvedValueOnce({ items: [item], next_cursor: "next" }).mockResolvedValueOnce({ items: [item], next_cursor: null }) };
    const resource = new A2AResource(http as unknown as HttpTransport, http as unknown as HttpTransport);
    const items = [];
    for await (const row of resource.iterPublicDirectory({ q: "help", verifiedDomain: "example.com" })) items.push(row);
    expect(items).toHaveLength(2);
    expect(items[0].card.capabilities).toEqual(item.card.capabilities);
    expect(http.get.mock.calls[1][1]).toMatchObject({ cursor: "next", verified_domain: "example.com", q: "help" });
    await expect(resource.organizationDirectory({ verifiedDomain: "example.com" } as never)).rejects.toThrow("public directory");
    expect(parseDomainAffiliation(undefined)).toBeNull();
  });
});

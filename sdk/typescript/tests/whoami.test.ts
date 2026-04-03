// sdk/typescript/tests/whoami.test.ts
import { describe, it, expect, vi } from "vitest";
import type { HttpTransport } from "../src/_http.js";
import { parseWhoamiResponse } from "../src/whoami/types.js";
import { RAW_WHOAMI_API_KEY, RAW_WHOAMI_JWT } from "./sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

describe("parseWhoamiResponse", () => {
  it("parses API key response", () => {
    const result = parseWhoamiResponse(RAW_WHOAMI_API_KEY);
    expect(result.authType).toBe("api_key");
    if (result.authType === "api_key") {
      expect(result.organizationId).toBe("org-abc123");
      expect(result.keyId).toBe("key_xyz");
      expect(result.label).toBe("My Key");
      expect(result.expiresAt).toBeNull();
    }
  });

  it("parses JWT response", () => {
    const result = parseWhoamiResponse(RAW_WHOAMI_JWT);
    expect(result.authType).toBe("jwt");
    if (result.authType === "jwt") {
      expect(result.email).toBe("dev@example.com");
      expect(result.orgRole).toBe("admin");
      expect(result.orgSlug).toBe("my-org");
    }
  });
});

describe("Inkbox.whoami", () => {
  it("calls GET /whoami on rootApiHttp", async () => {
    const { Inkbox } = await import("../src/inkbox.js");
    const client = new Inkbox({ apiKey: "sk-test" });
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_WHOAMI_API_KEY);
    (client as unknown as { _rootApiHttp: HttpTransport })._rootApiHttp = http;

    const result = await client.whoami();

    expect(http.get).toHaveBeenCalledWith("/whoami");
    expect(result.authType).toBe("api_key");
    if (result.authType === "api_key") {
      expect(result.organizationId).toBe("org-abc123");
    }
  });
});

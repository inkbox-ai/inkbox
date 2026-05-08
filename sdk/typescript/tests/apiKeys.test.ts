// sdk/typescript/tests/apiKeys.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport } from "../src/_http.js";
import { ApiKeysResource } from "../src/api_keys/resources/apiKeys.js";
import { parseApiKey, parseCreatedApiKey } from "../src/api_keys/types.js";

const BASE = "https://inkbox.ai/api/v1";

const RECORD_DICT = {
  id: "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9",
  organization_id: "org_test_123",
  created_by: "user_test_456",
  creator_type: "human",
  scoped_identity_id: "11111111-1111-1111-1111-111111111111",
  label: "Hermes gateway · sales-bot",
  description: "Auto-minted by hermes setup gateway",
  status: "active" as const,
  last4: "wxyz",
  display_prefix: "ApiKey_67e166e4",
  last_used_at: null,
  expires_at: null,
  revoked_at: null,
  created_at: "2026-05-08T12:00:00Z",
  updated_at: "2026-05-08T12:00:00Z",
};

const CREATE_RESPONSE_DICT = {
  api_key: "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9.secret_xyz",
  record: RECORD_DICT,
};

function ok(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    headers: {
      get() { return null; },
      getSetCookie() { return []; },
    } as unknown as Headers,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("parseApiKey", () => {
  it("converts snake_case to camelCase and parses dates", () => {
    const r = parseApiKey(RECORD_DICT);
    expect(r.id).toBe("ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9");
    expect(r.organizationId).toBe("org_test_123");
    expect(r.createdBy).toBe("user_test_456");
    expect(r.scopedIdentityId).toBe("11111111-1111-1111-1111-111111111111");
    expect(r.status).toBe("active");
    expect(r.createdAt).toBeInstanceOf(Date);
    expect(r.lastUsedAt).toBeNull();
  });

  it("admin-scoped record has null scopedIdentityId", () => {
    const r = parseApiKey({ ...RECORD_DICT, scoped_identity_id: null });
    expect(r.scopedIdentityId).toBeNull();
  });
});

describe("parseCreatedApiKey", () => {
  it("inlines the secret next to the parsed record", () => {
    const created = parseCreatedApiKey(CREATE_RESPONSE_DICT);
    expect(created.apiKey).toBe(
      "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9.secret_xyz",
    );
    expect(created.record.label).toBe("Hermes gateway · sales-bot");
  });
});

describe("ApiKeysResource", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("create sends label only when description and scope are omitted", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok({ ...CREATE_RESPONSE_DICT, record: { ...RECORD_DICT, scoped_identity_id: null } }),
    );
    const http = new HttpTransport("k", BASE);
    const resource = new ApiKeysResource(http);

    await resource.create({ label: "My admin key" });

    const call = vi.mocked(fetch).mock.calls[0];
    expect(call[0]).toContain("/api-keys");
    const body = JSON.parse((call[1] as RequestInit).body as string);
    // Empty optional fields are omitted from the wire body
    expect(body).toEqual({ label: "My admin key" });
  });

  it("create forwards scopedIdentityId as snake_case", async () => {
    vi.mocked(fetch).mockResolvedValue(ok(CREATE_RESPONSE_DICT));
    const http = new HttpTransport("k", BASE);
    const resource = new ApiKeysResource(http);

    const result = await resource.create({
      label: "Hermes gateway · sales-bot",
      description: "Auto-minted",
      scopedIdentityId: "11111111-1111-1111-1111-111111111111",
    });

    const call = vi.mocked(fetch).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body).toEqual({
      label: "Hermes gateway · sales-bot",
      description: "Auto-minted",
      scoped_identity_id: "11111111-1111-1111-1111-111111111111",
    });
    expect(result.apiKey).toBe(
      "ApiKey_67e166e4-eebf-4e2f-9ad1-31500426dbc9.secret_xyz",
    );
    expect(result.record.scopedIdentityId).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
  });
});

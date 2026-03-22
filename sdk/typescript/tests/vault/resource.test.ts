import { describe, it, expect, vi } from "vitest";
import type { HttpTransport } from "../../src/_http.js";
import { VaultResource, UnlockedVault } from "../../src/vault/resources/vault.js";
import {
  deriveSalt,
  deriveMasterKey,
  computeAuthHash,
  wrapOrgKey,
  encryptPayload,
  generateOrgEncryptionKey,
} from "../../src/vault/crypto.js";
import type { RawVaultInfo, RawVaultKey, RawVaultSecret } from "../../src/vault/types.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const RAW_INFO: RawVaultInfo = {
  id: "aaaa1111-0000-0000-0000-000000000001",
  organization_id: "org_test_123",
  status: "active",
  created_at: "2026-03-18T12:00:00Z",
  updated_at: "2026-03-18T12:00:00Z",
  key_count: 1,
  secret_count: 2,
  recovery_key_count: 4,
};

const RAW_KEY: RawVaultKey = {
  id: "bbbb2222-0000-0000-0000-000000000001",
  key_type: "primary",
  created_by: "user_abc",
  status: "active",
  created_at: "2026-03-18T12:00:00Z",
  updated_at: "2026-03-18T12:00:00Z",
};

const RAW_SECRET: RawVaultSecret = {
  id: "cccc3333-0000-0000-0000-000000000001",
  name: "AWS Production",
  description: null,
  secret_type: "login",
  status: "active",
  created_at: "2026-03-18T12:00:00Z",
  updated_at: "2026-03-18T12:00:00Z",
};

describe("VaultResource.info", () => {
  it("returns parsed VaultInfo", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INFO);
    const res = new VaultResource(http);
    const info = await res.info();
    expect(http.get).toHaveBeenCalledWith("/info");
    expect(info.organizationId).toBe("org_test_123");
    expect(info.keyCount).toBe(1);
  });
});

describe("VaultResource.listKeys", () => {
  it("returns list", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_KEY]);
    const res = new VaultResource(http);
    const keys = await res.listKeys();
    expect(http.get).toHaveBeenCalledWith("/keys", {});
    expect(keys).toHaveLength(1);
    expect(keys[0].keyType).toBe("primary");
  });

  it("filters by type", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new VaultResource(http);
    await res.listKeys({ keyType: "recovery" });
    expect(http.get).toHaveBeenCalledWith("/keys", { type: "recovery" });
  });
});

describe("VaultResource.listSecrets", () => {
  it("returns list", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_SECRET]);
    const res = new VaultResource(http);
    const secrets = await res.listSecrets();
    expect(http.get).toHaveBeenCalledWith("/secrets", {});
    expect(secrets).toHaveLength(1);
  });

  it("filters by type", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new VaultResource(http);
    await res.listSecrets({ secretType: "login" });
    expect(http.get).toHaveBeenCalledWith("/secrets", { secret_type: "login" });
  });
});

describe("VaultResource.deleteSecret", () => {
  it("calls delete on correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new VaultResource(http);
    await res.deleteSecret("some-uuid");
    expect(http.delete).toHaveBeenCalledWith("/secrets/some-uuid");
  });
});

describe("VaultResource.unlock", () => {
  it("decrypts secrets from unlock bundle", async () => {
    const orgKey = generateOrgEncryptionKey();
    const password = "test-password";
    const orgId = "org_test_123";

    const salt = deriveSalt(orgId);
    const mk = await deriveMasterKey(password, salt);
    const wrapped = wrapOrgKey(mk, orgKey);
    const encrypted = encryptPayload(orgKey, { username: "admin", password: "s3cret" });

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO) // info()
      .mockResolvedValueOnce({         // unlock()
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [
          { ...RAW_SECRET, encrypted_payload: encrypted },
        ],
      });

    const res = new VaultResource(http);
    const unlocked = await res.unlock(password);

    expect(unlocked.secrets).toHaveLength(1);
    const s = unlocked.secrets[0];
    expect(s.name).toBe("AWS Production");
    expect((s.payload as { username: string }).username).toBe("admin");
  });
});

describe("UnlockedVault.createSecret", () => {
  it("encrypts and posts", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_SECRET);
    const unlocked = new UnlockedVault(http, orgKey, []);

    const result = await unlocked.createSecret({
      name: "AWS Prod",
      payload: { username: "admin", password: "pw" },
    });

    expect(result.name).toBe("AWS Production");
    const call = vi.mocked(http.post).mock.calls[0];
    expect(call[0]).toBe("/secrets");
    const body = call[1] as Record<string, unknown>;
    expect(body.name).toBe("AWS Prod");
    expect(body.secret_type).toBe("login");
    expect(typeof body.encrypted_payload).toBe("string");
  });
});

describe("UnlockedVault.updateSecret", () => {
  it("sends only name when no payload", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_SECRET);
    const unlocked = new UnlockedVault(http, orgKey, []);

    await unlocked.updateSecret("some-id", { name: "New Name" });

    const call = vi.mocked(http.patch).mock.calls[0];
    const body = call[1] as Record<string, unknown>;
    expect(body).toEqual({ name: "New Name" });
  });

  it("sends encrypted payload when provided", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_SECRET);
    const unlocked = new UnlockedVault(http, orgKey, []);

    await unlocked.updateSecret("some-id", {
      payload: { username: "new", password: "pw2" },
    });

    const call = vi.mocked(http.patch).mock.calls[0];
    const body = call[1] as Record<string, unknown>;
    expect(typeof body.encrypted_payload).toBe("string");
    expect(body).not.toHaveProperty("name");
  });
});

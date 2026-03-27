// sdk/typescript/tests/vault/resource.test.ts
import { describe, it, expect, vi } from "vitest";
import type { HttpTransport } from "../../src/_http.js";
import { VaultResource, UnlockedVault } from "../../src/vault/resources/vault.js";
import {
  deriveSalt,
  deriveMasterKey,
  computeAuthHash,
  wrapOrgKey,
  unwrapOrgKey,
  encryptPayload,
  generateOrgEncryptionKey,
} from "../../src/vault/crypto.js";
import type { RawVaultInfo, RawVaultKey, RawVaultSecret } from "../../src/vault/types.js";

const VALID_VAULT_KEY = "Test-Passw0rd!xy";

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

const RAW_ACCESS_RULE = {
  id: "aaaa0000-0000-0000-0000-000000000001",
  vault_secret_id: "bbbb0000-0000-0000-0000-000000000002",
  identity_id: "cccc0000-0000-0000-0000-000000000003",
  created_at: "2026-03-18T12:00:00Z",
};

describe("VaultResource.listAccessRules", () => {
  it("returns parsed access rules", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_ACCESS_RULE]);
    const res = new VaultResource(http);
    const rules = await res.listAccessRules("some-secret-id");
    expect(http.get).toHaveBeenCalledWith("/secrets/some-secret-id/access");
    expect(rules).toHaveLength(1);
    expect(rules[0].identityId).toBe(RAW_ACCESS_RULE.identity_id);
  });
});

describe("VaultResource.grantAccess", () => {
  it("posts and returns parsed access rule", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_ACCESS_RULE);
    const res = new VaultResource(http);
    const rule = await res.grantAccess("some-secret-id", "some-identity-id");
    expect(http.post).toHaveBeenCalledWith(
      "/secrets/some-secret-id/access",
      { identity_id: "some-identity-id" },
    );
    expect(rule.identityId).toBe(RAW_ACCESS_RULE.identity_id);
  });
});

describe("VaultResource.revokeAccess", () => {
  it("calls delete on correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new VaultResource(http);
    await res.revokeAccess("some-secret-id", "some-identity-id");
    expect(http.delete).toHaveBeenCalledWith(
      "/secrets/some-secret-id/access/some-identity-id",
    );
  });
});

describe("VaultResource.unlock", () => {
  it("decrypts secrets from unlock bundle", async () => {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";

    const salt = deriveSalt(orgId);
    const mk = await deriveMasterKey(vaultKey, salt);
    const wrapped = wrapOrgKey(mk, orgKey, RAW_KEY.id);
    const encrypted = encryptPayload(orgKey, { username: "admin", password: "s3cret" }, RAW_SECRET.id);

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO) // info()
      .mockResolvedValueOnce({         // unlock()
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [
          { ...RAW_SECRET, encrypted_payload: encrypted },
        ],
      })
      .mockResolvedValueOnce([RAW_KEY]); // keys()

    const res = new VaultResource(http);
    const unlocked = await res.unlock(vaultKey);

    expect(unlocked.secrets).toHaveLength(1);
    const s = unlocked.secrets[0];
    expect(s.name).toBe("AWS Production");
    expect((s.payload as { username: string }).username).toBe("admin");
  });

  it("stores _unlocked state after unlock", async () => {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";
    const salt = deriveSalt(orgId);
    const masterKey = await deriveMasterKey(vaultKey, salt);
    const wrapped = wrapOrgKey(masterKey, orgKey, RAW_KEY.id);

    const http = mockHttp();
    const res = new VaultResource(http);
    expect(res._unlocked).toBeNull();
    (http.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]); // keys()
    const unlocked = await res.unlock(vaultKey);
    expect(res._unlocked).toBe(unlocked);
  });

  it("stores unfiltered _unlocked when identity_id provided", async () => {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";
    const salt = deriveSalt(orgId);
    const masterKey = await deriveMasterKey(vaultKey, salt);
    const wrapped = wrapOrgKey(masterKey, orgKey, RAW_KEY.id);

    const http = mockHttp();
    const res = new VaultResource(http);
    (http.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]); // keys()
    const returned = await res.unlock(vaultKey, { identityId: "some-identity" });
    // _unlocked is always populated (unfiltered) so identity.getCredentials() works
    expect(res._unlocked).not.toBeNull();
    // But the returned vault is a separate filtered instance
    expect(returned).not.toBe(res._unlocked);
  });

  it("does not validate key strength client-side", async () => {
    const http = mockHttp();
    const res = new VaultResource(http);
    // info() then unlock() — server rejects via missing wrapped key
    (http.get as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({});
    await expect(res.unlock("short")).rejects.toThrow(
      "No vault key matched",
    );
  });
});

describe("UnlockedVault.createSecret", () => {
  it("encrypts and posts", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_SECRET);
    // get_secret is called after create to populate cache
    const encrypted = encryptPayload(orgKey, { username: "admin", password: "pw" }, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, encrypted_payload: encrypted });
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

  it("appends created secret to cache", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_SECRET);
    const encrypted = encryptPayload(orgKey, { username: "admin", password: "pw" }, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, encrypted_payload: encrypted });
    const unlocked = new UnlockedVault(http, orgKey, []);

    expect(unlocked.secrets).toHaveLength(0);

    await unlocked.createSecret({
      name: "Test",
      payload: { username: "admin", password: "pw" },
    });

    expect(unlocked.secrets).toHaveLength(1);
    expect(unlocked.secrets[0].name).toBe("AWS Production");
    expect((unlocked.secrets[0].payload as { username: string }).username).toBe("admin");
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
    vi.mocked(http.get).mockResolvedValue(RAW_SECRET); // type check fetch
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

  it("rejects mismatched payload type", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_SECRET); // secret_type == "login"
    const unlocked = new UnlockedVault(http, orgKey, []);

    await expect(
      unlocked.updateSecret("some-id", {
        payload: { data: "wrong type" },
      }),
    ).rejects.toThrow("Cannot update a 'login' secret");
  });
});

describe("UnlockedVault.getSecret", () => {
  it("fetches and decrypts", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    const encrypted = encryptPayload(orgKey, { username: "admin", password: "s3cret" }, "some-uuid");
    vi.mocked(http.get).mockResolvedValue({
      ...RAW_SECRET,
      id: "some-uuid",
      encrypted_payload: encrypted,
    });
    const unlocked = new UnlockedVault(http, orgKey, []);

    const secret = await unlocked.getSecret("some-uuid");
    expect(http.get).toHaveBeenCalledWith("/secrets/some-uuid");
    expect(secret.name).toBe("AWS Production");
    expect((secret.payload as { username: string }).username).toBe("admin");
  });
});

describe("UnlockedVault.deleteSecret", () => {
  it("calls delete on correct path", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const unlocked = new UnlockedVault(http, orgKey, []);

    await unlocked.deleteSecret("some-uuid");
    expect(http.delete).toHaveBeenCalledWith("/secrets/some-uuid");
  });
});

describe("UnlockedVault.updateSecret", () => {
  it("sends name and payload together", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_SECRET); // type check fetch
    vi.mocked(http.patch).mockResolvedValue(RAW_SECRET);
    const unlocked = new UnlockedVault(http, orgKey, []);

    await unlocked.updateSecret("some-id", {
      name: "Updated",
      payload: { username: "new", password: "pw2" },
    });

    const call = vi.mocked(http.patch).mock.calls[0];
    const body = call[1] as Record<string, unknown>;
    expect(body.name).toBe("Updated");
    expect(typeof body.encrypted_payload).toBe("string");
  });
});

describe("VaultResource.unlock error when no wrapped key", () => {
  it("throws when server returns null wrapped key", async () => {
    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO) // info()
      .mockResolvedValueOnce({         // unlock()
        wrapped_org_encryption_key: null,
        encrypted_secrets: [],
      });

    const res = new VaultResource(http);
    await expect(res.unlock(VALID_VAULT_KEY)).rejects.toThrow(
      "No vault key matched",
    );
  });
});

describe("VaultResource.unlock with identityId filtering", () => {
  it("returns only secrets accessible by the given identity", async () => {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";

    const salt = deriveSalt(orgId);
    const mk = await deriveMasterKey(vaultKey, salt);
    const wrapped = wrapOrgKey(mk, orgKey, RAW_KEY.id);

    // Create two encrypted secrets
    const secret1Id = "cccc3333-0000-0000-0000-000000000001";
    const secret2Id = "cccc3333-0000-0000-0000-000000000002";
    const encrypted1 = encryptPayload(orgKey, { username: "admin", password: "s3cret" }, secret1Id);
    const encrypted2 = encryptPayload(orgKey, { username: "user2", password: "pass2" }, secret2Id);
    const identityId = "identity-uuid-1234";

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO) // info()
      .mockResolvedValueOnce({         // unlock()
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [
          { ...RAW_SECRET, id: secret1Id, encrypted_payload: encrypted1 },
          { ...RAW_SECRET, id: secret2Id, name: "Second Secret", encrypted_payload: encrypted2 },
        ],
      })
      .mockResolvedValueOnce([RAW_KEY]) // keys()
      // access endpoint for secret1 — identity has access
      .mockResolvedValueOnce([
        { id: "rule-1", vault_secret_id: secret1Id, identity_id: identityId, created_at: "2026-03-18T12:00:00Z" },
      ])
      // access endpoint for secret2 — identity does NOT have access
      .mockResolvedValueOnce([
        { id: "rule-2", vault_secret_id: secret2Id, identity_id: "other-identity", created_at: "2026-03-18T12:00:00Z" },
      ]);

    const res = new VaultResource(http);
    const unlocked = await res.unlock(vaultKey, { identityId });

    expect(unlocked.secrets).toHaveLength(1);
    expect(unlocked.secrets[0].id).toBe(secret1Id);
    expect((unlocked.secrets[0].payload as { username: string }).username).toBe("admin");

    // Verify access endpoint was called for both secrets
    expect(http.get).toHaveBeenCalledWith(`/secrets/${secret1Id}/access`);
    expect(http.get).toHaveBeenCalledWith(`/secrets/${secret2Id}/access`);
  });
});

// ---- TOTP integration tests ----

const SECRET_ID = "cccc3333-0000-0000-0000-000000000001";
const TOTP_SECRET = "JBSWY3DPEHPK3PXP";

function unlockedWithLogin(opts: { totpConfig?: Record<string, unknown> } = {}) {
  const orgKey = generateOrgEncryptionKey();
  const http = mockHttp();
  const loginDict: Record<string, unknown> = { password: "s3cret", username: "admin" };
  if (opts.totpConfig) loginDict.totp = opts.totpConfig;
  const encrypted = encryptPayload(orgKey, loginDict, RAW_SECRET.id);
  // get_secret returns this when fetching
  vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, encrypted_payload: encrypted });
  vi.mocked(http.patch).mockResolvedValue(RAW_SECRET);
  // Build a cached secret
  const cached = {
    id: RAW_SECRET.id,
    name: RAW_SECRET.name,
    description: RAW_SECRET.description,
    secretType: RAW_SECRET.secret_type,
    status: RAW_SECRET.status,
    createdAt: new Date(RAW_SECRET.created_at),
    updatedAt: new Date(RAW_SECRET.updated_at),
    payload: { password: "s3cret", username: "admin", ...(opts.totpConfig ? { totp: opts.totpConfig } : {}) },
  };
  const unlocked = new UnlockedVault(http, orgKey, [cached]);
  return { unlocked, http, orgKey };
}

describe("UnlockedVault.setTotp", () => {
  it("sets TOTP with config object", async () => {
    const { unlocked, http } = unlockedWithLogin();
    const result = await unlocked.setTotp(SECRET_ID, { secret: TOTP_SECRET });
    expect(result.name).toBe("AWS Production");
    expect(vi.mocked(http.patch)).toHaveBeenCalled();
  });

  it("sets TOTP with URI string", async () => {
    const { unlocked, http } = unlockedWithLogin();
    const result = await unlocked.setTotp(SECRET_ID, `otpauth://totp/Test?secret=${TOTP_SECRET}&issuer=Test`);
    expect(result.name).toBe("AWS Production");
    expect(vi.mocked(http.patch)).toHaveBeenCalled();
  });

  it("rejects non-login secret", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    const encrypted = encryptPayload(orgKey, { data: "freeform" }, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, secret_type: "other", encrypted_payload: encrypted });
    const unlocked = new UnlockedVault(http, orgKey, []);
    await expect(unlocked.setTotp(SECRET_ID, { secret: TOTP_SECRET })).rejects.toThrow("only login secrets support TOTP");
  });
});

describe("UnlockedVault.removeTotp", () => {
  it("removes TOTP from login", async () => {
    const totpConfig = { secret: TOTP_SECRET, algorithm: "sha1", digits: 6, period: 30 };
    const { unlocked, http } = unlockedWithLogin({ totpConfig });
    const result = await unlocked.removeTotp(SECRET_ID);
    expect(result.name).toBe("AWS Production");
    expect(vi.mocked(http.patch)).toHaveBeenCalled();
  });

  it("rejects non-login secret", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    const encrypted = encryptPayload(orgKey, { data: "freeform" }, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, secret_type: "other", encrypted_payload: encrypted });
    const unlocked = new UnlockedVault(http, orgKey, []);
    await expect(unlocked.removeTotp(SECRET_ID)).rejects.toThrow("only login secrets support TOTP");
  });
});

describe("UnlockedVault.getTotpCode", () => {
  it("generates a valid code", async () => {
    const totpConfig = { secret: TOTP_SECRET, algorithm: "sha1", digits: 6, period: 30 };
    const { unlocked } = unlockedWithLogin({ totpConfig });
    const code = await unlocked.getTotpCode(SECRET_ID);
    expect(code.code).toHaveLength(6);
    expect(code.code).toMatch(/^\d{6}$/);
    expect(code.secondsRemaining).toBeGreaterThan(0);
    expect(code.periodEnd - code.periodStart).toBe(30);
  });

  it("throws when no TOTP configured", async () => {
    const { unlocked } = unlockedWithLogin();
    await expect(unlocked.getTotpCode(SECRET_ID)).rejects.toThrow("no TOTP configured");
  });

  it("throws for non-login secret", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    const encrypted = encryptPayload(orgKey, { data: "freeform" }, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, secret_type: "other", encrypted_payload: encrypted });
    const unlocked = new UnlockedVault(http, orgKey, []);
    await expect(unlocked.getTotpCode(SECRET_ID)).rejects.toThrow("only login secrets support TOTP");
  });
});

describe("UnlockedVault cache consistency", () => {
  it("set_totp updates cache", async () => {
    const { unlocked, http, orgKey } = unlockedWithLogin();
    expect(unlocked.secrets[0].payload).not.toHaveProperty("totp");

    // After setTotp, the refresh mock returns a secret with TOTP
    const totpDict = { secret: TOTP_SECRET, algorithm: "sha1", digits: 6, period: 30 };
    const loginWithTotp = { password: "s3cret", username: "admin", totp: totpDict };
    const encryptedWithTotp = encryptPayload(orgKey, loginWithTotp, RAW_SECRET.id);
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, encrypted_payload: encryptedWithTotp });

    await unlocked.setTotp(SECRET_ID, { secret: TOTP_SECRET });

    const cached = unlocked.secrets[0].payload as { totp?: { secret: string } };
    expect(cached.totp).toBeDefined();
    expect(cached.totp!.secret).toBe(TOTP_SECRET);
  });

  it("delete_secret removes from cache", async () => {
    const { unlocked, http } = unlockedWithLogin();
    expect(unlocked.secrets).toHaveLength(1);
    vi.mocked(http.delete).mockResolvedValue(undefined);
    await unlocked.deleteSecret(SECRET_ID);
    expect(unlocked.secrets).toHaveLength(0);
  });
});

describe("VaultResource.unlock with AAD happy path", () => {
  it("unwraps org key using vault key ID as AAD", async () => {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";

    const salt = deriveSalt(orgId);
    const masterKey = await deriveMasterKey(vaultKey, salt);
    const authHash = computeAuthHash(masterKey);

    // Wrap with vault key ID as AAD (matching console behavior)
    const vaultKeyId = RAW_KEY.id;
    const wrapped = wrapOrgKey(masterKey, orgKey, vaultKeyId);

    // Encrypt a payload with secret ID as AAD
    const secretId = RAW_SECRET.id;
    const loginPayload = { username: "admin", password: "s3cret" };
    const encrypted = encryptPayload(orgKey, loginPayload, secretId);

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)  // info()
      .mockResolvedValueOnce({          // unlock()
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [{ ...RAW_SECRET, encrypted_payload: encrypted }],
      })
      .mockResolvedValueOnce([RAW_KEY]); // keys()

    const res = new VaultResource(http);
    const unlocked = await res.unlock(vaultKey);

    expect(unlocked.secrets).toHaveLength(1);
    expect((unlocked.secrets[0].payload as { username: string }).username).toBe("admin");
  });
});

describe("strict AAD enforcement", () => {
  it("rejects payload encrypted with wrong secret ID", async () => {
    const orgKey = generateOrgEncryptionKey();
    const http = mockHttp();
    const encrypted = encryptPayload(orgKey, { password: "pw", username: "u" }, "wrong-id");
    vi.mocked(http.get).mockResolvedValue({ ...RAW_SECRET, encrypted_payload: encrypted });
    const unlocked = new UnlockedVault(http, orgKey, []);
    await expect(unlocked.getSecret(RAW_SECRET.id)).rejects.toThrow();
  });
});

// ---- VaultResource.initialize tests ----

describe("VaultResource.initialize", () => {
  it("posts crypto material to /initialize and returns result with recovery codes", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      vault_id: "vault-uuid-1234",
      vault_key_id: "key-uuid-5678",
      recovery_key_count: 4,
    });

    const res = new VaultResource(http);
    const result = await res.initialize(VALID_VAULT_KEY, "org_test_123");

    expect(result.vaultId).toBe("vault-uuid-1234");
    expect(result.vaultKeyId).toBe("key-uuid-5678");
    expect(result.recoveryKeyCount).toBe(4);
    expect(result.recoveryCodes).toHaveLength(4);

    // Verify HTTP call
    expect(http.post).toHaveBeenCalledTimes(1);
    const [path, body] = vi.mocked(http.post).mock.calls[0];
    expect(path).toBe("/initialize");

    // vault_key must be primary with all required fields
    expect(body.vault_key.id).toEqual(expect.any(String));
    expect(body.vault_key.wrapped_org_encryption_key).toEqual(expect.any(String));
    expect(body.vault_key.auth_hash).toEqual(expect.any(String));
    expect(body.vault_key.key_type).toBe("primary");

    // recovery_keys must have 4 entries, all recovery type
    expect(body.recovery_keys).toHaveLength(4);
    for (const rk of body.recovery_keys) {
      expect(rk.id).toEqual(expect.any(String));
      expect(rk.wrapped_org_encryption_key).toEqual(expect.any(String));
      expect(rk.auth_hash).toEqual(expect.any(String));
      expect(rk.key_type).toBe("recovery");
    }
  });

  it("recovery codes match XXXX-XXXX-…-XXXX pattern (8 groups of 4)", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      vault_id: "v1", vault_key_id: "k1", recovery_key_count: 4,
    });
    const res = new VaultResource(http);
    const result = await res.initialize(VALID_VAULT_KEY, "org_test_123");

    for (const code of result.recoveryCodes) {
      expect(code).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){7}$/);
    }
  });

  it("all key IDs and auth_hashes are unique", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      vault_id: "v1", vault_key_id: "k1", recovery_key_count: 4,
    });
    const res = new VaultResource(http);
    await res.initialize(VALID_VAULT_KEY, "org_test_123");

    const [, body] = vi.mocked(http.post).mock.calls[0];
    const allKeys = [body.vault_key, ...body.recovery_keys];
    const ids = allKeys.map((k: Record<string, string>) => k.id);
    const hashes = allKeys.map((k: Record<string, string>) => k.auth_hash);
    expect(new Set(ids).size).toBe(5);
    expect(new Set(hashes).size).toBe(5);
  });

  it("wrapped org key can be round-tripped with the same vault key", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      vault_id: "v1", vault_key_id: "k1", recovery_key_count: 4,
    });
    const res = new VaultResource(http);
    await res.initialize(VALID_VAULT_KEY, "org_test_123");

    const [, body] = vi.mocked(http.post).mock.calls[0];
    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey(VALID_VAULT_KEY, salt);
    const orgKey = unwrapOrgKey(mk, body.vault_key.wrapped_org_encryption_key, body.vault_key.id);
    expect(orgKey).toBeInstanceOf(Uint8Array);
    expect(orgKey.length).toBe(32);
  });

  it("all four recovery codes can each unwrap the same org key", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue({
      vault_id: "v1", vault_key_id: "k1", recovery_key_count: 4,
    });
    const res = new VaultResource(http);
    const result = await res.initialize(VALID_VAULT_KEY, "org_test_123");

    const [, body] = vi.mocked(http.post).mock.calls[0];
    const salt = deriveSalt("org_test_123");

    // First unwrap the org key via the primary key to get the reference
    const primaryMk = await deriveMasterKey(VALID_VAULT_KEY, salt);
    const referenceOrgKey = unwrapOrgKey(
      primaryMk, body.vault_key.wrapped_org_encryption_key, body.vault_key.id,
    );

    // Each recovery code should unwrap to the same org key
    for (let i = 0; i < 4; i++) {
      const code = result.recoveryCodes[i];
      const rk = body.recovery_keys[i];
      const rcMk = await deriveMasterKey(code, salt);
      const orgKey = unwrapOrgKey(rcMk, rk.wrapped_org_encryption_key, rk.id);
      expect(Buffer.from(orgKey)).toEqual(Buffer.from(referenceOrgKey));
    }
  });
});

// ---- VaultResource.updateKey tests ----

describe("VaultResource.updateKey", () => {
  async function setupVaultCrypto() {
    const orgKey = generateOrgEncryptionKey();
    const vaultKey = VALID_VAULT_KEY;
    const orgId = "org_test_123";
    const salt = deriveSalt(orgId);
    const mk = await deriveMasterKey(vaultKey, salt);
    const authHash = computeAuthHash(mk);
    const wrapped = wrapOrgKey(mk, orgKey, RAW_KEY.id);
    return { orgKey, vaultKey, orgId, salt, mk, authHash, wrapped };
  }

  it("normal update: derives auth, unwraps, re-wraps, and PUTs", async () => {
    const { vaultKey, wrapped } = await setupVaultCrypto();
    const newVaultKey = "New-Passw0rd!xyz";

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]);
    vi.mocked(http.put).mockResolvedValue({ ...RAW_KEY, id: "new-key-uuid" });

    const res = new VaultResource(http);
    const result = await res.updateKey({ newVaultKey, currentVaultKey: vaultKey });

    expect(result.id).toBe("new-key-uuid");

    expect(http.put).toHaveBeenCalledTimes(1);
    const [path, body] = vi.mocked(http.put).mock.calls[0];
    expect(path).toBe("/keys/primary");
    expect(body.id).toEqual(expect.any(String));
    expect(body.wrapped_org_encryption_key).toEqual(expect.any(String));
    expect(body.auth_hash).toEqual(expect.any(String));
    expect(body.current_auth_hash).toEqual(expect.any(String));
    expect(body.recovery_auth_hash).toBeUndefined();
  });

  it("recovery update: uses recovery_auth_hash", async () => {
    const orgKey = generateOrgEncryptionKey();
    const orgId = "org_test_123";
    const recoveryCode = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789";
    const salt = deriveSalt(orgId);
    const recoveryMk = await deriveMasterKey(recoveryCode, salt);
    const recoveryWrapped = wrapOrgKey(recoveryMk, orgKey, "recovery-key-id");

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: recoveryWrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([
        { ...RAW_KEY, id: "recovery-key-id", key_type: "recovery" },
      ]);
    vi.mocked(http.put).mockResolvedValue({ ...RAW_KEY, id: "new-key-uuid" });

    const res = new VaultResource(http);
    const result = await res.updateKey({
      newVaultKey: "New-Passw0rd!xyz",
      recoveryCode,
    });

    expect(result.id).toBe("new-key-uuid");
    const [, body] = vi.mocked(http.put).mock.calls[0];
    expect(body.recovery_auth_hash).toEqual(expect.any(String));
    expect(body.current_auth_hash).toBeUndefined();
  });

  it("new key material can be unlocked with the new vault key", async () => {
    const { orgKey, vaultKey, wrapped } = await setupVaultCrypto();
    const newVaultKey = "New-Passw0rd!xyz";

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]);
    vi.mocked(http.put).mockResolvedValue(RAW_KEY);

    const res = new VaultResource(http);
    await res.updateKey({ newVaultKey, currentVaultKey: vaultKey });

    const [, body] = vi.mocked(http.put).mock.calls[0];
    const salt = deriveSalt("org_test_123");
    const newMk = await deriveMasterKey(newVaultKey, salt);
    const unwrapped = unwrapOrgKey(newMk, body.wrapped_org_encryption_key, body.id);
    expect(unwrapped).toBeInstanceOf(Uint8Array);
    expect(unwrapped.length).toBe(32);
    // The unwrapped key must be the same org key
    expect(Buffer.from(unwrapped)).toEqual(Buffer.from(orgKey));
  });

  it("current_auth_hash matches what the server would expect", async () => {
    const { vaultKey, authHash, wrapped } = await setupVaultCrypto();

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]);
    vi.mocked(http.put).mockResolvedValue(RAW_KEY);

    const res = new VaultResource(http);
    await res.updateKey({ newVaultKey: "New-Passw0rd!xyz", currentVaultKey: vaultKey });

    const [, body] = vi.mocked(http.put).mock.calls[0];
    expect(body.current_auth_hash).toBe(authHash);
  });

  it("throws when neither currentVaultKey nor recoveryCode provided", async () => {
    const http = mockHttp();
    const res = new VaultResource(http);
    await expect(
      res.updateKey({ newVaultKey: "New-Passw0rd!xyz" }),
    ).rejects.toThrow("Exactly one of");
  });

  it("throws when both currentVaultKey and recoveryCode provided", async () => {
    const http = mockHttp();
    const res = new VaultResource(http);
    await expect(
      res.updateKey({
        newVaultKey: "New-Passw0rd!xyz",
        currentVaultKey: VALID_VAULT_KEY,
        recoveryCode: "some-code",
      }),
    ).rejects.toThrow("Exactly one of");
  });

  it("throws when no vault key matches (null wrapped key)", async () => {
    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: null,
        encrypted_secrets: [],
      });

    const res = new VaultResource(http);
    await expect(
      res.updateKey({ newVaultKey: "New-Passw0rd!xyz", currentVaultKey: VALID_VAULT_KEY }),
    ).rejects.toThrow("No vault key matched");
  });

  it("throws when org key cannot be unwrapped (AAD mismatch)", async () => {
    const { wrapped } = await setupVaultCrypto();

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([{ ...RAW_KEY, id: "wrong-key-id" }]);

    const res = new VaultResource(http);
    await expect(
      res.updateKey({ newVaultKey: "New-Passw0rd!xyz", currentVaultKey: VALID_VAULT_KEY }),
    ).rejects.toThrow("Failed to unwrap");
  });

  it("sends correct auth_hash to /unlock endpoint", async () => {
    const { vaultKey, authHash, wrapped } = await setupVaultCrypto();

    const http = mockHttp();
    vi.mocked(http.get)
      .mockResolvedValueOnce(RAW_INFO)
      .mockResolvedValueOnce({
        wrapped_org_encryption_key: wrapped,
        encrypted_secrets: [],
      })
      .mockResolvedValueOnce([RAW_KEY]);
    vi.mocked(http.put).mockResolvedValue(RAW_KEY);

    const res = new VaultResource(http);
    await res.updateKey({ newVaultKey: "New-Passw0rd!xyz", currentVaultKey: vaultKey });

    // Second get call should be /unlock with the correct auth_hash
    expect(vi.mocked(http.get).mock.calls[1]).toEqual([
      "/unlock", { auth_hash: authHash },
    ]);
  });
});

// ---- VaultResource.deleteKey tests ----

describe("VaultResource.deleteKey", () => {
  it("derives auth_hash and calls DELETE /keys/{auth_hash}", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INFO);
    vi.mocked(http.delete).mockResolvedValue(undefined);

    const res = new VaultResource(http);
    await res.deleteKey(VALID_VAULT_KEY);

    // Should have called info() then delete
    expect(http.get).toHaveBeenCalledWith("/info");
    expect(http.delete).toHaveBeenCalledTimes(1);

    // The delete path should contain a hex auth_hash
    const deletePath = vi.mocked(http.delete).mock.calls[0][0];
    expect(deletePath).toMatch(/^\/keys\/[0-9a-f]{64}$/);
  });

  it("auth_hash in path matches derivation from vault key", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INFO);
    vi.mocked(http.delete).mockResolvedValue(undefined);

    const res = new VaultResource(http);
    await res.deleteKey(VALID_VAULT_KEY);

    // Manually derive the expected auth_hash
    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey(VALID_VAULT_KEY, salt);
    const expectedHash = computeAuthHash(mk);

    const deletePath = vi.mocked(http.delete).mock.calls[0][0];
    expect(deletePath).toBe(`/keys/${expectedHash}`);
  });

  it("works with a recovery code", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_INFO);
    vi.mocked(http.delete).mockResolvedValue(undefined);

    const recoveryCode = "ABCD-EFGH-JKLM-NPQR-STUV-WXYZ-2345-6789";
    const res = new VaultResource(http);
    await res.deleteKey(recoveryCode);

    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey(recoveryCode, salt);
    const expectedHash = computeAuthHash(mk);

    const deletePath = vi.mocked(http.delete).mock.calls[0][0];
    expect(deletePath).toBe(`/keys/${expectedHash}`);
  });

  it("different vault keys produce different auth_hashes", async () => {
    const http1 = mockHttp();
    vi.mocked(http1.get).mockResolvedValue(RAW_INFO);
    vi.mocked(http1.delete).mockResolvedValue(undefined);
    const res1 = new VaultResource(http1);
    await res1.deleteKey(VALID_VAULT_KEY);

    const http2 = mockHttp();
    vi.mocked(http2.get).mockResolvedValue(RAW_INFO);
    vi.mocked(http2.delete).mockResolvedValue(undefined);
    const res2 = new VaultResource(http2);
    await res2.deleteKey("Other-Passw0rd!z");

    const path1 = vi.mocked(http1.delete).mock.calls[0][0];
    const path2 = vi.mocked(http2.delete).mock.calls[0][0];
    expect(path1).not.toBe(path2);
  });
});

// sdk/typescript/tests/vault/types.test.ts
import { describe, it, expect } from "vitest";
import {
  parseVaultInfo,
  parseVaultKey,
  parseVaultSecret,
  parseVaultSecretDetail,
  inferSecretType,
  parsePayload,
  serializePayload,
  VaultSecretType,
  VaultKeyType,
} from "../../src/vault/types.js";
import type {
  RawVaultInfo,
  RawVaultKey,
  RawVaultSecret,
  RawVaultSecretDetail,
  LoginPayload,
  OtherPayload,
  SSHKeyPayload,
  APIKeyPayload,
} from "../../src/vault/types.js";

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

describe("parseVaultInfo", () => {
  it("parses all fields", () => {
    const info = parseVaultInfo(RAW_INFO);
    expect(info.id).toBe(RAW_INFO.id);
    expect(info.organizationId).toBe("org_test_123");
    expect(info.keyCount).toBe(1);
    expect(info.secretCount).toBe(2);
    expect(info.recoveryKeyCount).toBe(4);
    expect(info.createdAt).toBeInstanceOf(Date);
  });
});

describe("parseVaultKey", () => {
  it("parses all fields", () => {
    const key = parseVaultKey(RAW_KEY);
    expect(key.keyType).toBe("primary");
    expect(key.createdBy).toBe("user_abc");
  });
});

describe("parseVaultSecret", () => {
  it("parses all fields", () => {
    const s = parseVaultSecret(RAW_SECRET);
    expect(s.name).toBe("AWS Production");
    expect(s.description).toBeNull();
    expect(s.secretType).toBe("login");
    expect(s.createdAt).toBeInstanceOf(Date);
  });
});

describe("parseVaultSecretDetail", () => {
  it("includes encrypted payload", () => {
    const raw: RawVaultSecretDetail = { ...RAW_SECRET, encrypted_payload: "abc123" };
    const s = parseVaultSecretDetail(raw);
    expect(s.encryptedPayload).toBe("abc123");
    expect(s.name).toBe("AWS Production");
    expect(s.description).toBeNull();
  });
});

describe("inferSecretType", () => {
  it("login", () => {
    expect(inferSecretType({ username: "a", password: "b" })).toBe("login");
  });
  it("other", () => {
    expect(inferSecretType({ data: "freeform content" })).toBe("other");
  });
  it("ssh_key", () => {
    expect(inferSecretType({ privateKey: "..." })).toBe("ssh_key");
  });
  it("api_key", () => {
    expect(inferSecretType({ key: "k" })).toBe("api_key");
  });
  it("throws on unknown shape", () => {
    expect(() => inferSecretType({} as any)).toThrow("Cannot infer");
  });
});

describe("parsePayload", () => {
  it("login", () => {
    const p = parsePayload("login", { username: "a", password: "b", url: "https://x" }) as LoginPayload;
    expect(p.username).toBe("a");
    expect(p.url).toBe("https://x");
  });
  it("other", () => {
    const p = parsePayload("other", { data: "freeform content" }) as OtherPayload;
    expect(p.data).toBe("freeform content");
  });
  it("ssh_key", () => {
    const p = parsePayload("ssh_key", { private_key: "---" }) as SSHKeyPayload;
    expect(p.privateKey).toBe("---");
  });
  it("api_key", () => {
    const p = parsePayload("api_key", { key: "k", secret: "s" }) as APIKeyPayload;
    expect(p.key).toBe("k");
    expect(p.secret).toBe("s");
  });
  it("other with notes", () => {
    const p = parsePayload("other", { data: "stuff", notes: "ctx" });
    expect((p as OtherPayload).notes).toBe("ctx");
  });
});

describe("VaultSecretType", () => {
  it("has correct values", () => {
    expect(VaultSecretType.LOGIN).toBe("login");
    expect(VaultSecretType.SSH_KEY).toBe("ssh_key");
    expect(VaultSecretType.API_KEY).toBe("api_key");
    expect(VaultSecretType.OTHER).toBe("other");
  });
});

describe("VaultKeyType", () => {
  it("has correct values", () => {
    expect(VaultKeyType.PRIMARY).toBe("primary");
    expect(VaultKeyType.RECOVERY).toBe("recovery");
  });
});

describe("serializePayload", () => {
  it("login uses snake_case", () => {
    const s = serializePayload("login", { username: "a", password: "b" });
    expect(s).toEqual({ username: "a", password: "b" });
  });
  it("ssh_key uses snake_case", () => {
    const s = serializePayload("ssh_key", { privateKey: "---", publicKey: "pub" });
    expect(s.private_key).toBe("---");
    expect(s.public_key).toBe("pub");
  });
  it("api_key uses snake_case", () => {
    const s = serializePayload("api_key", { key: "k", secret: "s", endpoint: "https://x" });
    expect(s.key).toBe("k");
    expect(s.secret).toBe("s");
    expect(s.endpoint).toBe("https://x");
  });
  it("other includes notes", () => {
    const s = serializePayload("other", { data: "stuff", notes: "ctx" });
    expect(s.data).toBe("stuff");
    expect(s.notes).toBe("ctx");
  });
});

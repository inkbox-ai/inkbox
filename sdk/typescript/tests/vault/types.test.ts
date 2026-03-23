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
    expect(inferSecretType({ accessKey: "k" })).toBe("api_key");
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
    const p = parsePayload("api_key", { access_key: "k", secret_key: "s" }) as APIKeyPayload;
    expect(p.accessKey).toBe("k");
    expect(p.secretKey).toBe("s");
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
    const s = serializePayload("api_key", { accessKey: "k", secretKey: "s", endpoint: "https://x" });
    expect(s.access_key).toBe("k");
    expect(s.secret_key).toBe("s");
    expect(s.endpoint).toBe("https://x");
  });
  it("other includes notes", () => {
    const s = serializePayload("other", { data: "stuff", notes: "ctx" });
    expect(s.data).toBe("stuff");
    expect(s.notes).toBe("ctx");
  });
  it("throws on unknown type", () => {
    expect(() => serializePayload("unknown_type", { data: "x" } as any)).toThrow(
      "Unknown secret_type: unknown_type",
    );
  });
});

describe("parsePayload throws on unknown type", () => {
  it("throws on unknown type", () => {
    expect(() => parsePayload("unknown_type", { foo: "bar" })).toThrow(
      "Unknown secret_type: unknown_type",
    );
  });
});

describe("SSHKeyPayload roundtrip with all optional fields", () => {
  it("serializePayload then parsePayload preserves all fields", () => {
    const original: SSHKeyPayload = {
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      publicKey: "ssh-ed25519 AAAA...",
      fingerprint: "SHA256:abc123",
      passphrase: "my-passphrase",
      notes: "production bastion host key",
    };
    const serialized = serializePayload("ssh_key", original);
    expect(serialized).toEqual({
      private_key: "-----BEGIN OPENSSH PRIVATE KEY-----",
      public_key: "ssh-ed25519 AAAA...",
      fingerprint: "SHA256:abc123",
      passphrase: "my-passphrase",
      notes: "production bastion host key",
    });
    const parsed = parsePayload("ssh_key", serialized) as SSHKeyPayload;
    expect(parsed).toEqual(original);
  });
});

describe("APIKeyPayload roundtrip with all optional fields", () => {
  it("serializePayload then parsePayload preserves all fields", () => {
    const original: APIKeyPayload = {
      accessKey: "AKIAIOSFODNN7EXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      endpoint: "https://api.example.com/v2",
      notes: "AWS production access key",
    };
    const serialized = serializePayload("api_key", original);
    expect(serialized).toEqual({
      access_key: "AKIAIOSFODNN7EXAMPLE",
      secret_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      endpoint: "https://api.example.com/v2",
      notes: "AWS production access key",
    });
    const parsed = parsePayload("api_key", serialized) as APIKeyPayload;
    expect(parsed).toEqual(original);
  });
});

describe("OtherPayload roundtrip with notes", () => {
  it("serializePayload then parsePayload preserves data and notes", () => {
    const original: OtherPayload = {
      data: "some freeform secret content\nwith newlines",
      notes: "important context about this secret",
    };
    const serialized = serializePayload("other", original);
    expect(serialized).toEqual({
      data: "some freeform secret content\nwith newlines",
      notes: "important context about this secret",
    });
    const parsed = parsePayload("other", serialized) as OtherPayload;
    expect(parsed).toEqual(original);
  });
});

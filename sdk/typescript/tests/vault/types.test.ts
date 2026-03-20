import { describe, it, expect } from "vitest";
import {
  parseVaultInfo,
  parseVaultKey,
  parseVaultSecret,
  parseVaultSecretDetail,
  inferSecretType,
  parsePayload,
  serializePayload,
} from "../../src/vault/types.js";
import type {
  RawVaultInfo,
  RawVaultKey,
  RawVaultSecret,
  RawVaultSecretDetail,
  LoginPayload,
  CardPayload,
  NotePayload,
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
  label: "Admin Key",
  created_by: "user_abc",
  status: "active",
  created_at: "2026-03-18T12:00:00Z",
  updated_at: "2026-03-18T12:00:00Z",
};

const RAW_SECRET: RawVaultSecret = {
  id: "cccc3333-0000-0000-0000-000000000001",
  label: "AWS Production",
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
    expect(key.label).toBe("Admin Key");
    expect(key.createdBy).toBe("user_abc");
  });
});

describe("parseVaultSecret", () => {
  it("parses all fields", () => {
    const s = parseVaultSecret(RAW_SECRET);
    expect(s.label).toBe("AWS Production");
    expect(s.secretType).toBe("login");
    expect(s.createdAt).toBeInstanceOf(Date);
  });
});

describe("parseVaultSecretDetail", () => {
  it("includes encrypted payload", () => {
    const raw: RawVaultSecretDetail = { ...RAW_SECRET, encrypted_payload: "abc123" };
    const s = parseVaultSecretDetail(raw);
    expect(s.encryptedPayload).toBe("abc123");
    expect(s.label).toBe("AWS Production");
  });
});

describe("inferSecretType", () => {
  it("login", () => {
    expect(inferSecretType({ username: "a", password: "b" })).toBe("login");
  });
  it("card", () => {
    expect(
      inferSecretType({
        cardholderName: "A",
        cardNumber: "4111",
        expiryMonth: "01",
        expiryYear: "27",
        cvv: "123",
      }),
    ).toBe("card");
  });
  it("note", () => {
    expect(inferSecretType({ content: "x" })).toBe("note");
  });
  it("ssh_key", () => {
    expect(inferSecretType({ privateKey: "..." })).toBe("ssh_key");
  });
  it("api_key", () => {
    expect(inferSecretType({ key: "k" })).toBe("api_key");
  });
});

describe("parsePayload", () => {
  it("login", () => {
    const p = parsePayload("login", { username: "a", password: "b", url: "https://x" }) as LoginPayload;
    expect(p.username).toBe("a");
    expect(p.url).toBe("https://x");
  });
  it("card", () => {
    const p = parsePayload("card", {
      cardholder_name: "A",
      card_number: "4111",
      expiry_month: "01",
      expiry_year: "27",
      cvv: "123",
    }) as CardPayload;
    expect(p.cardholderName).toBe("A");
  });
  it("note", () => {
    const p = parsePayload("note", { content: "hello" }) as NotePayload;
    expect(p.content).toBe("hello");
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
});

describe("serializePayload", () => {
  it("login uses snake_case", () => {
    const s = serializePayload("login", { username: "a", password: "b" });
    expect(s).toEqual({ username: "a", password: "b" });
  });
  it("card uses snake_case", () => {
    const s = serializePayload("card", {
      cardholderName: "A",
      cardNumber: "4111",
      expiryMonth: "01",
      expiryYear: "27",
      cvv: "123",
    });
    expect(s.cardholder_name).toBe("A");
    expect(s.card_number).toBe("4111");
  });
  it("ssh_key uses snake_case", () => {
    const s = serializePayload("ssh_key", { privateKey: "---", publicKey: "pub" });
    expect(s.private_key).toBe("---");
    expect(s.public_key).toBe("pub");
  });
});

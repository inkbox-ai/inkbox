import { describe, it, expect } from "vitest";
import {
  deriveSalt,
  deriveMasterKey,
  computeAuthHash,
  wrapOrgKey,
  unwrapOrgKey,
  encryptPayload,
  decryptPayload,
  generateOrgEncryptionKey,
  generateVaultKeyMaterial,
  generateRecoveryCode,
} from "../../src/vault/crypto.js";

describe("deriveSalt", () => {
  it("is deterministic", () => {
    expect(deriveSalt("org_test_123")).toEqual(deriveSalt("org_test_123"));
  });

  it("differs for different orgs", () => {
    expect(deriveSalt("org_a")).not.toEqual(deriveSalt("org_b"));
  });

  it("returns UTF-8 encoded org ID", () => {
    const salt = deriveSalt("org_test_123");
    expect(new TextDecoder().decode(salt)).toBe("org_test_123");
  });
});

describe("deriveMasterKey + computeAuthHash", () => {
  it("same password and salt produce same key", async () => {
    const salt = deriveSalt("org_test_123");
    const k1 = await deriveMasterKey("password", salt);
    const k2 = await deriveMasterKey("password", salt);
    expect(k1).toEqual(k2);
  });

  it("different passwords produce different keys", async () => {
    const salt = deriveSalt("org_test_123");
    const k1 = await deriveMasterKey("pw_a", salt);
    const k2 = await deriveMasterKey("pw_b", salt);
    expect(k1).not.toEqual(k2);
  });

  it("master key is 32 bytes", async () => {
    const mk = await deriveMasterKey("pw", deriveSalt("org_test_123"));
    expect(mk.length).toBe(32);
  });

  it("auth hash is 64-char hex", async () => {
    const mk = await deriveMasterKey("pw", deriveSalt("org_test_123"));
    const h = computeAuthHash(mk);
    expect(h.length).toBe(64);
    expect(/^[0-9a-f]{64}$/.test(h)).toBe(true);
  });
});

describe("wrapOrgKey / unwrapOrgKey", () => {
  it("roundtrips correctly", async () => {
    const mk = await deriveMasterKey("pw", deriveSalt("org_test_wrap"));
    const orgKey = generateOrgEncryptionKey();
    const wrapped = wrapOrgKey(mk, orgKey);
    expect(typeof wrapped).toBe("string");
    const recovered = unwrapOrgKey(mk, wrapped);
    expect(Buffer.from(recovered)).toEqual(Buffer.from(orgKey));
  });

  it("wrong key fails", async () => {
    const salt = deriveSalt("org_test_wrap");
    const mk1 = await deriveMasterKey("right", salt);
    const mk2 = await deriveMasterKey("wrong", salt);
    const orgKey = generateOrgEncryptionKey();
    const wrapped = wrapOrgKey(mk1, orgKey);
    expect(() => unwrapOrgKey(mk2, wrapped)).toThrow();
  });
});

describe("encryptPayload / decryptPayload", () => {
  it("roundtrips correctly", () => {
    const orgKey = generateOrgEncryptionKey();
    const payload = { username: "admin", password: "s3cret" };
    const enc = encryptPayload(orgKey, payload);
    expect(typeof enc).toBe("string");
    const dec = decryptPayload(orgKey, enc);
    expect(dec).toEqual(payload);
  });

  it("wrong key fails", () => {
    const k1 = generateOrgEncryptionKey();
    const k2 = generateOrgEncryptionKey();
    const enc = encryptPayload(k1, { a: 1 });
    expect(() => decryptPayload(k2, enc)).toThrow();
  });
});

describe("generateVaultKeyMaterial", () => {
  it("roundtrips with re-derived master key", async () => {
    const orgKey = generateOrgEncryptionKey();
    const mat = await generateVaultKeyMaterial("pw", "org_test_123", orgKey);
    expect(mat.keyType).toBe("primary");

    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey("pw", salt);
    expect(computeAuthHash(mk)).toBe(mat.authHash);
    const recovered = unwrapOrgKey(mk, mat.wrappedOrgEncryptionKey);
    expect(Buffer.from(recovered)).toEqual(Buffer.from(orgKey));
  });

  it("accepts type option", async () => {
    const orgKey = generateOrgEncryptionKey();
    const mat = await generateVaultKeyMaterial("pw", "org_test_123", orgKey, {
      keyType: "recovery",
    });
    expect(mat.keyType).toBe("recovery");
  });
});

describe("generateRecoveryCode", () => {
  it("produces XXXX-XXXX-... format", async () => {
    const orgKey = generateOrgEncryptionKey();
    const [code, mat] = await generateRecoveryCode("org_test_123", orgKey);
    const parts = code.split("-");
    expect(parts.length).toBe(8);
    parts.forEach((p) => expect(p.length).toBe(4));
    expect(mat.keyType).toBe("recovery");
  });

  it("roundtrips with re-derived master key", async () => {
    const orgKey = generateOrgEncryptionKey();
    const [code, mat] = await generateRecoveryCode("org_test_123", orgKey);
    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey(code, salt);
    expect(computeAuthHash(mk)).toBe(mat.authHash);
    const recovered = unwrapOrgKey(mk, mat.wrappedOrgEncryptionKey);
    expect(Buffer.from(recovered)).toEqual(Buffer.from(orgKey));
  });

  it("generates unique codes", async () => {
    const orgKey = generateOrgEncryptionKey();
    const [c1] = await generateRecoveryCode("org_test_123", orgKey);
    const [c2] = await generateRecoveryCode("org_test_123", orgKey);
    expect(c1).not.toBe(c2);
  });
});

describe("cross-SDK compatibility", () => {
  it("produces matching auth_hash for known inputs", async () => {
    // This value was verified against the Python SDK
    const salt = deriveSalt("org_test_123");
    const mk = await deriveMasterKey("test-password", salt);
    const hash = computeAuthHash(mk);
    expect(hash.startsWith("056863c98cd0759f")).toBe(true);
  });
});

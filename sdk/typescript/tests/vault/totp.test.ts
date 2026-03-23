/**
 * tests/vault/totp.test.ts
 *
 * Comprehensive tests for TOTP support: TOTPConfig, TOTPCode, generateTotp,
 * parseTotpUri, and LoginPayload integration.
 */

import { describe, it, expect, vi } from "vitest";
import {
  TOTPAlgorithm,
  generateTotp,
  parseTotpUri,
  validateTotpConfig,
  serializeTotpConfig,
  parseTotpConfig,
} from "../../src/vault/totp.js";
import type { TOTPConfig, TOTPCode } from "../../src/vault/totp.js";
import { serializePayload, parsePayload } from "../../src/vault/types.js";
import type { LoginPayload } from "../../src/vault/types.js";

// RFC 6238 appendix B secret: ASCII "12345678901234567890"
const RFC_SECRET_SHA1 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTPAlgorithm", () => {
  it("has correct values", () => {
    expect(TOTPAlgorithm.SHA1).toBe("sha1");
    expect(TOTPAlgorithm.SHA256).toBe("sha256");
    expect(TOTPAlgorithm.SHA512).toBe("sha512");
  });
});

describe("validateTotpConfig", () => {
  it("accepts valid config", () => {
    expect(() =>
      validateTotpConfig({ secret: "JBSWY3DPEHPK3PXP" }),
    ).not.toThrow();
  });

  it("accepts all valid options", () => {
    expect(() =>
      validateTotpConfig({
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "sha256",
        digits: 8,
        period: 60,
      }),
    ).not.toThrow();
  });

  it("rejects invalid digits", () => {
    expect(() =>
      validateTotpConfig({ secret: "JBSWY3DPEHPK3PXP", digits: 7 }),
    ).toThrow("digits must be 6 or 8");
  });

  it("rejects invalid period", () => {
    expect(() =>
      validateTotpConfig({ secret: "JBSWY3DPEHPK3PXP", period: 45 }),
    ).toThrow("period must be 30 or 60");
  });

  it("rejects invalid algorithm", () => {
    expect(() =>
      validateTotpConfig({
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "md5" as TOTPConfig["algorithm"],
      }),
    ).toThrow("algorithm must be sha1, sha256, or sha512");
  });
});

describe("generateTotp", () => {
  it("returns a TOTPCode with correct structure", () => {
    const config: TOTPConfig = { secret: RFC_SECRET_SHA1 };
    const result = generateTotp(config);
    expect(result.code).toHaveLength(6);
    expect(result.code).toMatch(/^\d{6}$/);
    expect(result.periodEnd - result.periodStart).toBe(30);
    expect(result.secondsRemaining).toBeGreaterThan(0);
    expect(result.secondsRemaining).toBeLessThanOrEqual(30);
  });

  it("generates 8-digit codes", () => {
    const config: TOTPConfig = { secret: RFC_SECRET_SHA1, digits: 8 };
    const result = generateTotp(config);
    expect(result.code).toHaveLength(8);
  });

  it("handles 60-second period", () => {
    const config: TOTPConfig = { secret: RFC_SECRET_SHA1, period: 60 };
    const result = generateTotp(config);
    expect(result.periodEnd - result.periodStart).toBe(60);
  });

  it("produces known code at time=59 (RFC 6238 vector)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(59 * 1000));
    try {
      const config: TOTPConfig = {
        secret: RFC_SECRET_SHA1,
        digits: 8,
        period: 30,
      };
      const result = generateTotp(config);
      expect(result.code).toBe("94287082");
    } finally {
      vi.useRealTimers();
    }
  });

  it("produces known code at time=1111111109 (RFC 6238 vector)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1111111109 * 1000));
    try {
      const config: TOTPConfig = {
        secret: RFC_SECRET_SHA1,
        digits: 8,
        period: 30,
      };
      const result = generateTotp(config);
      expect(result.code).toBe("07081804");
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("parseTotpUri", () => {
  it("parses full URI", () => {
    const uri =
      "otpauth://totp/GitHub:user@example.com?secret=JBSWY3DPEHPK3PXP&issuer=GitHub&algorithm=SHA256&digits=8&period=60";
    const config = parseTotpUri(uri);
    expect(config.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(config.issuer).toBe("GitHub");
    expect(config.accountName).toBe("user@example.com");
    expect(config.algorithm).toBe("sha256");
    expect(config.digits).toBe(8);
    expect(config.period).toBe(60);
  });

  it("parses minimal URI with defaults", () => {
    const uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP";
    const config = parseTotpUri(uri);
    expect(config.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(config.algorithm).toBe("sha1");
    expect(config.digits).toBe(6);
    expect(config.period).toBe(30);
    expect(config.issuer).toBeUndefined();
  });

  it("extracts issuer from label", () => {
    const uri = "otpauth://totp/MyApp:alice?secret=JBSWY3DPEHPK3PXP";
    const config = parseTotpUri(uri);
    expect(config.issuer).toBe("MyApp");
    expect(config.accountName).toBe("alice");
  });

  it("issuer param overrides label", () => {
    const uri =
      "otpauth://totp/OldIssuer:alice?secret=JBSWY3DPEHPK3PXP&issuer=NewIssuer";
    const config = parseTotpUri(uri);
    expect(config.issuer).toBe("NewIssuer");
  });

  it("uppercases secret", () => {
    const uri = "otpauth://totp/?secret=jbswy3dpehpk3pxp";
    const config = parseTotpUri(uri);
    expect(config.secret).toBe("JBSWY3DPEHPK3PXP");
  });

  it("rejects HOTP", () => {
    const uri = "otpauth://hotp/?secret=JBSWY3DPEHPK3PXP&counter=0";
    expect(() => parseTotpUri(uri)).toThrow("HOTP is not supported");
  });

  it("rejects invalid scheme", () => {
    const uri = "https://example.com/totp?secret=JBSWY3DPEHPK3PXP";
    expect(() => parseTotpUri(uri)).toThrow("Invalid scheme");
  });

  it("rejects missing secret", () => {
    const uri = "otpauth://totp/?issuer=GitHub";
    expect(() => parseTotpUri(uri)).toThrow("Missing required 'secret'");
  });

  it("rejects invalid algorithm", () => {
    const uri =
      "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&algorithm=MD5";
    expect(() => parseTotpUri(uri)).toThrow("Invalid algorithm");
  });

  it("rejects invalid digits", () => {
    const uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&digits=7";
    expect(() => parseTotpUri(uri)).toThrow("Invalid digits");
  });

  it("rejects invalid period", () => {
    const uri = "otpauth://totp/?secret=JBSWY3DPEHPK3PXP&period=45";
    expect(() => parseTotpUri(uri)).toThrow("Invalid period");
  });

  it("rejects invalid base32 secret", () => {
    const uri = "otpauth://totp/?secret=!!!invalid!!!";
    expect(() => parseTotpUri(uri)).toThrow("Invalid base32");
  });
});

describe("TOTPConfig serialization", () => {
  it("serializeTotpConfig omits undefined", () => {
    const config: TOTPConfig = { secret: "JBSWY3DPEHPK3PXP" };
    const d = serializeTotpConfig(config);
    expect(d.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(d).not.toHaveProperty("issuer");
    expect(d).not.toHaveProperty("account_name");
  });

  it("serializeTotpConfig includes all fields", () => {
    const config: TOTPConfig = {
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "sha256",
      digits: 8,
      period: 60,
      issuer: "GitHub",
      accountName: "user@example.com",
    };
    const d = serializeTotpConfig(config);
    expect(d.algorithm).toBe("sha256");
    expect(d.digits).toBe(8);
    expect(d.period).toBe(60);
    expect(d.issuer).toBe("GitHub");
    expect(d.account_name).toBe("user@example.com");
  });

  it("parseTotpConfig roundtrip", () => {
    const original: TOTPConfig = {
      secret: "JBSWY3DPEHPK3PXP",
      algorithm: "sha256",
      digits: 8,
      period: 60,
      issuer: "GitHub",
      accountName: "user@example.com",
    };
    const wire = serializeTotpConfig(original);
    const restored = parseTotpConfig(wire);
    expect(restored.secret).toBe(original.secret);
    expect(restored.algorithm).toBe(original.algorithm);
    expect(restored.digits).toBe(original.digits);
    expect(restored.period).toBe(original.period);
    expect(restored.issuer).toBe(original.issuer);
    expect(restored.accountName).toBe(original.accountName);
  });
});

describe("LoginPayload with TOTP", () => {
  const totp: TOTPConfig = {
    secret: "JBSWY3DPEHPK3PXP",
    algorithm: "sha256",
    digits: 8,
    period: 60,
    issuer: "GitHub",
    accountName: "user@example.com",
  };

  it("serializes login with totp", () => {
    const payload: LoginPayload = {
      password: "secret",
      username: "admin",
      totp,
    };
    const d = serializePayload("login", payload);
    expect(d.totp).toBeDefined();
    expect((d.totp as Record<string, unknown>).secret).toBe(
      "JBSWY3DPEHPK3PXP",
    );
    expect((d.totp as Record<string, unknown>).account_name).toBe(
      "user@example.com",
    );
  });

  it("serializes login without totp", () => {
    const payload: LoginPayload = { password: "secret", username: "admin" };
    const d = serializePayload("login", payload);
    expect(d).not.toHaveProperty("totp");
  });

  it("parses login with totp", () => {
    const raw = {
      password: "secret",
      username: "admin",
      totp: {
        secret: "JBSWY3DPEHPK3PXP",
        algorithm: "sha256",
        digits: 8,
        period: 60,
        issuer: "GitHub",
        account_name: "user@example.com",
      },
    };
    const payload = parsePayload("login", raw) as LoginPayload;
    expect(payload.totp).toBeDefined();
    expect(payload.totp!.secret).toBe("JBSWY3DPEHPK3PXP");
    expect(payload.totp!.algorithm).toBe("sha256");
    expect(payload.totp!.accountName).toBe("user@example.com");
  });

  it("parses login without totp (backward compat)", () => {
    const raw = { password: "secret", username: "admin" };
    const payload = parsePayload("login", raw) as LoginPayload;
    expect(payload.totp).toBeUndefined();
  });
});

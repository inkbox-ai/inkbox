/**
 * inkbox-vault/totp.ts
 *
 * Client-side TOTP (RFC 6238) implementation.
 */

import { createHmac } from "node:crypto";

// ---- Enums ----

/**
 * Hash algorithm for TOTP code generation.
 *
 * Values are lowercase to match `otpauth://` URI convention.
 */
export const TOTPAlgorithm = {
  SHA1: "sha1",
  SHA256: "sha256",
  SHA512: "sha512",
} as const;
export type TOTPAlgorithm = (typeof TOTPAlgorithm)[keyof typeof TOTPAlgorithm];

// ---- Types ----

/** A generated TOTP code with timing metadata. */
export interface TOTPCode {
  /** The OTP code string (e.g. `"482901"`). */
  code: string;
  /** Unix timestamp when this code became valid. */
  periodStart: number;
  /** Unix timestamp when this code expires. */
  periodEnd: number;
  /** Seconds left until expiry. */
  secondsRemaining: number;
}

/**
 * TOTP configuration stored inside a {@link LoginPayload}.
 */
export interface TOTPConfig {
  /** Base32-encoded shared secret. */
  secret: string;
  /** Hash algorithm (default `"sha1"`). */
  algorithm?: TOTPAlgorithm;
  /** Number of digits in the OTP code (6 or 8, default 6). */
  digits?: number;
  /** Time step in seconds (30 or 60, default 30). */
  period?: number;
  /** Optional issuer name (e.g. `"GitHub"`). */
  issuer?: string;
  /** Optional account identifier (e.g. `"user@example.com"`). */
  accountName?: string;
}

// ---- Validation ----

const VALID_ALGORITHMS: readonly string[] = ["sha1", "sha256", "sha512"];
const VALID_DIGITS = new Set([6, 8]);
const VALID_PERIODS = new Set([30, 60]);

/**
 * Validate a TOTPConfig's fields.
 *
 * @throws Error if any field is invalid.
 */
export function validateTotpConfig(config: TOTPConfig): void {
  const digits = config.digits ?? 6;
  if (!VALID_DIGITS.has(digits)) {
    throw new Error(`digits must be 6 or 8, got ${digits}`);
  }
  const period = config.period ?? 30;
  if (!VALID_PERIODS.has(period)) {
    throw new Error(`period must be 30 or 60, got ${period}`);
  }
  const alg = config.algorithm ?? "sha1";
  if (!VALID_ALGORITHMS.includes(alg)) {
    throw new Error(`algorithm must be sha1, sha256, or sha512, got ${alg}`);
  }
}

// ---- Internal helpers ----

/**
 * Decode a base32 secret, adding padding if needed.
 * @internal
 */
function b32decode(secret: string): Buffer {
  const upper = secret.toUpperCase();
  const padded = upper + "=".repeat((8 - (upper.length % 8)) % 8);
  // Node's Buffer does not have native base32; decode manually.
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits: number[] = [];
  for (const ch of padded) {
    if (ch === "=") break;
    const idx = alphabet.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base32 secret: '${secret}'`);
    for (let i = 4; i >= 0; i--) {
      bits.push((idx >> i) & 1);
    }
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    bytes.push(byte);
  }
  return Buffer.from(bytes);
}

/**
 * Generate an HOTP code per RFC 4226 (internal helper).
 * @internal
 */
function generateHotp(
  secret: string,
  counter: number,
  algorithm: TOTPAlgorithm = "sha1",
  digits: number = 6,
): string {
  const key = b32decode(secret);
  const msg = Buffer.alloc(8);
  // Write counter as big-endian u64
  msg.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  msg.writeUInt32BE(counter >>> 0, 4);

  const h = createHmac(algorithm, key).update(msg).digest();
  const offset = h[h.length - 1] & 0x0f;
  const code =
    ((h[offset] & 0x7f) << 24) |
    ((h[offset + 1] & 0xff) << 16) |
    ((h[offset + 2] & 0xff) << 8) |
    (h[offset + 3] & 0xff);

  return String(code % 10 ** digits).padStart(digits, "0");
}

// ---- Public API ----

/**
 * Generate the current TOTP code per RFC 6238.
 *
 * @param config - TOTP configuration with the shared secret and parameters.
 * @returns A {@link TOTPCode} with the code and timing metadata.
 */
export function generateTotp(config: TOTPConfig): TOTPCode {
  validateTotpConfig(config);

  const algorithm = config.algorithm ?? "sha1";
  const digits = config.digits ?? 6;
  const period = config.period ?? 30;

  const now = Math.floor(Date.now() / 1000);
  const counter = Math.floor(now / period);
  const periodStart = counter * period;
  const periodEnd = periodStart + period;
  const secondsRemaining = periodEnd - now;

  const code = generateHotp(config.secret, counter, algorithm, digits);

  return { code, periodStart, periodEnd, secondsRemaining };
}

/**
 * Parse an `otpauth://totp/...` URI into a {@link TOTPConfig}.
 *
 * Supports the Google Authenticator Key URI format.
 * Rejects HOTP URIs with an error.
 *
 * @param uri - The full `otpauth://` URI string.
 * @returns A validated {@link TOTPConfig}.
 * @throws Error on invalid scheme, HOTP type, missing secret, or invalid parameters.
 */
export function parseTotpUri(uri: string): TOTPConfig {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    throw new Error(`Invalid URI: ${uri}`);
  }

  if (parsed.protocol !== "otpauth:") {
    throw new Error(
      `Invalid scheme: expected 'otpauth', got '${parsed.protocol.replace(":", "")}'`,
    );
  }

  const otpType = parsed.hostname;
  if (otpType === "hotp") {
    throw new Error("HOTP is not supported — only TOTP URIs are accepted");
  }
  if (otpType !== "totp") {
    throw new Error(`Invalid OTP type: expected 'totp', got '${otpType}'`);
  }

  // Parse label — path is /<label>, label is [Issuer:]AccountName
  const label = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  let labelIssuer: string | undefined;
  let accountName: string | undefined;
  if (label.includes(":")) {
    const [issuerPart, ...rest] = label.split(":");
    labelIssuer = issuerPart.trim();
    accountName = rest.join(":").trim();
  } else {
    accountName = label.trim() || undefined;
  }

  // Secret (required)
  const secret = parsed.searchParams.get("secret");
  if (!secret) {
    throw new Error("Missing required 'secret' parameter");
  }
  const secretUpper = secret.toUpperCase();
  b32decode(secretUpper); // validate

  // Issuer — query param takes precedence over label prefix
  const issuer = parsed.searchParams.get("issuer") || labelIssuer || undefined;

  // Algorithm
  const algorithmStr = (
    parsed.searchParams.get("algorithm") || "sha1"
  ).toLowerCase();
  if (!VALID_ALGORITHMS.includes(algorithmStr)) {
    throw new Error(
      `Invalid algorithm: '${algorithmStr}'. Must be one of: sha1, sha256, sha512`,
    );
  }
  const algorithm = algorithmStr as TOTPAlgorithm;

  // Digits
  const digitsStr = parsed.searchParams.get("digits") || "6";
  const digits = parseInt(digitsStr, 10);
  if (isNaN(digits) || !VALID_DIGITS.has(digits)) {
    throw new Error(`Invalid digits: '${digitsStr}'. Must be 6 or 8`);
  }

  // Period
  const periodStr = parsed.searchParams.get("period") || "30";
  const period = parseInt(periodStr, 10);
  if (isNaN(period) || !VALID_PERIODS.has(period)) {
    throw new Error(`Invalid period: '${periodStr}'. Must be 30 or 60`);
  }

  const config: TOTPConfig = {
    secret: secretUpper,
    algorithm,
    digits,
    period,
    issuer,
    accountName: accountName || undefined,
  };
  validateTotpConfig(config);
  return config;
}

// ---- Serialization helpers for wire format (camelCase ↔ snake_case) ----

/** Serialize a TOTPConfig to the snake_case wire format. @internal */
export function serializeTotpConfig(
  config: TOTPConfig,
): Record<string, unknown> {
  const d: Record<string, unknown> = {
    secret: config.secret,
  };
  if (config.algorithm !== undefined) d.algorithm = config.algorithm;
  if (config.digits !== undefined) d.digits = config.digits;
  if (config.period !== undefined) d.period = config.period;
  if (config.issuer !== undefined) d.issuer = config.issuer;
  if (config.accountName !== undefined) d.account_name = config.accountName;
  return d;
}

/** Parse a TOTPConfig from the snake_case wire format. @internal */
export function parseTotpConfig(
  raw: Record<string, unknown>,
): TOTPConfig {
  const config: TOTPConfig = {
    secret: raw.secret as string,
    algorithm: (raw.algorithm as TOTPAlgorithm) ?? "sha1",
    digits: (raw.digits as number) ?? 6,
    period: (raw.period as number) ?? 30,
    issuer: raw.issuer as string | undefined,
    accountName: (raw.account_name as string) ?? undefined,
  };
  validateTotpConfig(config);
  return config;
}

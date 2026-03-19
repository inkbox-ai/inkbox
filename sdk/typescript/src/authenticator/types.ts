/**
 * inkbox-authenticator TypeScript SDK — public types.
 */

// ---- public types (camelCase) ----

export interface AuthenticatorApp {
  id: string;
  organizationId: string;
  identityId: string | null;
  /** "active" | "paused" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AuthenticatorAccount {
  id: string;
  authenticatorAppId: string;
  /** "totp" | "hotp" */
  otpType: string;
  issuer: string | null;
  accountName: string | null;
  displayName: string | null;
  description: string | null;
  /** "sha1" | "sha256" | "sha512" */
  algorithm: string;
  /** 6 | 8 */
  digits: number;
  /** TOTP period in seconds; null for HOTP */
  period: number | null;
  /** HOTP counter; null for TOTP */
  counter: number | null;
  /** "active" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OTPCode {
  otpCode: string;
  /** Seconds until code expires; null for HOTP */
  validForSeconds: number | null;
  /** "totp" | "hotp" */
  otpType: string;
  /** "sha1" | "sha256" | "sha512" */
  algorithm: string;
  /** 6 | 8 */
  digits: number;
  /** TOTP period in seconds; null for HOTP */
  period: number | null;
}

// ---- internal raw API shapes (snake_case from JSON) ----

export interface RawAuthenticatorApp {
  id: string;
  organization_id: string;
  identity_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawAuthenticatorAccount {
  id: string;
  authenticator_app_id: string;
  otp_type: string;
  issuer: string | null;
  account_name: string | null;
  display_name: string | null;
  description: string | null;
  algorithm: string;
  digits: number;
  period: number | null;
  counter: number | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawOTPCode {
  otp_code: string;
  valid_for_seconds: number | null;
  otp_type: string;
  algorithm: string;
  digits: number;
  period: number | null;
}

// ---- parsers ----

export function parseAuthenticatorApp(r: RawAuthenticatorApp): AuthenticatorApp {
  return {
    id: r.id,
    organizationId: r.organization_id,
    identityId: r.identity_id,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseAuthenticatorAccount(r: RawAuthenticatorAccount): AuthenticatorAccount {
  return {
    id: r.id,
    authenticatorAppId: r.authenticator_app_id,
    otpType: r.otp_type,
    issuer: r.issuer,
    accountName: r.account_name,
    displayName: r.display_name,
    description: r.description,
    algorithm: r.algorithm,
    digits: r.digits,
    period: r.period,
    counter: r.counter,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseOTPCode(r: RawOTPCode): OTPCode {
  return {
    otpCode: r.otp_code,
    validForSeconds: r.valid_for_seconds,
    otpType: r.otp_type,
    algorithm: r.algorithm,
    digits: r.digits,
    period: r.period,
  };
}

/**
 * inkbox-authenticator/resources/accounts.ts
 *
 * Authenticator account CRUD and OTP generation.
 */

import { HttpTransport } from "../../_http.js";
import {
  AuthenticatorAccount,
  OTPCode,
  RawAuthenticatorAccount,
  RawOTPCode,
  parseAuthenticatorAccount,
  parseOTPCode,
} from "../types.js";

export class AuthenticatorAccountsResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create a new authenticator account from an `otpauth://` URI.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   * @param options.otpauthUri - `otpauth://totp/...` or `otpauth://hotp/...` URI.
   * @param options.displayName - Optional user-managed label (max 255 characters).
   * @param options.description - Optional free-form notes.
   */
  async create(
    authenticatorAppId: string,
    options: {
      otpauthUri: string;
      displayName?: string;
      description?: string;
    },
  ): Promise<AuthenticatorAccount> {
    const body: Record<string, unknown> = { otpauth_uri: options.otpauthUri };
    if (options.displayName !== undefined) body["display_name"] = options.displayName;
    if (options.description !== undefined) body["description"] = options.description;
    const data = await this.http.post<RawAuthenticatorAccount>(
      `/apps/${authenticatorAppId}/accounts`,
      body,
    );
    return parseAuthenticatorAccount(data);
  }

  /**
   * List all non-deleted authenticator accounts for an app.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   */
  async list(authenticatorAppId: string): Promise<AuthenticatorAccount[]> {
    const data = await this.http.get<RawAuthenticatorAccount[]>(
      `/apps/${authenticatorAppId}/accounts`,
    );
    return data.map(parseAuthenticatorAccount);
  }

  /**
   * Get a single authenticator account by ID.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   * @param accountId - UUID of the authenticator account.
   */
  async get(
    authenticatorAppId: string,
    accountId: string,
  ): Promise<AuthenticatorAccount> {
    const data = await this.http.get<RawAuthenticatorAccount>(
      `/apps/${authenticatorAppId}/accounts/${accountId}`,
    );
    return parseAuthenticatorAccount(data);
  }

  /**
   * Update user-managed account metadata.
   *
   * Only provided fields are applied; omitted fields are left unchanged.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   * @param accountId - UUID of the authenticator account to update.
   * @param options.displayName - New label (max 255 characters).
   * @param options.description - New notes.
   */
  async update(
    authenticatorAppId: string,
    accountId: string,
    options: {
      displayName?: string | null;
      description?: string | null;
    },
  ): Promise<AuthenticatorAccount> {
    const body: Record<string, unknown> = {};
    if ("displayName" in options) body["display_name"] = options.displayName;
    if ("description" in options) body["description"] = options.description;
    const data = await this.http.patch<RawAuthenticatorAccount>(
      `/apps/${authenticatorAppId}/accounts/${accountId}`,
      body,
    );
    return parseAuthenticatorAccount(data);
  }

  /**
   * Delete an authenticator account.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   * @param accountId - UUID of the authenticator account to delete.
   */
  async delete(
    authenticatorAppId: string,
    accountId: string,
  ): Promise<void> {
    await this.http.delete(`/apps/${authenticatorAppId}/accounts/${accountId}`);
  }

  /**
   * Generate the current OTP code for an account.
   *
   * For TOTP accounts, `validForSeconds` indicates time until expiry.
   * For HOTP accounts, the stored counter is incremented atomically
   * and `validForSeconds` is `null`.
   *
   * @param authenticatorAppId - UUID of the parent authenticator app.
   * @param accountId - UUID of the authenticator account.
   */
  async generateOtp(
    authenticatorAppId: string,
    accountId: string,
  ): Promise<OTPCode> {
    const data = await this.http.post<RawOTPCode>(
      `/apps/${authenticatorAppId}/accounts/${accountId}/generate-otp`,
    );
    return parseOTPCode(data);
  }
}

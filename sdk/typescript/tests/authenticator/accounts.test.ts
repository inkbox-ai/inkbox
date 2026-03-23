// sdk/typescript/tests/authenticator/accounts.test.ts
import { describe, it, expect, vi } from "vitest";
import { AuthenticatorAccountsResource } from "../../src/authenticator/resources/accounts.js";
import type { HttpTransport } from "../../src/_http.js";
import { RAW_AUTHENTICATOR_ACCOUNT, RAW_OTP_CODE } from "../sampleData.js";

function mockHttp() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  } as unknown as HttpTransport;
}

const APP_ID = "cccc3333-0000-0000-0000-000000000001";
const ACCOUNT_ID = "dddd4444-0000-0000-0000-000000000001";
const OTPAUTH_URI = "otpauth://totp/GitHub:alice@example.com?secret=EXAMPLESECRET&issuer=GitHub";

describe("AuthenticatorAccountsResource.create", () => {
  it("creates account with all fields", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_AUTHENTICATOR_ACCOUNT);
    const res = new AuthenticatorAccountsResource(http);

    const account = await res.create(APP_ID, {
      otpauthUri: OTPAUTH_URI,
      displayName: "GitHub Work",
      description: "Primary engineering account",
    });

    expect(http.post).toHaveBeenCalledWith(`/apps/${APP_ID}/accounts`, {
      otpauth_uri: OTPAUTH_URI,
      display_name: "GitHub Work",
      description: "Primary engineering account",
    });
    expect(account.otpType).toBe("totp");
    expect(account.issuer).toBe("GitHub");
  });

  it("creates account with minimal fields", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_AUTHENTICATOR_ACCOUNT);
    const res = new AuthenticatorAccountsResource(http);

    await res.create(APP_ID, { otpauthUri: OTPAUTH_URI });

    const [, body] = vi.mocked(http.post).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["display_name"]).toBeUndefined();
    expect(body["description"]).toBeUndefined();
  });
});

describe("AuthenticatorAccountsResource.list", () => {
  it("returns list of accounts", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([RAW_AUTHENTICATOR_ACCOUNT]);
    const res = new AuthenticatorAccountsResource(http);

    const accounts = await res.list(APP_ID);

    expect(http.get).toHaveBeenCalledWith(`/apps/${APP_ID}/accounts`);
    expect(accounts).toHaveLength(1);
    expect(accounts[0].id).toBe(ACCOUNT_ID);
  });

  it("returns empty list", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue([]);
    const res = new AuthenticatorAccountsResource(http);

    expect(await res.list(APP_ID)).toEqual([]);
  });
});

describe("AuthenticatorAccountsResource.get", () => {
  it("returns a single account", async () => {
    const http = mockHttp();
    vi.mocked(http.get).mockResolvedValue(RAW_AUTHENTICATOR_ACCOUNT);
    const res = new AuthenticatorAccountsResource(http);

    const account = await res.get(APP_ID, ACCOUNT_ID);

    expect(http.get).toHaveBeenCalledWith(`/apps/${APP_ID}/accounts/${ACCOUNT_ID}`);
    expect(account.id).toBe(ACCOUNT_ID);
  });
});

describe("AuthenticatorAccountsResource.update", () => {
  it("sends provided fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({
      ...RAW_AUTHENTICATOR_ACCOUNT,
      display_name: "Renamed",
    });
    const res = new AuthenticatorAccountsResource(http);

    const account = await res.update(APP_ID, ACCOUNT_ID, { displayName: "Renamed" });

    expect(http.patch).toHaveBeenCalledWith(
      `/apps/${APP_ID}/accounts/${ACCOUNT_ID}`,
      { display_name: "Renamed" },
    );
    expect(account.displayName).toBe("Renamed");
  });

  it("sends null to clear a field", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue({
      ...RAW_AUTHENTICATOR_ACCOUNT,
      description: null,
    });
    const res = new AuthenticatorAccountsResource(http);

    await res.update(APP_ID, ACCOUNT_ID, { description: null });

    const [, body] = vi.mocked(http.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["description"]).toBeNull();
  });

  it("omits undefined fields", async () => {
    const http = mockHttp();
    vi.mocked(http.patch).mockResolvedValue(RAW_AUTHENTICATOR_ACCOUNT);
    const res = new AuthenticatorAccountsResource(http);

    await res.update(APP_ID, ACCOUNT_ID, { displayName: "Test" });

    const [, body] = vi.mocked(http.patch).mock.calls[0] as [string, Record<string, unknown>];
    expect(body["description"]).toBeUndefined();
  });
});

describe("AuthenticatorAccountsResource.delete", () => {
  it("calls delete on the correct path", async () => {
    const http = mockHttp();
    vi.mocked(http.delete).mockResolvedValue(undefined);
    const res = new AuthenticatorAccountsResource(http);

    await res.delete(APP_ID, ACCOUNT_ID);

    expect(http.delete).toHaveBeenCalledWith(`/apps/${APP_ID}/accounts/${ACCOUNT_ID}`);
  });
});

describe("AuthenticatorAccountsResource.generateOtp", () => {
  it("generates and returns OTP code", async () => {
    const http = mockHttp();
    vi.mocked(http.post).mockResolvedValue(RAW_OTP_CODE);
    const res = new AuthenticatorAccountsResource(http);

    const otp = await res.generateOtp(APP_ID, ACCOUNT_ID);

    expect(http.post).toHaveBeenCalledWith(
      `/apps/${APP_ID}/accounts/${ACCOUNT_ID}/generate-otp`,
    );
    expect(otp.otpCode).toBe("123456");
    expect(otp.validForSeconds).toBe(17);
    expect(otp.otpType).toBe("totp");
    expect(otp.algorithm).toBe("sha1");
    expect(otp.digits).toBe(6);
    expect(otp.period).toBe(30);
  });
});

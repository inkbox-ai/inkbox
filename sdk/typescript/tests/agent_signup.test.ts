// sdk/typescript/tests/agent_signup.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Inkbox } from "../src/inkbox.js";
import { InkboxAPIError } from "../src/_http.js";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetch(status: number, body: unknown, ok = status < 400) {
  vi.mocked(fetch).mockResolvedValue({
    ok,
    status,
    statusText: "Error",
    json: () => Promise.resolve(body),
  } as Response);
}

// ---- raw API fixtures (snake_case) ----

const RAW_SIGNUP_RESPONSE = {
  email_address: "agent@inkboxmail.com",
  organization_id: "org-123",
  api_key: "ApiKey_abc",
  agent_handle: "my-agent",
  claim_status: "unclaimed",
  human_email: "human@example.com",
  message: "Verification email sent",
};

const RAW_VERIFY_RESPONSE = {
  claim_status: "claimed",
  organization_id: "org-123",
  message: "Verified",
};

const RAW_RESEND_RESPONSE = {
  claim_status: "pending_verification",
  organization_id: "org_abc123",
  message: "Verification email resent",
};

const RAW_STATUS_RESPONSE = {
  claim_status: "unclaimed",
  human_state: "pending",
  human_email: "human@example.com",
  restrictions: {
    max_sends_per_day: 10,
    allowed_recipients: ["human@example.com"],
    can_receive: true,
    can_create_mailboxes: false,
  },
};

// ---- Tests ----

describe("Inkbox.signup", () => {
  it("sends POST to /api/v1/agent-signup with snake_case body and no auth header", async () => {
    mockFetch(200, RAW_SIGNUP_RESPONSE);

    const result = await Inkbox.signup({
      humanEmail: "human@example.com",
      displayName: "My Agent",
      noteToHuman: "Please approve me",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://inkbox.ai/api/v1/agent-signup");
    expect(init!.method).toBe("POST");

    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Service-Token"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({
      human_email: "human@example.com",
      display_name: "My Agent",
      note_to_human: "Please approve me",
    });

    // Parsed camelCase response
    expect(result).toEqual({
      emailAddress: "agent@inkboxmail.com",
      organizationId: "org-123",
      apiKey: "ApiKey_abc",
      agentHandle: "my-agent",
      claimStatus: "unclaimed",
      humanEmail: "human@example.com",
      message: "Verification email sent",
    });
  });

  it("uses custom baseUrl", async () => {
    mockFetch(200, RAW_SIGNUP_RESPONSE);

    await Inkbox.signup(
      { humanEmail: "h@e.com", displayName: "A", noteToHuman: "hi" },
      { baseUrl: "https://custom.example.com" },
    );

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toBe("https://custom.example.com/api/v1/agent-signup");
  });

  it("rejects non-HTTPS baseUrl", async () => {
    await expect(
      Inkbox.signup(
        { humanEmail: "h@e.com", displayName: "A", noteToHuman: "hi" },
        { baseUrl: "http://evil.com" },
      ),
    ).rejects.toThrow("Only HTTPS base URLs are permitted");
  });

  it("allows HTTP for localhost", async () => {
    mockFetch(200, RAW_SIGNUP_RESPONSE);

    await expect(
      Inkbox.signup(
        { humanEmail: "h@e.com", displayName: "A", noteToHuman: "hi" },
        { baseUrl: "http://localhost:8000" },
      ),
    ).resolves.toBeDefined();
  });
});

describe("Inkbox.verifySignup", () => {
  it("sends POST to /verify with auth header and verification code", async () => {
    mockFetch(200, RAW_VERIFY_RESPONSE);

    const result = await Inkbox.verifySignup("ApiKey_abc", {
      verificationCode: "123456",
    });

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://inkbox.ai/api/v1/agent-signup/verify");
    expect(init!.method).toBe("POST");

    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Service-Token"]).toBe("ApiKey_abc");

    const body = JSON.parse(init!.body as string);
    expect(body).toEqual({ verification_code: "123456" });

    expect(result).toEqual({
      claimStatus: "claimed",
      organizationId: "org-123",
      message: "Verified",
    });
  });
});

describe("Inkbox.resendSignupVerification", () => {
  it("sends POST to /resend-verification with auth header and no body", async () => {
    mockFetch(200, RAW_RESEND_RESPONSE);

    const result = await Inkbox.resendSignupVerification("ApiKey_abc");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://inkbox.ai/api/v1/agent-signup/resend-verification");
    expect(init!.method).toBe("POST");

    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Service-Token"]).toBe("ApiKey_abc");
    expect(init!.body).toBeUndefined();

    expect(result).toEqual({
      claimStatus: "pending_verification",
      organizationId: "org_abc123",
      message: "Verification email resent",
    });
  });
});

describe("Inkbox.getSignupStatus", () => {
  it("sends GET to /status with auth header and returns parsed restrictions", async () => {
    mockFetch(200, RAW_STATUS_RESPONSE);

    const result = await Inkbox.getSignupStatus("ApiKey_abc");

    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://inkbox.ai/api/v1/agent-signup/status");
    expect(init!.method).toBe("GET");

    const headers = init!.headers as Record<string, string>;
    expect(headers["X-Service-Token"]).toBe("ApiKey_abc");

    expect(result).toEqual({
      claimStatus: "unclaimed",
      humanState: "pending",
      humanEmail: "human@example.com",
      restrictions: {
        maxSendsPerDay: 10,
        allowedRecipients: ["human@example.com"],
        canReceive: true,
        canCreateMailboxes: false,
      },
    });
  });
});

describe("Agent signup error handling", () => {
  it("throws InkboxAPIError on non-ok response", async () => {
    mockFetch(422, { detail: "Invalid verification code" }, false);

    await expect(
      Inkbox.verifySignup("ApiKey_abc", { verificationCode: "000000" }),
    ).rejects.toThrow(InkboxAPIError);

    await expect(
      Inkbox.verifySignup("ApiKey_abc", { verificationCode: "000000" }),
    ).rejects.toThrow("422");
  });

  it("falls back to statusText when JSON has no detail", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
    } as Response);

    await expect(
      Inkbox.signup({ humanEmail: "h@e.com", displayName: "A", noteToHuman: "hi" }),
    ).rejects.toThrow("Internal Server Error");
  });
});

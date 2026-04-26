// sdk/typescript/tests/errors.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  DuplicateContactRuleError,
  HttpTransport,
  InkboxAPIError,
  InkboxError,
  InkboxVaultKeyError,
  RecipientBlockedError,
  RedundantContactAccessGrantError,
} from "../src/_http.js";

const BASE = "https://inkbox.ai/api/v1";
const API_KEY = "test-key";

function makeHeaders() {
  return {
    get() { return null; },
    getSetCookie() { return []; },
  } as unknown as Headers;
}

function makeErrorResponse(status: number, body: unknown) {
  return {
    ok: false,
    status,
    statusText: "Error",
    headers: makeHeaders(),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("InkboxError", () => {
  it("sets message and name", () => {
    const err = new InkboxError("something went wrong");
    expect(err.message).toBe("something went wrong");
    expect(err.name).toBe("InkboxError");
  });

  it("is an instance of Error", () => {
    expect(new InkboxError("x")).toBeInstanceOf(Error);
  });
});

describe("InkboxAPIError", () => {
  it("formats string detail into message", () => {
    const err = new InkboxAPIError(404, "not found");
    expect(err.message).toBe("HTTP 404: not found");
  });

  it("exposes statusCode and string detail", () => {
    const err = new InkboxAPIError(422, "validation error");
    expect(err.statusCode).toBe(422);
    expect(err.detail).toBe("validation error");
  });

  it("accepts and round-trips object detail", () => {
    const err = new InkboxAPIError(409, { error: "redundant_grant", detail: "why" });
    expect(err.statusCode).toBe(409);
    expect(typeof err.detail).toBe("object");
    expect(err.message).toContain("redundant_grant");
  });

  it("is an instance of InkboxError", () => {
    const err = new InkboxAPIError(403, "forbidden");
    expect(err).toBeInstanceOf(InkboxError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("InkboxVaultKeyError", () => {
  it("is an instance of InkboxError", () => {
    const err = new InkboxVaultKeyError("bad key");
    expect(err).toBeInstanceOf(InkboxError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("InkboxVaultKeyError");
  });
});

describe("HttpTransport 409 routing", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("routes duplicate-rule 409 to DuplicateContactRuleError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(409, {
        detail: {
          existing_rule_id: "aaaa1111-0000-0000-0000-000000000009",
          message: "exists",
        },
      }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    await expect(http.get("/mailboxes/x/contact-rules")).rejects.toMatchObject({
      name: "DuplicateContactRuleError",
      existingRuleId: "aaaa1111-0000-0000-0000-000000000009",
      statusCode: 409,
    });
  });

  it("routes redundant_grant 409 to RedundantContactAccessGrantError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(409, {
        detail: {
          error: "redundant_grant",
          detail: "wildcard already implies this identity",
        },
      }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    await expect(http.post("/contacts/x/access")).rejects.toMatchObject({
      name: "RedundantContactAccessGrantError",
      error: "redundant_grant",
      detailMessage: "wildcard already implies this identity",
      statusCode: 409,
    });
  });

  it("plain-string 409 stays on InkboxAPIError with string detail", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(409, { detail: "Access already granted" }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    try {
      await http.post("/contacts/x/access");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InkboxAPIError);
      expect(err).not.toBeInstanceOf(DuplicateContactRuleError);
      expect(err).not.toBeInstanceOf(RedundantContactAccessGrantError);
      expect((err as InkboxAPIError).detail).toBe("Access already granted");
    }
  });

  it("routes recipient_blocked 403 to RecipientBlockedError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(403, {
        detail: {
          error: "recipient_blocked",
          matched_rule_id: "aaaa1111-0000-0000-0000-000000000077",
          address: "+15551234567",
          reason: "outbound block rule matched",
        },
      }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    await expect(http.post("/numbers/x/texts")).rejects.toMatchObject({
      name: "RecipientBlockedError",
      matchedRuleId: "aaaa1111-0000-0000-0000-000000000077",
      address: "+15551234567",
      reason: "outbound block rule matched",
      statusCode: 403,
    });
  });

  it("recipient_blocked without matched_rule_id has null matchedRuleId", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(403, {
        detail: {
          error: "recipient_blocked",
          matched_rule_id: null,
          address: "+15551234567",
          reason: "filter_mode default",
        },
      }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    try {
      await http.post("/numbers/x/texts");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(RecipientBlockedError);
      expect((err as RecipientBlockedError).matchedRuleId).toBeNull();
    }
  });

  it("unrelated 403 (recipient_not_opted_in) stays on InkboxAPIError", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(403, {
        detail: { error: "recipient_not_opted_in", message: "not opted in" },
      }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    try {
      await http.post("/numbers/x/texts");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InkboxAPIError);
      expect(err).not.toBeInstanceOf(RecipientBlockedError);
    }
  });

  it("preserves dict detail shape on generic 409", async () => {
    vi.mocked(fetch).mockResolvedValue(
      makeErrorResponse(409, { detail: { misc: "field" } }),
    );
    const http = new HttpTransport(API_KEY, BASE);
    try {
      await http.post("/x");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(InkboxAPIError);
      const detail = (err as InkboxAPIError).detail;
      expect(typeof detail).toBe("object");
      expect((detail as Record<string, unknown>).misc).toBe("field");
    }
  });
});

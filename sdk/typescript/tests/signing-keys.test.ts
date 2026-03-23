// sdk/typescript/tests/signing-keys.test.ts
import { createHmac } from "crypto";
import { describe, it, expect, vi } from "vitest";
import { SigningKeysResource, verifyWebhook } from "../src/signing_keys.js";
import { HttpTransport } from "../src/_http.js";
import { RAW_SIGNING_KEY } from "./sampleData.js";

const TEST_KEY = "test-signing-key";
const TEST_REQUEST_ID = "req-abc-123";
const TEST_TIMESTAMP = "1741737600";
const TEST_BODY = Buffer.from('{"event":"message.received"}');

function makeSignature(key: string, requestId: string, timestamp: string, body: Buffer): string {
  const message = Buffer.concat([Buffer.from(`${requestId}.${timestamp}.`), body]);
  const digest = createHmac("sha256", key).update(message).digest("hex");
  return `sha256=${digest}`;
}

function makeResource() {
  const http = { post: vi.fn() } as unknown as HttpTransport;
  const resource = new SigningKeysResource(http);
  return { resource, http: http as { post: ReturnType<typeof vi.fn> } };
}

function makeHeaders(sig: string): Record<string, string> {
  return {
    "x-inkbox-signature": sig,
    "x-inkbox-request-id": TEST_REQUEST_ID,
    "x-inkbox-timestamp": TEST_TIMESTAMP,
  };
}

describe("verifyWebhook", () => {
  it("returns true for a valid signature", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY, headers: makeHeaders(sig), secret: TEST_KEY })).toBe(true);
  });

  it("accepts whsec_ prefixed secret", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY, headers: makeHeaders(sig), secret: `whsec_${TEST_KEY}` })).toBe(true);
  });

  it("accepts string payload", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY.toString(), headers: makeHeaders(sig), secret: TEST_KEY })).toBe(true);
  });

  it("normalizes header casing", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    const uppercaseHeaders = {
      "X-Inkbox-Signature": sig,
      "X-Inkbox-Request-ID": TEST_REQUEST_ID,
      "X-Inkbox-Timestamp": TEST_TIMESTAMP,
    };
    expect(verifyWebhook({ payload: TEST_BODY, headers: uppercaseHeaders, secret: TEST_KEY })).toBe(true);
  });

  it("returns false for wrong key", () => {
    const sig = makeSignature("wrong-key", TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY, headers: makeHeaders(sig), secret: TEST_KEY })).toBe(false);
  });

  it("returns false for tampered body", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: Buffer.from('{"event":"message.sent"}'), headers: makeHeaders(sig), secret: TEST_KEY })).toBe(false);
  });

  it("returns false for wrong requestId", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY, headers: { ...makeHeaders(sig), "x-inkbox-request-id": "different-id" }, secret: TEST_KEY })).toBe(false);
  });

  it("returns false for wrong timestamp", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY);
    expect(verifyWebhook({ payload: TEST_BODY, headers: { ...makeHeaders(sig), "x-inkbox-timestamp": "9999999999" }, secret: TEST_KEY })).toBe(false);
  });

  it("returns false when sha256= prefix is missing", () => {
    const sig = makeSignature(TEST_KEY, TEST_REQUEST_ID, TEST_TIMESTAMP, TEST_BODY).slice("sha256=".length);
    expect(verifyWebhook({ payload: TEST_BODY, headers: makeHeaders(sig), secret: TEST_KEY })).toBe(false);
  });

  it("returns false when headers are missing", () => {
    expect(verifyWebhook({ payload: TEST_BODY, headers: {}, secret: TEST_KEY })).toBe(false);
  });
});

describe("SigningKeysResource", () => {
  describe("createOrRotate", () => {
    it("calls POST /signing-keys with empty body", async () => {
      const { resource, http } = makeResource();
      http.post.mockResolvedValue(RAW_SIGNING_KEY);

      await resource.createOrRotate();

      expect(http.post).toHaveBeenCalledOnce();
      expect(http.post).toHaveBeenCalledWith("/signing-keys", {});
    });

    it("parses signingKey and createdAt from response", async () => {
      const { resource, http } = makeResource();
      http.post.mockResolvedValue(RAW_SIGNING_KEY);

      const key = await resource.createOrRotate();

      expect(key.signingKey).toBe("sk-test-hmac-secret-abc123");
      expect(key.createdAt).toBeInstanceOf(Date);
      expect(key.createdAt.toISOString()).toBe("2026-03-09T00:00:00.000Z");
    });
  });
});

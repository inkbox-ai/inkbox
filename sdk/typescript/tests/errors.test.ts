// sdk/typescript/tests/errors.test.ts
import { describe, it, expect } from "vitest";
import { InkboxError, InkboxAPIError, InkboxVaultKeyError } from "../src/_http.js";

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
  it("formats the message correctly", () => {
    const err = new InkboxAPIError(404, "not found");
    expect(err.message).toBe("HTTP 404: not found");
  });

  it("exposes statusCode and detail", () => {
    const err = new InkboxAPIError(422, "validation error");
    expect(err.statusCode).toBe(422);
    expect(err.detail).toBe("validation error");
  });

  it("sets name to InkboxAPIError", () => {
    const err = new InkboxAPIError(500, "server error");
    expect(err.name).toBe("InkboxAPIError");
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

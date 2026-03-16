import { describe, it, expect } from "vitest";
import { InkboxAPIError } from "../src/_http.js";

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

  it("is an instance of Error", () => {
    const err = new InkboxAPIError(403, "forbidden");
    expect(err).toBeInstanceOf(Error);
  });
});

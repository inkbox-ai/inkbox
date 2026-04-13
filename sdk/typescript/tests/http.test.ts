// sdk/typescript/tests/http.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HttpTransport, InkboxAPIError } from "../src/_http.js";

const BASE = "https://inkbox.ai/api/v1";
const API_KEY = "test-key";

function makeTransport(timeout = 30_000) {
  return new HttpTransport(API_KEY, BASE, timeout);
}

function makeHeaders(setCookies?: string[]) {
  return {
    get(name: string) {
      if (name.toLowerCase() !== "set-cookie" || !setCookies || setCookies.length === 0) {
        return null;
      }
      return setCookies[0];
    },
    getSetCookie() {
      return setCookies ?? [];
    },
  } as unknown as Headers;
}

function makeResponse(status: number, body: unknown, options?: { ok?: boolean; setCookies?: string[] }) {
  return {
    ok: options?.ok ?? status < 400,
    status,
    statusText: "Error",
    headers: makeHeaders(options?.setCookies),
    json: () => Promise.resolve(body),
  } as Response;
}

describe("HttpTransport", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: unknown, ok = status < 400) {
    vi.mocked(fetch).mockResolvedValue(makeResponse(status, body, { ok }));
  }

  // --- GET ---

  it("get() sends correct method, headers, and URL", async () => {
    mockFetch(200, { id: 1 });
    const http = makeTransport();

    const result = await http.get<{ id: number }>("/items");

    expect(fetch).toHaveBeenCalledWith(
      `${BASE}/items`,
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-API-Key": API_KEY,
          Accept: "application/json",
        }),
      }),
    );
    expect(result).toEqual({ id: 1 });
  });

  it("get() appends query params", async () => {
    mockFetch(200, []);
    const http = makeTransport();

    await http.get("/items", { limit: 10, offset: 0, empty: undefined, nil: null });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toContain("limit=10");
    expect(url).toContain("offset=0");
    expect(url).not.toContain("empty");
    expect(url).not.toContain("nil");
  });

  it("get() skips query string when no valid params", async () => {
    mockFetch(200, []);
    const http = makeTransport();

    await http.get("/items", { empty: undefined });

    const url = vi.mocked(fetch).mock.calls[0][0] as string;
    expect(url).toBe(`${BASE}/items`);
  });

  // --- POST ---

  it("post() sends JSON body with Content-Type", async () => {
    mockFetch(200, { ok: true });
    const http = makeTransport();

    await http.post("/items", { name: "test" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.method).toBe("POST");
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init!.body).toBe(JSON.stringify({ name: "test" }));
  });

  it("post() without body omits Content-Type", async () => {
    mockFetch(200, { ok: true });
    const http = makeTransport();

    await http.post("/items");

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect((init!.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
    expect(init!.body).toBeUndefined();
  });

  it("stores cookies from a response and sends them on the next request", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(200, { ok: true }, { setCookies: ["AWSALB=test-cookie; Path=/api/v1; HttpOnly"] }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const http = makeTransport();

    await http.get("/first");
    await http.get("/second");

    const [, secondInit] = vi.mocked(fetch).mock.calls[1];
    expect((secondInit!.headers as Record<string, string>).Cookie).toBe("AWSALB=test-cookie");
  });

  it("does not send a path-scoped cookie to a different path", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(200, { ok: true }, { setCookies: ["AWSALB=mail-cookie; Path=/api/v1/mail; HttpOnly"] }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const http = makeTransport();

    await http.get("/mail/items");
    await http.get("/phone/items");

    const [, secondInit] = vi.mocked(fetch).mock.calls[1];
    expect((secondInit!.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  it("removes a cookie when the server expires it", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(makeResponse(200, { ok: true }, { setCookies: ["AWSALB=test-cookie; Path=/api/v1; HttpOnly"] }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }, { setCookies: ["AWSALB=deleted; Path=/api/v1; Max-Age=0"] }))
      .mockResolvedValueOnce(makeResponse(200, { ok: true }));

    const http = makeTransport();

    await http.get("/first");
    await http.get("/second");
    await http.get("/third");

    const [, thirdInit] = vi.mocked(fetch).mock.calls[2];
    expect((thirdInit!.headers as Record<string, string>).Cookie).toBeUndefined();
  });

  // --- PATCH ---

  it("patch() sends PATCH method with body", async () => {
    mockFetch(200, { updated: true });
    const http = makeTransport();

    const result = await http.patch<{ updated: boolean }>("/items/1", { name: "new" });

    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.method).toBe("PATCH");
    expect(result).toEqual({ updated: true });
  });

  // --- DELETE ---

  it("delete() returns void on 204", async () => {
    mockFetch(204, null);
    const http = makeTransport();

    const result = await http.delete("/items/1");

    expect(result).toBeUndefined();
    const [, init] = vi.mocked(fetch).mock.calls[0];
    expect(init!.method).toBe("DELETE");
  });

  // --- Error handling ---

  it("throws InkboxAPIError with detail from JSON on non-ok response", async () => {
    mockFetch(422, { detail: "Validation error" }, false);
    const http = makeTransport();

    await expect(http.get("/bad")).rejects.toThrow(InkboxAPIError);
    await expect(http.get("/bad")).rejects.toThrow("HTTP 422: Validation error");
  });

  it("falls back to statusText when JSON has no detail", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      json: () => Promise.resolve({}),
    } as Response);
    const http = makeTransport();

    await expect(http.get("/fail")).rejects.toThrow("HTTP 500: Internal Server Error");
  });

  it("falls back to statusText when JSON parsing fails", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: () => Promise.reject(new Error("not json")),
    } as Response);
    const http = makeTransport();

    await expect(http.get("/fail")).rejects.toThrow("HTTP 502: Bad Gateway");
  });

  // --- Timeout ---

  it("aborts request on timeout", async () => {
    vi.mocked(fetch).mockImplementation((_url, init) => {
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      });
    });

    const http = makeTransport(1);

    await expect(http.get("/slow")).rejects.toThrow("Aborted");
  });
});

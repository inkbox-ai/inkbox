// sdk/typescript/tests/http.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HttpTransport,
  InkboxAPIError,
  InkboxConnectionError,
  nodeSupportsEnvProxy,
} from "../src/_http.js";

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
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
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

  // --- Network errors ---

  const PROXY_VARS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];

  function stubProxyEnv(values: Record<string, string>) {
    for (const name of PROXY_VARS) vi.stubEnv(name, values[name] ?? "");
    vi.stubEnv("NODE_USE_ENV_PROXY", values.NODE_USE_ENV_PROXY ?? "");
    vi.stubEnv("INKBOX_ENV_PROXY_ACTIVE", values.INKBOX_ENV_PROXY_ACTIVE ?? "");
  }

  it("wraps a network-level fetch failure with the underlying cause", async () => {
    stubProxyEnv({});
    vi.mocked(fetch).mockRejectedValue(
      new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 203.0.113.1:443") }),
    );
    const http = makeTransport();

    const err = await http.get("/items").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InkboxConnectionError);
    const connErr = err as InkboxConnectionError;
    expect(connErr.message).toContain(`${BASE}/items`);
    expect(connErr.message).toContain("connect ECONNREFUSED 203.0.113.1:443");
    expect(connErr.message).not.toContain("NODE_USE_ENV_PROXY");
    expect(connErr.cause).toBeInstanceOf(TypeError);
  });

  it("falls back to the fetch error message when there is no cause", async () => {
    stubProxyEnv({});
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const http = makeTransport();

    await expect(http.get("/items")).rejects.toThrow("fetch failed");
  });

  it("hints about NODE_USE_ENV_PROXY when proxy env vars are set but unused", async () => {
    stubProxyEnv({ HTTPS_PROXY: "http://proxy.example:3128" });
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const http = makeTransport();

    const err = await http.get("/items").catch((e: unknown) => e);

    expect((err as Error).message).toContain("NODE_USE_ENV_PROXY=1");
    // The flag only exists on Node 22.21+/24+; the hint must not send older
    // runtimes down a dead end.
    expect((err as Error).message).toContain("Node 22.21+ / 24+");
    expect((err as Error).message).toContain("dispatcher");
  });

  it("omits the proxy hint when NODE_USE_ENV_PROXY is set and this Node honors it", async () => {
    // The test process runs on a Node with native env-proxy support, so a
    // set flag means proxying is genuinely active.
    expect(nodeSupportsEnvProxy(process.versions.node)).toBe(true);
    stubProxyEnv({ HTTPS_PROXY: "http://proxy.example:3128", NODE_USE_ENV_PROXY: "1" });
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const http = makeTransport();

    const err = await http.get("/items").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InkboxConnectionError);
    expect((err as Error).message).not.toContain("NODE_USE_ENV_PROXY");
  });

  it("warns when NODE_USE_ENV_PROXY is set but this Node ignores it", async () => {
    // A pre-baked flag on an old Node does nothing — the hint must not be
    // suppressed by its mere presence.
    stubProxyEnv({ HTTPS_PROXY: "http://proxy.example:3128", NODE_USE_ENV_PROXY: "1" });
    const realProcess = process;
    vi.stubGlobal("process", {
      ...realProcess,
      env: realProcess.env,
      versions: { ...realProcess.versions, node: "22.20.0" },
    });
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const http = makeTransport();

    const err = await http.get("/items").catch((e: unknown) => e);

    expect((err as Error).message).toContain("this Node version ignores it");
    expect((err as Error).message).toContain("22.20.0");
    expect((err as Error).message).toContain("dispatcher");
  });

  it("omits the proxy hint when the CLI's dispatcher marker is set", async () => {
    stubProxyEnv({ HTTPS_PROXY: "http://proxy.example:3128", INKBOX_ENV_PROXY_ACTIVE: "1" });
    vi.mocked(fetch).mockRejectedValue(new TypeError("fetch failed"));
    const http = makeTransport();

    const err = await http.get("/items").catch((e: unknown) => e);

    expect(err).toBeInstanceOf(InkboxConnectionError);
    expect((err as Error).message).not.toContain("NODE_USE_ENV_PROXY");
  });

  it("maps Node versions to native env-proxy support", () => {
    expect(nodeSupportsEnvProxy("22.20.0")).toBe(false);
    expect(nodeSupportsEnvProxy("22.21.0")).toBe(true);
    expect(nodeSupportsEnvProxy("23.11.0")).toBe(false);
    expect(nodeSupportsEnvProxy("24.0.0")).toBe(true);
    expect(nodeSupportsEnvProxy("25.1.0")).toBe(true);
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

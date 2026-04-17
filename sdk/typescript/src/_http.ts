/**
 * inkbox-mail/_http.ts
 *
 * Async HTTP transport (internal). Zero runtime dependencies — uses native fetch.
 */

export class InkboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InkboxError";
  }
}

export class InkboxVaultKeyError extends InkboxError {
  constructor(message: string) {
    super(message);
    this.name = "InkboxVaultKeyError";
  }
}

export class InkboxAPIError extends InkboxError {
  readonly statusCode: number;
  readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(`HTTP ${statusCode}: ${detail}`);
    this.name = "InkboxAPIError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

function formatErrorDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail;
  if (detail === undefined || detail === null) return fallback;
  try {
    return JSON.stringify(detail);
  } catch {
    return String(detail);
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

type StoredCookie = {
  name: string;
  value: string;
  domain: string;
  hostOnly: boolean;
  path: string;
  secure: boolean;
  expiresAt: number | null;
};

export class CookieJar {
  private readonly cookies = new Map<string, StoredCookie>();

  getHeaderValue(url: string): string | undefined {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname || "/";
    const now = Date.now();
    const matches: string[] = [];

    for (const [key, cookie] of this.cookies.entries()) {
      if (cookie.expiresAt !== null && cookie.expiresAt <= now) {
        this.cookies.delete(key);
        continue;
      }
      if (cookie.secure && parsed.protocol !== "https:") {
        continue;
      }
      if (cookie.hostOnly) {
        if (host !== cookie.domain) continue;
      } else if (!hostMatches(host, cookie.domain)) {
        continue;
      }
      if (!pathMatches(path, cookie.path)) {
        continue;
      }
      matches.push(`${cookie.name}=${cookie.value}`);
    }

    return matches.length > 0 ? matches.join("; ") : undefined;
  }

  storeFromResponse(url: string, resp: Response): void {
    for (const header of getSetCookieHeaders(resp)) {
      const cookie = parseSetCookie(url, header);
      if (!cookie) continue;
      const key = cookieKey(cookie);
      if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
        this.cookies.delete(key);
        continue;
      }
      this.cookies.set(key, cookie);
    }
  }
}

function cookieKey(cookie: StoredCookie): string {
  return `${cookie.domain}|${cookie.path}|${cookie.name}`;
}

function getSetCookieHeaders(resp: Response): string[] {
  if (!resp.headers) return [];

  const headers = resp.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie();
  }

  const single = resp.headers.get("set-cookie");
  return single ? [single] : [];
}

function parseSetCookie(url: string, header: string): StoredCookie | null {
  const parts = header.split(";").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const eq = parts[0].indexOf("=");
  if (eq <= 0) return null;

  const requestUrl = new URL(url);
  const cookie: StoredCookie = {
    name: parts[0].slice(0, eq).trim(),
    value: parts[0].slice(eq + 1).trim(),
    domain: requestUrl.hostname.toLowerCase(),
    hostOnly: true,
    path: defaultPath(requestUrl.pathname),
    secure: false,
    expiresAt: null,
  };

  for (const attr of parts.slice(1)) {
    const attrEq = attr.indexOf("=");
    const key = (attrEq === -1 ? attr : attr.slice(0, attrEq)).trim().toLowerCase();
    const value = attrEq === -1 ? "" : attr.slice(attrEq + 1).trim();

    if (key === "domain" && value) {
      cookie.domain = value.replace(/^\./, "").toLowerCase();
      cookie.hostOnly = false;
    } else if (key === "path" && value.startsWith("/")) {
      cookie.path = value;
    } else if (key === "secure") {
      cookie.secure = true;
    } else if (key === "max-age") {
      const seconds = Number.parseInt(value, 10);
      if (!Number.isNaN(seconds)) cookie.expiresAt = Date.now() + (seconds * 1000);
    } else if (key === "expires") {
      const timestamp = Date.parse(value);
      if (!Number.isNaN(timestamp)) cookie.expiresAt = timestamp;
    }
  }

  return cookie;
}

function defaultPath(pathname: string): string {
  if (!pathname || pathname === "/" || !pathname.startsWith("/")) return "/";
  const idx = pathname.lastIndexOf("/");
  return idx <= 0 ? "/" : pathname.slice(0, idx);
}

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath.charAt(cookiePath.length) === "/";
}

export class HttpTransport {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly cookieJar: CookieJar;

  constructor(
    apiKey: string,
    baseUrl: string,
    timeoutMs: number = 30_000,
    cookieJar?: CookieJar,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.cookieJar = cookieJar ?? new CookieJar();
  }

  async get<T>(path: string, params?: Params): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PUT", path, { body });
  }

  async patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>("PATCH", path, { body });
  }

  async delete(path: string): Promise<void> {
    await this.request<void>("DELETE", path);
  }

  private async request<T>(
    method: string,
    path: string,
    opts: { params?: Params; body?: unknown } = {},
  ): Promise<T> {
    let url = `${this.baseUrl}${path}`;

    if (opts.params) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.params)) {
        if (v !== undefined && v !== null) {
          qs.set(k, String(v));
        }
      }
      const s = qs.toString();
      if (s) url += `?${s}`;
    }

    const headers: Record<string, string> = {
      "X-API-Key": this.apiKey,
      Accept: "application/json",
    };
    const cookieHeader = this.cookieJar.getHeaderValue(url);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let bodyStr: string | undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyStr = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.cookieJar.storeFromResponse(url, resp);

    if (!resp.ok) {
      let detail: string;
      try {
        const err = (await resp.json()) as { detail?: unknown };
        detail = formatErrorDetail(err.detail, resp.statusText);
      } catch {
        detail = resp.statusText;
      }
      throw new InkboxAPIError(resp.status, detail);
    }

    if (resp.status === 204) {
      return undefined as T;
    }

    return resp.json() as Promise<T>;
  }
}

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

export type InkboxAPIErrorDetail = string | Record<string, unknown>;

export class InkboxAPIError extends InkboxError {
  readonly statusCode: number;
  readonly detail: InkboxAPIErrorDetail;

  constructor(statusCode: number, detail: InkboxAPIErrorDetail) {
    super(`HTTP ${statusCode}: ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
    this.name = "InkboxAPIError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

export class DuplicateContactRuleError extends InkboxAPIError {
  readonly existingRuleId: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "DuplicateContactRuleError";
    this.existingRuleId = String(detail["existing_rule_id"]);
  }
}

export class RedundantContactAccessGrantError extends InkboxAPIError {
  readonly error: string;
  readonly detailMessage: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "RedundantContactAccessGrantError";
    this.error = String(detail["error"] ?? "redundant_grant");
    this.detailMessage = String(detail["detail"] ?? "");
  }
}

export class RecipientBlockedError extends InkboxAPIError {
  /** UUID of the matched rule, or `null` if blocked by `filter_mode` default. */
  readonly matchedRuleId: string | null;
  readonly address: string;
  readonly reason: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "RecipientBlockedError";
    const raw = detail["matched_rule_id"];
    this.matchedRuleId = raw === null || raw === undefined ? null : String(raw);
    this.address = String(detail["address"] ?? "");
    this.reason = String(detail["reason"] ?? "");
  }
}

function raiseForErrorResponse(status: number, rawDetail: InkboxAPIErrorDetail): never {
  if (status === 409 && typeof rawDetail === "object" && rawDetail !== null) {
    if ("existing_rule_id" in rawDetail) {
      throw new DuplicateContactRuleError(status, rawDetail);
    }
    if (rawDetail["error"] === "redundant_grant") {
      throw new RedundantContactAccessGrantError(status, rawDetail);
    }
  }
  if (
    status === 403
    && typeof rawDetail === "object"
    && rawDetail !== null
    && rawDetail["error"] === "recipient_blocked"
  ) {
    throw new RecipientBlockedError(status, rawDetail);
  }
  throw new InkboxAPIError(status, rawDetail);
}

async function readErrorDetail(resp: Response): Promise<InkboxAPIErrorDetail> {
  try {
    const parsed = (await resp.json()) as { detail?: unknown };
    const d = parsed?.detail;
    if (d === undefined || d === null) return resp.statusText;
    if (typeof d === "string") return d;
    if (typeof d === "object") return d as Record<string, unknown>;
    return String(d);
  } catch {
    return resp.statusText;
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

  /**
   * POST a raw body with a caller-supplied Content-Type. JSON response.
   *
   * Used for non-JSON payloads like vCard imports.
   */
  async postRaw<T>(
    path: string,
    body: string | Uint8Array,
    contentType: string,
  ): Promise<T> {
    return this.request<T>("POST", path, { rawBody: body, contentType });
  }

  /**
   * GET a non-JSON response as text.
   *
   * Used for vCard export and similar text endpoints.
   */
  async getText(path: string, accept: string, params?: Params): Promise<string> {
    return this.request<string>("GET", path, { params, accept, rawResponse: "text" });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: {
      params?: Params;
      body?: unknown;
      rawBody?: string | Uint8Array;
      contentType?: string;
      accept?: string;
      rawResponse?: "text" | "bytes";
    } = {},
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
      Accept: opts.accept ?? "application/json",
    };
    const cookieHeader = this.cookieJar.getHeaderValue(url);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let bodyPayload: string | Uint8Array | undefined;
    if (opts.rawBody !== undefined) {
      headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
      bodyPayload = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: bodyPayload as BodyInit | undefined,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    this.cookieJar.storeFromResponse(url, resp);

    if (!resp.ok) {
      const detail = await readErrorDetail(resp);
      raiseForErrorResponse(resp.status, detail);
    }

    if (resp.status === 204) {
      return undefined as T;
    }

    if (opts.rawResponse === "text") {
      return (await resp.text()) as unknown as T;
    }

    return resp.json() as Promise<T>;
  }
}

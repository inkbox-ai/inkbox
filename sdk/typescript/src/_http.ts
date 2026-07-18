/**
 * inkbox-mail/_http.ts
 *
 * Async HTTP transport (internal). Zero runtime dependencies — uses native fetch.
 */

import type { IMessageDedicatedNumberType } from "./imessage/types.js";

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

/** @internal Validate the API's 1–255 character idempotency-key contract. */
export function validateIdempotencyKey(key: string): void {
  const length = Array.from(key).length;
  if (length < 1 || length > 255) {
    throw new RangeError("idempotencyKey must contain between 1 and 255 characters");
  }
}

/**
 * Thrown when a request fails before any HTTP response is received —
 * DNS failure, refused connection, TLS error, unreachable proxy.
 * `cause` carries the underlying fetch error.
 */
export class InkboxConnectionError extends InkboxError {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "InkboxConnectionError";
    this.cause = cause;
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

/**
 * Thrown on 402 when an outbound send would push a mailbox past its plan's
 * storage cap. Raised by `messages.send`, `messages.replyAll`, and
 * `messages.forward`.
 *
 * Free space by deleting messages (`messages.delete`) or whole threads
 * (`threads.delete`) — reclaim is immediate — or upgrade the plan.
 */
export class StorageLimitExceededError extends InkboxAPIError {
  /** Console billing page to raise the cap. */
  readonly upgradeUrl: string;
  /** The cap that was hit, in bytes. Binary units — divide by 1024, label GiB/MiB. */
  readonly limitBytes: number | null;
  /** Alias of `message`, for symmetry with the sibling structured errors. */
  readonly detailMessage: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "StorageLimitExceededError";
    // The server's sentence is the useful one here; the base class's
    // "HTTP 402: {json}" is not worth printing.
    const serverMessage = String(detail["message"] ?? "");
    if (serverMessage) this.message = serverMessage;
    this.detailMessage = serverMessage;
    this.upgradeUrl = String(detail["upgrade_url"] ?? "");
    const raw = detail["limit_bytes"];
    this.limitBytes = raw === null || raw === undefined ? null : Number(raw);
  }
}

/** Thrown when an organization has reached its dedicated iMessage number quota. */
export class DedicatedIMessageNumberQuotaExceededError extends InkboxAPIError {
  readonly numberType: IMessageDedicatedNumberType;
  readonly limit: number;
  readonly current: number;
  readonly upgradeUrl: string;
  readonly contactEmail: string;
  readonly detailMessage: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "DedicatedIMessageNumberQuotaExceededError";
    this.numberType = String(detail["number_type"] ?? "") as IMessageDedicatedNumberType;
    this.limit = Number(detail["limit"] ?? 0);
    this.current = Number(detail["current"] ?? 0);
    this.upgradeUrl = String(detail["upgrade_url"] ?? "");
    this.contactEmail = String(detail["contact_email"] ?? "");
    this.detailMessage = String(detail["message"] ?? "");
    if (this.detailMessage) this.message = this.detailMessage;
  }
}

/** Thrown when a requested dedicated iMessage number is not yet available. */
export class DedicatedIMessageNumberInventoryPendingError extends InkboxAPIError {
  readonly numberType: IMessageDedicatedNumberType;
  readonly retryAfterSeconds: number;
  readonly detailMessage: string;

  constructor(
    statusCode: number,
    detail: Record<string, unknown>,
    retryAfterHeader: string | null,
  ) {
    super(statusCode, detail);
    this.name = "DedicatedIMessageNumberInventoryPendingError";
    this.numberType = String(detail["number_type"] ?? "") as IMessageDedicatedNumberType;
    const headerSeconds = retryAfterHeader === null ? Number.NaN : Number(retryAfterHeader);
    const detailSeconds = Number(detail["retry_after_seconds"] ?? 0);
    this.retryAfterSeconds = Number.isFinite(headerSeconds) && headerSeconds >= 0
      ? headerSeconds
      : detailSeconds;
    this.detailMessage = String(detail["message"] ?? "");
    if (this.detailMessage) this.message = this.detailMessage;
  }
}

/** Thrown when an idempotency key is reused with a different request. */
export class IdempotencyKeyReusedError extends InkboxAPIError {
  readonly detailMessage: string;

  constructor(statusCode: number, detail: Record<string, unknown>) {
    super(statusCode, detail);
    this.name = "IdempotencyKeyReusedError";
    this.detailMessage = String(detail["message"] ?? "");
    if (this.detailMessage) this.message = this.detailMessage;
  }
}

function raiseForErrorResponse(
  status: number,
  rawDetail: InkboxAPIErrorDetail,
  headers?: Headers,
): never {
  if (status === 409 && typeof rawDetail === "object" && rawDetail !== null) {
    if (rawDetail["error"] === "idempotency_key_reused") {
      throw new IdempotencyKeyReusedError(status, rawDetail);
    }
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
  // Older servers send a plain-string 402 detail; those fall through to the
  // generic error rather than being mistyped.
  if (
    status === 402
    && typeof rawDetail === "object"
    && rawDetail !== null
    && rawDetail["error"] === "storage_limit_exceeded"
  ) {
    throw new StorageLimitExceededError(status, rawDetail);
  }
  if (
    status === 402
    && typeof rawDetail === "object"
    && rawDetail !== null
    && rawDetail["error"] === "dedicated_imessage_number_quota_exceeded"
  ) {
    throw new DedicatedIMessageNumberQuotaExceededError(status, rawDetail);
  }
  if (
    status === 503
    && typeof rawDetail === "object"
    && rawDetail !== null
    && rawDetail["error"] === "dedicated_imessage_number_inventory_pending"
  ) {
    throw new DedicatedIMessageNumberInventoryPendingError(
      status,
      rawDetail,
      headers?.get("Retry-After") ?? null,
    );
  }
  throw new InkboxAPIError(status, rawDetail);
}

/** NODE_USE_ENV_PROXY exists on Node 22.21+ within the 22.x line, and 24+. */
export function nodeSupportsEnvProxy(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major >= 24 || (major === 22 && minor >= 21);
}

// Node's fetch ignores HTTP(S)_PROXY/NO_PROXY unless NODE_USE_ENV_PROXY is
// set, so behind a mandatory proxy every request dies with a bare
// "fetch failed". Point the user at the fix — unless env-proxying is
// plausibly active: a proxy dispatcher was installed for this process
// (INKBOX_ENV_PROXY_ACTIVE, set by the Inkbox CLI), or the flag is set on a
// Node new enough to honor it. A flag pre-baked into the environment of an
// older Node does nothing, so it must not silence the hint.
function proxyHint(): string {
  const env = typeof process === "undefined" ? undefined : process.env;
  if (!env || env.INKBOX_ENV_PROXY_ACTIVE) return "";
  const vars = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"];
  if (!vars.some((name) => env[name])) return "";
  const flag = env.NODE_USE_ENV_PROXY;
  if (flag === "0") return ""; // explicit opt-out — the user knows the mechanism
  const nodeVersion = process.versions?.node ?? "";
  if (flag) {
    if (nodeSupportsEnvProxy(nodeVersion)) return "";
    return (
      " NODE_USE_ENV_PROXY is set, but this Node version ignores it"
      + ` (supported on Node 22.21+ / 24+; running ${nodeVersion}) — upgrade`
      + " Node or configure a proxy-aware fetch dispatcher (e.g. undici's"
      + " EnvHttpProxyAgent)."
    );
  }
  return (
    " Proxy environment variables are set, but Node's fetch ignores them by"
    + " default — run with NODE_USE_ENV_PROXY=1 (Node 22.21+ / 24+) or"
    + " configure a proxy-aware fetch dispatcher (e.g. undici's"
    + " EnvHttpProxyAgent) on older versions."
  );
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
  private readonly userAgent?: string;

  constructor(
    apiKey: string,
    baseUrl: string,
    timeoutMs: number = 30_000,
    cookieJar?: CookieJar,
    userAgent?: string,
  ) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.cookieJar = cookieJar ?? new CookieJar();
    this.userAgent = userAgent;
  }

  async get<T>(path: string, params?: Params, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>("GET", path, { params, timeoutMs: opts?.timeoutMs });
  }

  async post<T>(
    path: string,
    body?: unknown,
    opts?: { timeoutMs?: number; params?: Params; headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>("POST", path, {
      body,
      params: opts?.params,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  /**
   * POST one file as multipart/form-data. JSON response.
   *
   * Used for media uploads.
   */
  async postMultipart<T>(
    path: string,
    file: {
      fieldName: string;
      filename: string;
      content: Uint8Array | Blob;
      contentType: string;
    },
  ): Promise<T> {
    const form = new FormData();
    const blob = file.content instanceof Blob
      ? file.content
      : new Blob([file.content as BlobPart], { type: file.contentType });
    form.append(file.fieldName, blob, file.filename);
    return this.request<T>("POST", path, { formBody: form });
  }

  async put<T>(path: string, body: unknown, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>("PUT", path, { body, timeoutMs: opts?.timeoutMs });
  }

  async patch<T>(
    path: string,
    body: unknown,
    opts?: { timeoutMs?: number; headers?: Record<string, string> },
  ): Promise<T> {
    return this.request<T>("PATCH", path, {
      body,
      timeoutMs: opts?.timeoutMs,
      headers: opts?.headers,
    });
  }

  async delete(path: string, opts?: { timeoutMs?: number }): Promise<void> {
    await this.request<void>("DELETE", path, { timeoutMs: opts?.timeoutMs });
  }

  /**
   * `DELETE` that returns a parsed JSON body.
   *
   * Used by endpoints (e.g. tunnels) that respond with a representation
   * of the deleted resource rather than 204 No Content.
   */
  async deleteWithResponse<T>(path: string, opts?: { timeoutMs?: number }): Promise<T> {
    return this.request<T>("DELETE", path, { timeoutMs: opts?.timeoutMs });
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
      formBody?: FormData;
      contentType?: string;
      accept?: string;
      rawResponse?: "text" | "bytes";
      timeoutMs?: number;
      headers?: Record<string, string>;
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
    if (this.userAgent) {
      headers["User-Agent"] = this.userAgent;
    }
    if (opts.headers) {
      Object.assign(headers, opts.headers);
    }
    const cookieHeader = this.cookieJar.getHeaderValue(url);
    if (cookieHeader) {
      headers.Cookie = cookieHeader;
    }

    let bodyPayload: string | Uint8Array | FormData | undefined;
    if (opts.formBody !== undefined) {
      // No explicit Content-Type — fetch sets the multipart boundary.
      bodyPayload = opts.formBody;
    } else if (opts.rawBody !== undefined) {
      headers["Content-Type"] = opts.contentType ?? "application/octet-stream";
      bodyPayload = opts.rawBody;
    } else if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(opts.body);
    }

    const controller = new AbortController();
    const effectiveTimeoutMs = opts.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method,
        headers,
        body: bodyPayload as BodyInit | undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) throw err;
      // Node wraps the real error (ECONNREFUSED, ENOTFOUND, …) in a bare
      // TypeError("fetch failed") whose cause holds the useful message.
      const cause = err instanceof Error ? err.cause : undefined;
      const reason =
        cause instanceof Error && cause.message
          ? cause.message
          : err instanceof Error
            ? err.message
            : String(err);
      throw new InkboxConnectionError(
        `Request to ${url} failed: ${reason}.${proxyHint()}`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    this.cookieJar.storeFromResponse(url, resp);

    if (!resp.ok) {
      const detail = await readErrorDetail(resp);
      raiseForErrorResponse(resp.status, detail, resp.headers);
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

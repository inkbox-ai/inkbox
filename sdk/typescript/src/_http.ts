/**
 * inkbox-mail/_http.ts
 *
 * Async HTTP transport (internal). Zero runtime dependencies — uses native fetch.
 */

export class InkboxVaultKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InkboxVaultKeyError";
  }
}

export class InkboxAPIError extends Error {
  readonly statusCode: number;
  readonly detail: string;

  constructor(statusCode: number, detail: string) {
    super(`HTTP ${statusCode}: ${detail}`);
    this.name = "InkboxAPIError";
    this.statusCode = statusCode;
    this.detail = detail;
  }
}

type Params = Record<string, string | number | boolean | undefined | null>;

export class HttpTransport {
  constructor(
    private readonly apiKey: string,
    private readonly baseUrl: string,
    private readonly timeoutMs: number = 30_000,
  ) {}

  async get<T>(path: string, params?: Params): Promise<T> {
    return this.request<T>("GET", path, { params });
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, { body });
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
      "X-Service-Token": this.apiKey,
      Accept: "application/json",
    };

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

    if (!resp.ok) {
      let detail: string;
      try {
        const err = (await resp.json()) as { detail?: string };
        detail = err.detail ?? resp.statusText;
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

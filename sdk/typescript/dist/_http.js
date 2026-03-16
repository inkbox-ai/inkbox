/**
 * inkbox-mail/_http.ts
 *
 * Async HTTP transport (internal). Zero runtime dependencies — uses native fetch.
 */
export class InkboxAPIError extends Error {
    statusCode;
    detail;
    constructor(statusCode, detail) {
        super(`HTTP ${statusCode}: ${detail}`);
        this.name = "InkboxAPIError";
        this.statusCode = statusCode;
        this.detail = detail;
    }
}
export class HttpTransport {
    apiKey;
    baseUrl;
    timeoutMs;
    constructor(apiKey, baseUrl, timeoutMs = 30_000) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        this.timeoutMs = timeoutMs;
    }
    async get(path, params) {
        return this.request("GET", path, { params });
    }
    async post(path, body) {
        return this.request("POST", path, { body });
    }
    async patch(path, body) {
        return this.request("PATCH", path, { body });
    }
    async delete(path) {
        await this.request("DELETE", path);
    }
    async request(method, path, opts = {}) {
        let url = `${this.baseUrl}${path}`;
        if (opts.params) {
            const qs = new URLSearchParams();
            for (const [k, v] of Object.entries(opts.params)) {
                if (v !== undefined && v !== null) {
                    qs.set(k, String(v));
                }
            }
            const s = qs.toString();
            if (s)
                url += `?${s}`;
        }
        const headers = {
            "X-Service-Token": this.apiKey,
            Accept: "application/json",
        };
        let bodyStr;
        if (opts.body !== undefined) {
            headers["Content-Type"] = "application/json";
            bodyStr = JSON.stringify(opts.body);
        }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);
        let resp;
        try {
            resp = await fetch(url, {
                method,
                headers,
                body: bodyStr,
                signal: controller.signal,
            });
        }
        finally {
            clearTimeout(timer);
        }
        if (!resp.ok) {
            let detail;
            try {
                const err = (await resp.json());
                detail = err.detail ?? resp.statusText;
            }
            catch {
                detail = resp.statusText;
            }
            throw new InkboxAPIError(resp.status, detail);
        }
        if (resp.status === 204) {
            return undefined;
        }
        return resp.json();
    }
}
//# sourceMappingURL=_http.js.map
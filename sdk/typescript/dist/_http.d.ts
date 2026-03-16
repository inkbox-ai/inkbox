/**
 * inkbox-mail/_http.ts
 *
 * Async HTTP transport (internal). Zero runtime dependencies — uses native fetch.
 */
export declare class InkboxAPIError extends Error {
    readonly statusCode: number;
    readonly detail: string;
    constructor(statusCode: number, detail: string);
}
type Params = Record<string, string | number | boolean | undefined | null>;
export declare class HttpTransport {
    private readonly apiKey;
    private readonly baseUrl;
    private readonly timeoutMs;
    constructor(apiKey: string, baseUrl: string, timeoutMs?: number);
    get<T>(path: string, params?: Params): Promise<T>;
    post<T>(path: string, body?: unknown): Promise<T>;
    patch<T>(path: string, body: unknown): Promise<T>;
    delete(path: string): Promise<void>;
    private request;
}
export {};
//# sourceMappingURL=_http.d.ts.map
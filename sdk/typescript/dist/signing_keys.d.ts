/**
 * Org-level webhook signing key management.
 *
 * Shared across all Inkbox clients (mail, phone, etc.).
 */
import { HttpTransport } from "./_http.js";
export interface SigningKey {
    /** Plaintext signing key — returned once on creation/rotation. Store securely. */
    signingKey: string;
    createdAt: Date;
}
/**
 * Verify that an incoming webhook request was sent by Inkbox.
 *
 * @param payload  - Raw request body as a Buffer or string.
 * @param headers  - Request headers object (keys are lowercased internally).
 * @param secret   - Your signing key, with or without a `whsec_` prefix.
 * @returns True if the signature is valid.
 */
export declare function verifyWebhook({ payload, headers, secret, }: {
    payload: Buffer | string;
    headers: Record<string, string | string[] | undefined>;
    secret: string;
}): boolean;
export declare class SigningKeysResource {
    private readonly http;
    constructor(http: HttpTransport);
    /**
     * Create or rotate the webhook signing key for your organisation.
     *
     * The first call creates a new key; subsequent calls rotate (replace) the
     * existing key. The plaintext `signingKey` is returned **once** —
     * store it securely as it cannot be retrieved again.
     *
     * Use the returned key to verify `X-Inkbox-Signature` headers on
     * incoming webhook requests.
     */
    createOrRotate(): Promise<SigningKey>;
}
//# sourceMappingURL=signing_keys.d.ts.map
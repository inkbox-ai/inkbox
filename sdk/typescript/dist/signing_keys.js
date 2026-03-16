/**
 * Org-level webhook signing key management.
 *
 * Shared across all Inkbox clients (mail, phone, etc.).
 */
import { createHmac, timingSafeEqual } from "crypto";
const PATH = "/signing-keys";
function parseSigningKey(r) {
    return {
        signingKey: r.signing_key,
        createdAt: new Date(r.created_at),
    };
}
/**
 * Verify that an incoming webhook request was sent by Inkbox.
 *
 * @param payload  - Raw request body as a Buffer or string.
 * @param headers  - Request headers object (keys are lowercased internally).
 * @param secret   - Your signing key, with or without a `whsec_` prefix.
 * @returns True if the signature is valid.
 */
export function verifyWebhook({ payload, headers, secret, }) {
    const h = {};
    for (const [k, v] of Object.entries(headers)) {
        h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
    }
    const signature = h["x-inkbox-signature"] ?? "";
    const requestId = h["x-inkbox-request-id"] ?? "";
    const timestamp = h["x-inkbox-timestamp"] ?? "";
    if (!signature.startsWith("sha256="))
        return false;
    const key = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
    const body = typeof payload === "string" ? Buffer.from(payload) : payload;
    const message = Buffer.concat([Buffer.from(`${requestId}.${timestamp}.`), body]);
    const expected = createHmac("sha256", key).update(message).digest("hex");
    const received = signature.slice("sha256=".length);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
export class SigningKeysResource {
    http;
    constructor(http) {
        this.http = http;
    }
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
    async createOrRotate() {
        const data = await this.http.post(PATH, {});
        return parseSigningKey(data);
    }
}
//# sourceMappingURL=signing_keys.js.map
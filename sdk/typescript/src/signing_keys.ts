/**
 * Per-identity webhook signing key management.
 *
 * Each agent identity has its own signing key used to verify the webhooks
 * (and WebSocket upgrades) for that identity's mail / phone / iMessage
 * traffic. Manage it via `inkbox.signingKeys.createOrRotate(handle)` /
 * `getStatus(handle)`, or the `identity.createSigningKey()` /
 * `identity.getSigningKeyStatus()` convenience methods.
 *
 * The legacy no-arg / org-level calls are kept as deprecated bridges.
 */

import { createHmac, timingSafeEqual } from "crypto";
import { HttpTransport } from "./_http.js";

const ORG_PATH = "/signing-keys";

function identityPath(agentHandle: string): string {
  return `/identities/${agentHandle}/signing-key`;
}

export interface SigningKey {
  /** Plaintext signing key — returned once on creation/rotation. Store securely. */
  signingKey: string;
  createdAt: Date;
}

/**
 * Status of an identity's webhook signing key.
 *
 * `configured` is `true` once a key exists; `createdAt` is when it was
 * created or last rotated (`null` when not configured).
 */
export interface SigningKeyStatus {
  configured: boolean;
  createdAt: Date | null;
}

interface RawSigningKey {
  signing_key: string;
  created_at: string;
}

interface RawSigningKeyStatus {
  configured?: boolean;
  created_at?: string | null;
}

function parseSigningKey(r: RawSigningKey): SigningKey {
  return {
    signingKey: r.signing_key,
    createdAt: new Date(r.created_at),
  };
}

function parseSigningKeyStatus(r: RawSigningKeyStatus): SigningKeyStatus {
  return {
    configured: r.configured ?? false,
    createdAt: r.created_at ? new Date(r.created_at) : null,
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
export function verifyWebhook({
  payload,
  headers,
  secret,
}: {
  payload: Buffer | string;
  headers: Record<string, string | string[] | undefined>;
  secret: string;
}): boolean {
  const h: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(headers)) {
    h[k.toLowerCase()] = Array.isArray(v) ? v[0] : v;
  }
  const signature = h["x-inkbox-signature"] ?? "";
  const requestId = h["x-inkbox-request-id"] ?? "";
  const timestamp = h["x-inkbox-timestamp"] ?? "";
  if (!signature.startsWith("sha256=")) return false;
  const key = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  const body = typeof payload === "string" ? Buffer.from(payload) : payload;
  const message = Buffer.concat([Buffer.from(`${requestId}.${timestamp}.`), body]);
  const expected = createHmac("sha256", key).update(message).digest("hex");
  const received = signature.slice("sha256=".length);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

/**
 * Webhook signing key management.
 *
 * Rides the api-root transport (`{base}/api/v1`) so it can address both
 * the per-identity routes (`/identities/{handle}/signing-key`) and the
 * deprecated org-level route (`/signing-keys`).
 */
export class SigningKeysResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Create or rotate a webhook signing key.
   *
   * Pass `agentHandle` to create/rotate **that identity's** key (the
   * forward-looking surface). The first call mints a key; subsequent calls
   * rotate (replace) it. The plaintext `signingKey` is returned **once** —
   * store it securely, it cannot be retrieved again.
   *
   * Use the returned key to verify `X-Inkbox-Signature` headers on
   * incoming webhook requests.
   *
   * @deprecated Calling with no `agentHandle` hits the deprecated org-level
   *   `/signing-keys` route. With an agent-scoped API key the server rotates
   *   that key's identity; with an admin key it returns 409
   *   (`InkboxAPIError`) pointing at the per-identity route. Prefer
   *   `createOrRotate(agentHandle)` or `identity.createSigningKey()`.
   */
  async createOrRotate(agentHandle?: string): Promise<SigningKey> {
    const path = agentHandle === undefined ? ORG_PATH : identityPath(agentHandle);
    const data = await this.http.post<RawSigningKey>(path, {});
    return parseSigningKey(data);
  }

  /**
   * Report whether a signing key is configured.
   *
   * Pass `agentHandle` for that identity's status (the forward-looking
   * surface).
   *
   * @deprecated Calling with no `agentHandle` hits the deprecated org-level
   *   `/signing-keys` route: with an agent-scoped key it reports that
   *   identity's status; with an admin key it reports an org-aggregate
   *   status (`configured` true if any identity in the org has a key).
   *   Prefer `getStatus(agentHandle)` or `identity.getSigningKeyStatus()`.
   */
  async getStatus(agentHandle?: string): Promise<SigningKeyStatus> {
    const path = agentHandle === undefined ? ORG_PATH : identityPath(agentHandle);
    const data = await this.http.get<RawSigningKeyStatus>(path);
    return parseSigningKeyStatus(data);
  }
}

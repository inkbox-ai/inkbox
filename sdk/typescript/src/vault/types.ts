/**
 * inkbox-vault TypeScript SDK — public types.
 *
 * Includes API response types, raw JSON shapes, parsers,
 * and client-side structured secret payloads.
 */

// ---- Enums ----

/**
 * Category of credential stored in a vault secret.
 *
 * Used as a client-side hint for which form to render. The server
 * does not validate or enforce payload structure (it's opaque ciphertext).
 */
export const VaultSecretType = {
  API_KEY: "api_key",
  LOGIN: "login",
  SSH_KEY: "ssh_key",
  OTHER: "other",
} as const;
export type VaultSecretType = (typeof VaultSecretType)[keyof typeof VaultSecretType];

/**
 * Discriminator for vault key records.
 *
 * - `PRIMARY` — a standard vault key issued to users or agents.
 * - `RECOVERY` — a recovery code generated at vault initialization.
 */
export const VaultKeyType = {
  PRIMARY: "primary",
  RECOVERY: "recovery",
} as const;
export type VaultKeyType = (typeof VaultKeyType)[keyof typeof VaultKeyType];

// ---- API response types (camelCase) ----

/** Vault metadata returned by the info endpoint. */
export interface VaultInfo {
  id: string;
  organizationId: string;
  /** @example "active" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** Number of active primary vault keys. */
  keyCount: number;
  /** Number of active vault secrets. */
  secretCount: number;
  /** Number of active recovery keys. */
  recoveryKeyCount: number;
}

/** Vault key metadata (no wrapped key material). */
export interface VaultKey {
  id: string;
  /** `"primary"` or `"recovery"` */
  keyType: string;
  /** Clerk user ID of the creator, or `null`. */
  createdBy: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Vault secret metadata (no encrypted payload). */
export interface VaultSecret {
  id: string;
  /** Display name. */
  name: string;
  /** Optional description. */
  description: string | null;
  /** `"login"` | `"ssh_key"` | `"api_key"` | `"other"` */
  secretType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

/** Vault secret including the encrypted payload. */
export interface VaultSecretDetail extends VaultSecret {
  /** Base64-encoded AES-256-GCM ciphertext. */
  encryptedPayload: string;
}

// ---- Structured secret payloads (client-side) ----

/** Payload for `login` secrets. */
export interface LoginPayload {
  username: string;
  password: string;
  /** URL of the service. */
  url?: string;
  notes?: string;
  // TODO: store TOTP data structure here
}

/** Payload for `other` (freeform catch-all) secrets. */
export interface OtherPayload {
  /** Freeform content. */
  data: string;
  notes?: string;
}

/** Payload for `ssh_key` secrets. */
export interface SSHKeyPayload {
  /** SSH private key (PEM or OpenSSH format). */
  privateKey: string;
  publicKey?: string;
  fingerprint?: string;
  /** Passphrase protecting the private key, if any. */
  passphrase?: string;
  notes?: string;
}

/** Payload for `api_key` secrets. */
export interface APIKeyPayload {
  /** API key or access key identifier. */
  accessKey: string;
  /** API secret or secret key. */
  secretKey?: string;
  /** API endpoint URL. */
  endpoint?: string;
  notes?: string;
}

/** Union of all secret payload types. */
export type SecretPayload =
  | LoginPayload
  | OtherPayload
  | SSHKeyPayload
  | APIKeyPayload;

/** A vault secret with its payload decrypted into a structured type. */
export interface DecryptedVaultSecret {
  id: string;
  /** Display name. */
  name: string;
  description: string | null;
  /** `"login"` | `"ssh_key"` | `"api_key"` | `"other"` */
  secretType: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** The decrypted, structured payload. */
  payload: SecretPayload;
}

// ---- Raw API shapes (snake_case from JSON) ----

/** @internal */
export interface RawVaultInfo {
  id: string;
  organization_id: string;
  status: string;
  created_at: string;
  updated_at: string;
  key_count: number;
  secret_count: number;
  recovery_key_count: number;
}

/** @internal */
export interface RawVaultKey {
  id: string;
  key_type: string;
  created_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** @internal */
export interface RawVaultSecret {
  id: string;
  name: string;
  description: string | null;
  secret_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/** @internal */
export interface RawVaultSecretDetail extends RawVaultSecret {
  encrypted_payload: string;
}

/** @internal */
export interface RawVaultUnlockResponse {
  wrapped_org_encryption_key: string | null;
  wrapped_org_encryption_keys:
    | Array<{ id: string; auth_hash: string; wrapped_org_encryption_key: string }>
    | null;
  encrypted_secrets: RawVaultSecretDetail[];
}

// ---- Parsers ----

/** Parse a raw vault info response into a {@link VaultInfo}. @internal */
export function parseVaultInfo(r: RawVaultInfo): VaultInfo {
  return {
    id: r.id,
    organizationId: r.organization_id,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    keyCount: r.key_count,
    secretCount: r.secret_count,
    recoveryKeyCount: r.recovery_key_count,
  };
}

/** Parse a raw vault key response into a {@link VaultKey}. @internal */
export function parseVaultKey(r: RawVaultKey): VaultKey {
  return {
    id: r.id,
    keyType: r.key_type,
    createdBy: r.created_by,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/** Parse a raw vault secret response into a {@link VaultSecret}. @internal */
export function parseVaultSecret(r: RawVaultSecret): VaultSecret {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    secretType: r.secret_type,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

/** Parse a raw vault secret detail response into a {@link VaultSecretDetail}. @internal */
export function parseVaultSecretDetail(r: RawVaultSecretDetail): VaultSecretDetail {
  return {
    ...parseVaultSecret(r),
    encryptedPayload: r.encrypted_payload,
  };
}

// ---- Payload serialization (camelCase ↔ snake_case for JSON encryption) ----

/**
 * Serialize a payload into a plain object for encryption.
 *
 * Converts camelCase payload fields to the snake_case wire format
 * stored inside the encrypted blob.
 *
 * @param secretType - The secret type string.
 * @param payload - The structured payload to serialize.
 * @returns A plain object ready for JSON stringification.
 * @throws If `secretType` is unknown.
 * @internal
 */
export function serializePayload(
  secretType: string,
  payload: SecretPayload,
): Record<string, unknown> {
  switch (secretType) {
    case "login": {
      const p = payload as LoginPayload;
      const d: Record<string, unknown> = {
        username: p.username,
        password: p.password,
      };
      if (p.url !== undefined) d.url = p.url;
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    case "other": {
      const p = payload as OtherPayload;
      const d: Record<string, unknown> = { data: p.data };
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    case "ssh_key": {
      const p = payload as SSHKeyPayload;
      const d: Record<string, unknown> = { private_key: p.privateKey };
      if (p.publicKey !== undefined) d.public_key = p.publicKey;
      if (p.fingerprint !== undefined) d.fingerprint = p.fingerprint;
      if (p.passphrase !== undefined) d.passphrase = p.passphrase;
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    case "api_key": {
      const p = payload as APIKeyPayload;
      const d: Record<string, unknown> = { access_key: p.accessKey };
      if (p.secretKey !== undefined) d.secret_key = p.secretKey;
      if (p.endpoint !== undefined) d.endpoint = p.endpoint;
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    default:
      throw new Error(`Unknown secret_type: ${secretType}`);
  }
}

/**
 * Parse a decrypted plain object into the correct payload type.
 *
 * Converts snake_case wire-format fields back to camelCase.
 *
 * @param secretType - The secret type string.
 * @param raw - The decrypted plain object.
 * @returns The typed payload.
 * @throws If `secretType` is unknown.
 * @internal
 */
export function parsePayload(
  secretType: string,
  raw: Record<string, unknown>,
): SecretPayload {
  switch (secretType) {
    case "login":
      return {
        username: raw.username as string,
        password: raw.password as string,
        url: raw.url as string | undefined,
        notes: raw.notes as string | undefined,
      } satisfies LoginPayload;
    case "other":
      return { data: raw.data as string, notes: raw.notes as string | undefined } satisfies OtherPayload;
    case "ssh_key":
      return {
        privateKey: raw.private_key as string,
        publicKey: raw.public_key as string | undefined,
        fingerprint: raw.fingerprint as string | undefined,
        passphrase: raw.passphrase as string | undefined,
        notes: raw.notes as string | undefined,
      } satisfies SSHKeyPayload;
    case "api_key":
      return {
        accessKey: raw.access_key as string,
        secretKey: raw.secret_key as string | undefined,
        endpoint: raw.endpoint as string | undefined,
        notes: raw.notes as string | undefined,
      } satisfies APIKeyPayload;
    default:
      throw new Error(`Unknown secret_type: ${secretType}`);
  }
}

/**
 * Infer the `secretType` string from a payload's shape.
 *
 * @param payload - A secret payload object.
 * @returns The inferred secret type string.
 * @throws If the payload shape doesn't match any known type.
 */
export function inferSecretType(payload: SecretPayload): string {
  if ("username" in payload && "password" in payload) return "login";
  if ("privateKey" in payload) return "ssh_key";
  if ("accessKey" in payload) return "api_key";
  if ("data" in payload) return "other";
  throw new Error("Cannot infer secret_type from payload shape");
}

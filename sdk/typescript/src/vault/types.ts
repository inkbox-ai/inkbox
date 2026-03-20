/**
 * inkbox-vault TypeScript SDK — public types.
 *
 * Includes API response types, raw JSON shapes, parsers,
 * and client-side structured secret payloads.
 */

// ---- API response types (camelCase) ----

export interface VaultInfo {
  id: string;
  organizationId: string;
  /** "active" | "paused" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
  keyCount: number;
  secretCount: number;
  recoveryKeyCount: number;
}

export interface VaultKey {
  id: string;
  /** "primary" | "recovery" */
  keyType: string;
  label: string | null;
  createdBy: string | null;
  /** "active" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultSecret {
  id: string;
  label: string;
  /** "login" | "card" | "note" | "ssh_key" | "api_key" */
  secretType: string;
  /** "active" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface VaultSecretDetail extends VaultSecret {
  /** Base64-encoded AES-256-GCM ciphertext. */
  encryptedPayload: string;
}

// ---- Structured secret payloads (client-side) ----

export interface LoginPayload {
  username: string;
  password: string;
  url?: string;
  notes?: string;
}

export interface CardPayload {
  cardholderName: string;
  cardNumber: string;
  expiryMonth: string;
  expiryYear: string;
  cvv: string;
  notes?: string;
}

export interface NotePayload {
  content: string;
}

export interface SSHKeyPayload {
  privateKey: string;
  publicKey?: string;
  fingerprint?: string;
  passphrase?: string;
  notes?: string;
}

export interface APIKeyPayload {
  key: string;
  secret?: string;
  endpoint?: string;
  notes?: string;
}

export type SecretPayload =
  | LoginPayload
  | CardPayload
  | NotePayload
  | SSHKeyPayload
  | APIKeyPayload;

export interface DecryptedVaultSecret {
  id: string;
  label: string;
  /** "login" | "card" | "note" | "ssh_key" | "api_key" */
  secretType: string;
  /** "active" | "deleted" */
  status: string;
  createdAt: Date;
  updatedAt: Date;
  payload: SecretPayload;
}

// ---- Raw API shapes (snake_case from JSON) ----

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

export interface RawVaultKey {
  id: string;
  key_type: string;
  label: string | null;
  created_by: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawVaultSecret {
  id: string;
  label: string;
  secret_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface RawVaultSecretDetail extends RawVaultSecret {
  encrypted_payload: string;
}

export interface RawVaultUnlockResponse {
  wrapped_org_encryption_key: string | null;
  wrapped_org_encryption_keys:
    | Array<{ id: string; auth_hash: string; wrapped_org_encryption_key: string }>
    | null;
  encrypted_secrets: RawVaultSecretDetail[];
}

// ---- Parsers ----

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

export function parseVaultKey(r: RawVaultKey): VaultKey {
  return {
    id: r.id,
    keyType: r.key_type,
    label: r.label,
    createdBy: r.created_by,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseVaultSecret(r: RawVaultSecret): VaultSecret {
  return {
    id: r.id,
    label: r.label,
    secretType: r.secret_type,
    status: r.status,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  };
}

export function parseVaultSecretDetail(r: RawVaultSecretDetail): VaultSecretDetail {
  return {
    ...parseVaultSecret(r),
    encryptedPayload: r.encrypted_payload,
  };
}

// ---- Payload serialization (camelCase ↔ snake_case for JSON encryption) ----

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
    case "card": {
      const p = payload as CardPayload;
      const d: Record<string, unknown> = {
        cardholder_name: p.cardholderName,
        card_number: p.cardNumber,
        expiry_month: p.expiryMonth,
        expiry_year: p.expiryYear,
        cvv: p.cvv,
      };
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    case "note": {
      const p = payload as NotePayload;
      return { content: p.content };
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
      const d: Record<string, unknown> = { key: p.key };
      if (p.secret !== undefined) d.secret = p.secret;
      if (p.endpoint !== undefined) d.endpoint = p.endpoint;
      if (p.notes !== undefined) d.notes = p.notes;
      return d;
    }
    default:
      throw new Error(`Unknown secret_type: ${secretType}`);
  }
}

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
    case "card":
      return {
        cardholderName: raw.cardholder_name as string,
        cardNumber: raw.card_number as string,
        expiryMonth: raw.expiry_month as string,
        expiryYear: raw.expiry_year as string,
        cvv: raw.cvv as string,
        notes: raw.notes as string | undefined,
      } satisfies CardPayload;
    case "note":
      return { content: raw.content as string } satisfies NotePayload;
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
        key: raw.key as string,
        secret: raw.secret as string | undefined,
        endpoint: raw.endpoint as string | undefined,
        notes: raw.notes as string | undefined,
      } satisfies APIKeyPayload;
    default:
      throw new Error(`Unknown secret_type: ${secretType}`);
  }
}

export function inferSecretType(payload: SecretPayload): string {
  if ("username" in payload && "password" in payload) return "login";
  if ("cardholderName" in payload && "cardNumber" in payload) return "card";
  if ("content" in payload && !("key" in payload)) return "note";
  if ("privateKey" in payload) return "ssh_key";
  if ("key" in payload) return "api_key";
  throw new Error("Cannot infer secret_type from payload shape");
}

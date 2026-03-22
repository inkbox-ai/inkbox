/**
 * inkbox-vault/crypto.ts
 *
 * Client-side cryptography for the encrypted vault.
 *
 * Key derivation: Argon2id  (password → master key, via hash-wasm)
 * Encryption:     AES-256-GCM (via Node.js crypto)
 * Hashing:        SHA-256     (via Node.js crypto)
 *
 * Salt derivation:
 *   The Argon2id salt is derived deterministically from the organisation ID
 *   so that both the dashboard (vault init) and the SDK (vault unlock) can
 *   compute the same master key from the same password:
 *
 *     salt = TextEncoder.encode(orgId)
 */

import { argon2id } from "hash-wasm";
import {
  randomUUID,
  randomBytes,
  randomInt,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ARGON2_TIME_COST = 3;
const ARGON2_MEMORY_COST = 65536; // 64 MiB
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LEN = 32;

const AES_KEY_BYTES = 32;
const AES_IV_BYTES = 12;
const AES_TAG_BYTES = 16;

// Recovery code alphabet (unambiguous uppercase + digits, no 0/O/1/I/L)
const RC_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const RC_GROUP_LEN = 4;
const RC_GROUPS = 8; // 8 groups × 4 chars ≈ 120 bits of entropy

// ---------------------------------------------------------------------------
// Salt derivation
// ---------------------------------------------------------------------------

/**
 * Derive the Argon2id salt from the organisation ID.
 *
 * The salt is the raw UTF-8 encoding of the organisation ID.
 */
export function deriveSalt(organizationId: string): Uint8Array {
  return new TextEncoder().encode(organizationId);
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit master key from a password using Argon2id.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const hash = await argon2id({
    password,
    salt,
    iterations: ARGON2_TIME_COST,
    memorySize: ARGON2_MEMORY_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LEN,
    outputType: "binary",
  });
  return new Uint8Array(hash);
}

/** Compute `SHA-256(masterKey)` as a hex digest. */
export function computeAuthHash(masterKey: Uint8Array): string {
  return createHash("sha256").update(masterKey).digest("hex");
}

// ---------------------------------------------------------------------------
// AES-256-GCM
// ---------------------------------------------------------------------------

function aesGcmEncrypt(key: Uint8Array, plaintext: Uint8Array): Uint8Array {
  const iv = randomBytes(AES_IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = cipher.update(plaintext);
  const final = cipher.final();
  const tag = cipher.getAuthTag();
  // ciphertext || nonce || tag
  const result = new Uint8Array(
    encrypted.length + final.length + iv.length + tag.length,
  );
  result.set(encrypted, 0);
  result.set(final, encrypted.length);
  result.set(iv, encrypted.length + final.length);
  result.set(tag, encrypted.length + final.length + iv.length);
  return result;
}

function aesGcmDecrypt(key: Uint8Array, blob: Uint8Array): Uint8Array {
  const tag = blob.slice(-AES_TAG_BYTES);
  const nonce = blob.slice(-(AES_IV_BYTES + AES_TAG_BYTES), -AES_TAG_BYTES);
  const ct = blob.slice(0, -(AES_IV_BYTES + AES_TAG_BYTES));
  const decipher = createDecipheriv("aes-256-gcm", key, nonce);
  decipher.setAuthTag(tag);
  const decrypted = decipher.update(ct);
  const final = decipher.final();
  const result = new Uint8Array(decrypted.length + final.length);
  result.set(decrypted, 0);
  result.set(final, decrypted.length);
  return result;
}

/** Wrap the org encryption key with a master key. Returns base64. */
export function wrapOrgKey(
  masterKey: Uint8Array,
  orgKey: Uint8Array,
): string {
  const blob = aesGcmEncrypt(masterKey, orgKey);
  return Buffer.from(blob).toString("base64");
}

/** Unwrap the org encryption key. Returns raw 32 bytes. */
export function unwrapOrgKey(
  masterKey: Uint8Array,
  wrappedB64: string,
): Uint8Array {
  const blob = new Uint8Array(Buffer.from(wrappedB64, "base64"));
  return aesGcmDecrypt(masterKey, blob);
}

// ---------------------------------------------------------------------------
// Secret payload encryption / decryption
// ---------------------------------------------------------------------------

/** Serialize a payload to JSON and encrypt with the org key. Returns base64. */
export function encryptPayload(
  orgKey: Uint8Array,
  payload: Record<string, unknown>,
): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const blob = aesGcmEncrypt(orgKey, plaintext);
  return Buffer.from(blob).toString("base64");
}

/** Decrypt a base64 ciphertext blob and parse the JSON payload. */
export function decryptPayload(
  orgKey: Uint8Array,
  encryptedB64: string,
): Record<string, unknown> {
  const blob = new Uint8Array(Buffer.from(encryptedB64, "base64"));
  const plaintext = aesGcmDecrypt(orgKey, blob);
  return JSON.parse(new TextDecoder().decode(plaintext));
}

// ---------------------------------------------------------------------------
// Vault key material generation (used by dashboard / init code)
// ---------------------------------------------------------------------------

/** Generate a random 256-bit org encryption key. */
export function generateOrgEncryptionKey(): Uint8Array {
  return randomBytes(AES_KEY_BYTES);
}

export interface VaultKeyMaterial {
  /** Client-generated UUID (database primary key). */
  id: string;
  /** Base64-encoded AES-256-GCM ciphertext. */
  wrappedOrgEncryptionKey: string;
  /** SHA-256(masterKey) hex digest. */
  authHash: string;
  /** "primary" | "recovery" */
  keyType: string;
}

/**
 * Generate vault key material from a password.
 *
 * Derives a master key via Argon2id and wraps the org encryption key.
 */
export async function generateVaultKeyMaterial(
  password: string,
  organizationId: string,
  orgEncryptionKey: Uint8Array,
  options: { keyType?: string } = {},
): Promise<VaultKeyMaterial> {
  const salt = deriveSalt(organizationId);
  const masterKey = await deriveMasterKey(password, salt);
  const authHash = computeAuthHash(masterKey);
  const wrapped = wrapOrgKey(masterKey, orgEncryptionKey);

  return {
    id: randomUUID(),
    wrappedOrgEncryptionKey: wrapped,
    authHash,
    keyType: options.keyType ?? "primary",
  };
}

/**
 * Generate a random recovery code and its vault key material.
 *
 * The recovery code is a human-readable string of the form
 * `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (~120 bits of entropy).
 *
 * @returns `[codeString, material]` tuple. The code string must be stored
 *   securely by the user — it cannot be recovered.
 */
export async function generateRecoveryCode(
  organizationId: string,
  orgEncryptionKey: Uint8Array,
): Promise<[string, VaultKeyMaterial]> {
  const groups: string[] = [];
  for (let g = 0; g < RC_GROUPS; g++) {
    let group = "";
    for (let c = 0; c < RC_GROUP_LEN; c++) {
      const idx = randomInt(RC_ALPHABET.length);
      group += RC_ALPHABET[idx];
    }
    groups.push(group);
  }
  const code = groups.join("-");

  const material = await generateVaultKeyMaterial(
    code,
    organizationId,
    orgEncryptionKey,
    { keyType: "recovery" },
  );
  return [code, material];
}

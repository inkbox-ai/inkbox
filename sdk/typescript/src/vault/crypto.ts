/**
 * inkbox-vault/crypto.ts
 *
 * Client-side cryptography for the encrypted vault.
 *
 * Key derivation: Argon2id  (vault key → master key, via hash-wasm)
 * Encryption:     AES-256-GCM (via Node.js crypto)
 * Hashing:        SHA-256     (via Node.js crypto)
 *
 * Salt derivation:
 *   The Argon2id salt is derived deterministically from the organisation ID
 *   so that both the dashboard (vault init) and the SDK (vault unlock) can
 *   compute the same master key from the same vault key:
 *
 *     salt = TextEncoder.encode(orgId)
 */

import { InkboxVaultKeyError } from "../_http.js";
import { argon2id } from "hash-wasm";
import {
  randomUUID,
  randomBytes,
  randomInt,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { VaultKeyType } from "./types.js";

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
// Vault key validation
// ---------------------------------------------------------------------------

/**
 * Validate that a vault key meets minimum strength requirements.
 *
 * Requirements: at least 16 characters, one uppercase letter, one
 * lowercase letter, one digit, and one special character.
 *
 * @param vaultKey - The vault key string to validate.
 * @throws {@link InkboxVaultKeyError} If the vault key does not meet requirements.
 */
export function validateVaultKey(vaultKey: string): void {
  if (vaultKey.length < 16)
    throw new InkboxVaultKeyError("Vault key must be at least 16 characters");
  if (!/[A-Z]/.test(vaultKey))
    throw new InkboxVaultKeyError("Vault key must contain at least one uppercase letter");
  if (!/[a-z]/.test(vaultKey))
    throw new InkboxVaultKeyError("Vault key must contain at least one lowercase letter");
  if (!/[0-9]/.test(vaultKey))
    throw new InkboxVaultKeyError("Vault key must contain at least one digit");
  if (!/[^A-Za-z0-9]/.test(vaultKey))
    throw new InkboxVaultKeyError("Vault key must contain at least one special character");
}

// ---------------------------------------------------------------------------
// Salt derivation
// ---------------------------------------------------------------------------

/**
 * Derive the Argon2id salt from the organisation ID.
 *
 * @param organizationId - The organisation ID string.
 * @returns The raw UTF-8 bytes of the organisation ID.
 */
export function deriveSalt(organizationId: string): Uint8Array {
  return new TextEncoder().encode(organizationId);
}

// ---------------------------------------------------------------------------
// Key derivation
// ---------------------------------------------------------------------------

/**
 * Derive a 256-bit master key from a vault key using Argon2id.
 *
 * @param vaultKey - The vault key or recovery code string.
 * @param salt - Salt bytes from {@link deriveSalt}.
 * @returns 32-byte master key.
 */
export async function deriveMasterKey(
  vaultKey: string,
  salt: Uint8Array,
): Promise<Uint8Array> {
  const hash = await argon2id({
    password: vaultKey,
    salt,
    iterations: ARGON2_TIME_COST,
    memorySize: ARGON2_MEMORY_COST,
    parallelism: ARGON2_PARALLELISM,
    hashLength: ARGON2_HASH_LEN,
    outputType: "binary",
  });
  return new Uint8Array(hash);
}

/**
 * Compute `SHA-256(masterKey)` as a hex digest.
 *
 * @param masterKey - The 32-byte master key.
 * @returns 64-character hex string.
 */
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

/**
 * Wrap the org encryption key with a master key.
 *
 * @param masterKey - 32-byte master key.
 * @param orgKey - 32-byte org encryption key to wrap.
 * @returns Base64-encoded ciphertext blob.
 */
export function wrapOrgKey(
  masterKey: Uint8Array,
  orgKey: Uint8Array,
): string {
  const blob = aesGcmEncrypt(masterKey, orgKey);
  return Buffer.from(blob).toString("base64");
}

/**
 * Unwrap the org encryption key using a master key.
 *
 * @param masterKey - 32-byte master key.
 * @param wrappedB64 - Base64-encoded ciphertext blob from the server.
 * @returns 32-byte org encryption key.
 */
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

/**
 * Serialize a payload to JSON and encrypt it with the org encryption key.
 *
 * @param orgKey - 32-byte org encryption key.
 * @param payload - Plain object to encrypt.
 * @returns Base64-encoded ciphertext blob.
 */
export function encryptPayload(
  orgKey: Uint8Array,
  payload: Record<string, unknown>,
): string {
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const blob = aesGcmEncrypt(orgKey, plaintext);
  return Buffer.from(blob).toString("base64");
}

/**
 * Decrypt a base64 ciphertext blob and parse the JSON payload.
 *
 * @param orgKey - 32-byte org encryption key.
 * @param encryptedB64 - Base64-encoded ciphertext blob.
 * @returns The decrypted payload as a plain object.
 */
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

/**
 * Generate a random 256-bit org encryption key.
 *
 * @returns 32 cryptographically random bytes.
 */
export function generateOrgEncryptionKey(): Uint8Array {
  return randomBytes(AES_KEY_BYTES);
}

/**
 * Cryptographic material for registering a vault key with the server.
 *
 * Call {@link vaultKeyMaterialToWire} to get a JSON-ready object with
 * snake_case keys matching `POST /vault/initialize` or `POST /vault/keys`.
 */
export interface VaultKeyMaterial {
  /** Client-generated UUID (database primary key). */
  id: string;
  /** Base64-encoded AES-256-GCM ciphertext wrapping the org encryption key. */
  wrappedOrgEncryptionKey: string;
  /** `SHA-256(masterKey)` hex digest. */
  authHash: string;
  /** `"primary"` or `"recovery"`. */
  keyType: VaultKeyType;
}

/**
 * Convert {@link VaultKeyMaterial} to a JSON-ready object matching the API's
 * expected snake_case schema.
 */
export function vaultKeyMaterialToWire(m: VaultKeyMaterial): Record<string, string> {
  return {
    id: m.id,
    wrapped_org_encryption_key: m.wrappedOrgEncryptionKey,
    auth_hash: m.authHash,
    key_type: m.keyType,
  };
}

/**
 * Generate vault key material from a vault key.
 *
 * Derives a master key via Argon2id and wraps the org encryption key.
 *
 * @param vaultKey - The vault key string.
 * @param organizationId - Organisation ID (used as Argon2id salt).
 * @param orgEncryptionKey - 32-byte org encryption key to wrap.
 * @param options.keyType - `"primary"` (default) or `"recovery"`.
 * @returns Material ready to send to the server.
 * @throws {@link InkboxVaultKeyError} If the vault key fails validation.
 */
export async function generateVaultKeyMaterial(
  vaultKey: string,
  organizationId: string,
  orgEncryptionKey: Uint8Array,
  options: { keyType?: VaultKeyType } = {},
): Promise<VaultKeyMaterial> {
  validateVaultKey(vaultKey);
  const salt = deriveSalt(organizationId);
  const masterKey = await deriveMasterKey(vaultKey, salt);
  const authHash = computeAuthHash(masterKey);
  const wrapped = wrapOrgKey(masterKey, orgEncryptionKey);

  return {
    id: randomUUID(),
    wrappedOrgEncryptionKey: wrapped,
    authHash,
    keyType: options.keyType ?? VaultKeyType.PRIMARY,
  };
}

/**
 * Generate a random recovery code and its vault key material.
 *
 * The recovery code is a human-readable string of the form
 * `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX` (~120 bits of entropy).
 *
 * @param organizationId - Organisation ID (used as Argon2id salt).
 * @param orgEncryptionKey - 32-byte org encryption key to wrap.
 * @returns `[codeString, material]` tuple. The code string must be stored
 *   securely — it cannot be recovered.
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

  // Recovery codes bypass validateVaultKey — they are auto-generated
  // and don't follow vault key rules.  Derive directly.
  const salt = deriveSalt(organizationId);
  const masterKey = await deriveMasterKey(code, salt);
  const authHash = computeAuthHash(masterKey);
  const wrapped = wrapOrgKey(masterKey, orgEncryptionKey);

  const material: VaultKeyMaterial = {
    id: randomUUID(),
    wrappedOrgEncryptionKey: wrapped,
    authHash,
    keyType: VaultKeyType.RECOVERY,
  };
  return [code, material];
}

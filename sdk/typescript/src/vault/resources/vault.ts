/**
 * inkbox-vault/resources/vault.ts
 *
 * VaultResource   — org-level vault operations.
 * UnlockedVault   — crypto-enabled wrapper for secret CRUD after unlock.
 */

import { HttpTransport } from "../../_http.js";
import {
  computeAuthHash,
  decryptPayload,
  deriveMasterKey,
  deriveSalt,
  encryptPayload,
  unwrapOrgKey,
} from "../crypto.js";
import type {
  DecryptedVaultSecret,
  SecretPayload,
  VaultInfo,
  VaultKey,
  VaultSecret,
  VaultSecretDetail,
} from "../types.js";
import {
  inferSecretType,
  parsePayload,
  parseVaultInfo,
  parseVaultKey,
  parseVaultSecret,
  parseVaultSecretDetail,
  serializePayload,
} from "../types.js";
import type {
  RawVaultInfo,
  RawVaultKey,
  RawVaultSecret,
  RawVaultSecretDetail,
  RawVaultUnlockResponse,
} from "../types.js";

/**
 * Org-level vault operations.
 *
 * Access via `inkbox.vault`. Most read-only operations work without
 * unlocking. To create, read, or update secret payloads, call
 * {@link unlock} first.
 */
export class VaultResource {
  /** @internal */
  readonly http: HttpTransport;

  /** @internal */
  _unlocked: UnlockedVault | null = null;

  /** @internal */
  constructor(http: HttpTransport) {
    this.http = http;
  }

  // ------------------------------------------------------------------
  // Vault metadata
  // ------------------------------------------------------------------

  /** Get vault metadata for the caller's organisation. */
  async info(): Promise<VaultInfo> {
    const data = await this.http.get<RawVaultInfo>("/info");
    return parseVaultInfo(data);
  }

  // ------------------------------------------------------------------
  // Keys (read-only via API key)
  // ------------------------------------------------------------------

  /**
   * List vault keys (metadata only — no wrapped key material).
   *
   * @param options.keyType - Optional filter: `"primary"` or `"recovery"`.
   */
  async listKeys(options: { keyType?: string } = {}): Promise<VaultKey[]> {
    const params: Record<string, string> = {};
    if (options.keyType !== undefined) params["type"] = options.keyType;
    const data = await this.http.get<RawVaultKey[]>("/keys", params);
    return data.map(parseVaultKey);
  }

  // ------------------------------------------------------------------
  // Secrets (metadata-only operations)
  // ------------------------------------------------------------------

  /**
   * List vault secrets (metadata only, no encrypted payload).
   *
   * @param options.secretType - Optional filter: `"login"`, `"ssh_key"`,
   *   `"api_key"`, or `"other"`.
   */
  async listSecrets(options: { secretType?: string } = {}): Promise<VaultSecret[]> {
    const params: Record<string, string> = {};
    if (options.secretType !== undefined) params["secret_type"] = options.secretType;
    const data = await this.http.get<RawVaultSecret[]>("/secrets", params);
    return data.map(parseVaultSecret);
  }

  /**
   * Delete a vault secret.
   *
   * @param secretId - UUID of the secret to delete.
   */
  async deleteSecret(secretId: string): Promise<void> {
    await this.http.delete(`/secrets/${secretId}`);
  }

  // ------------------------------------------------------------------
  // Unlock
  // ------------------------------------------------------------------

  /**
   * Unlock the vault with a vault key.
   *
   * Derives the encryption key from the provided vault key, fetches
   * and decrypts all vault secrets.
   *
   * @param vaultKey - Vault key or recovery code.
   * @param options.identityId - Optional agent identity UUID. When
   *   provided, only secrets that this identity has been granted access
   *   to are included in {@link UnlockedVault.secrets}.
   * @returns {@link UnlockedVault} with decrypted secrets and methods for
   *   secret CRUD.
   * @throws If the vault key is incorrect or the vault key has been deleted.
   */
  async unlock(
    vaultKey: string,
    options: { identityId?: string } = {},
  ): Promise<UnlockedVault> {
    // Step 1: get org_id for salt derivation
    const vaultInfo = await this.info();
    const salt = deriveSalt(vaultInfo.organizationId);

    // Step 2: derive master key → auth hash
    const masterKey = await deriveMasterKey(vaultKey, salt);
    const authHash = computeAuthHash(masterKey);

    // Step 3: fetch wrapped key + encrypted secrets
    // We always send auth_hash, so the server returns the singular
    // wrapped_org_encryption_key for the matching vault key.  The
    // plural wrapped_org_encryption_keys is only returned when
    // auth_hash is omitted (a recovery flow this SDK does not use,
    // since recovery codes are derived the same way as vault keys).
    const data = await this.http.get<RawVaultUnlockResponse>("/unlock", {
      auth_hash: authHash,
    });

    const wrapped = data.wrapped_org_encryption_key;
    if (!wrapped) {
      throw new Error(
        "No vault key matched. " +
          "Check that the vault key is correct and has not been deleted.",
      );
    }

    // Step 4: unwrap the org encryption key
    const orgKey = unwrapOrgKey(masterKey, wrapped);

    // Step 5: decrypt all secrets from the unlock bundle
    const decrypted: DecryptedVaultSecret[] = [];
    for (const raw of data.encrypted_secrets ?? []) {
      const detail = parseVaultSecretDetail(raw);
      const payloadDict = decryptPayload(orgKey, detail.encryptedPayload);
      const payload = parsePayload(
        detail.secretType,
        payloadDict as Record<string, unknown>,
      );
      decrypted.push({
        id: detail.id,
        name: detail.name,
        description: detail.description,
        secretType: detail.secretType,
        status: detail.status,
        createdAt: detail.createdAt,
        updatedAt: detail.updatedAt,
        payload,
      });
    }

    // Always store the unfiltered vault so identity.getCredentials()
    // has the full set to filter from, even when identityId is provided.
    this._unlocked = new UnlockedVault(this.http, orgKey, [...decrypted]);

    // Step 6 (optional): filter by identity access rules
    if (options.identityId !== undefined) {
      const idStr = options.identityId;
      const filtered: DecryptedVaultSecret[] = [];
      for (const secret of decrypted) {
        const rules = await this.http.get<
          Array<{ id: string; vault_secret_id: string; identity_id: string; created_at: string }>
        >(`/secrets/${secret.id}/access`);
        if (rules.some((r) => r.identity_id === idStr)) {
          filtered.push(secret);
        }
      }
      return new UnlockedVault(this.http, orgKey, filtered);
    }

    return this._unlocked;
  }
}

/**
 * A vault unlocked with a valid vault key.
 *
 * Provides transparent encrypt/decrypt for secret CRUD operations.
 *
 * Obtain via {@link VaultResource.unlock}.
 */
export class UnlockedVault {
  private readonly http: HttpTransport;
  private readonly orgKey: Uint8Array;
  private readonly secretsCache: DecryptedVaultSecret[];

  constructor(
    http: HttpTransport,
    orgKey: Uint8Array,
    secretsCache: DecryptedVaultSecret[],
  ) {
    this.http = http;
    this.orgKey = orgKey;
    this.secretsCache = secretsCache;
  }

  /** All vault secrets decrypted from the unlock response. */
  get secrets(): DecryptedVaultSecret[] {
    return [...this.secretsCache];
  }

  // ------------------------------------------------------------------
  // Encrypted CRUD
  // ------------------------------------------------------------------

  /**
   * Fetch and decrypt a single vault secret.
   *
   * @param secretId - UUID of the secret.
   */
  async getSecret(secretId: string): Promise<DecryptedVaultSecret> {
    const data = await this.http.get<RawVaultSecretDetail>(
      `/secrets/${secretId}`,
    );
    const detail = parseVaultSecretDetail(data);
    const payloadDict = decryptPayload(this.orgKey, detail.encryptedPayload);
    const payload = parsePayload(
      detail.secretType,
      payloadDict as Record<string, unknown>,
    );
    return {
      id: detail.id,
      name: detail.name,
      description: detail.description,
      secretType: detail.secretType,
      status: detail.status,
      createdAt: detail.createdAt,
      updatedAt: detail.updatedAt,
      payload,
    };
  }

  /**
   * Encrypt and store a new secret.
   *
   * The `secretType` is inferred from the payload shape.
   *
   * @param options.name - Display name (max 255 characters).
   * @param options.description - Optional description.
   * @param options.payload - One of {@link LoginPayload}, {@link SSHKeyPayload},
   *   {@link APIKeyPayload}, or {@link OtherPayload}.
   */
  async createSecret(options: {
    name: string;
    description?: string;
    payload: SecretPayload;
  }): Promise<VaultSecret> {
    const secretType = inferSecretType(options.payload);
    const serialized = serializePayload(secretType, options.payload);
    const encrypted = encryptPayload(this.orgKey, serialized);
    const body: Record<string, unknown> = {
      name: options.name,
      secret_type: secretType,
      encrypted_payload: encrypted,
    };
    if (options.description !== undefined) body["description"] = options.description;
    const data = await this.http.post<RawVaultSecret>("/secrets", body);
    return parseVaultSecret(data);
  }

  /**
   * Update a vault secret's name, description, and/or encrypted payload.
   *
   * Only provided fields are sent to the server.
   *
   * **Note:** The `secretType` is immutable after creation.  If a payload
   * is provided it must be the **same type** as the original (e.g. update
   * a `login` secret with a new {@link LoginPayload}).  To change the
   * type, delete the secret and create a new one.
   *
   * @param secretId - UUID of the secret to update.
   * @param options.name - New display name.
   * @param options.description - New description.
   * @param options.payload - New payload of the **same type** as the
   *   original (will be re-encrypted).
   */
  async updateSecret(
    secretId: string,
    options: {
      name?: string;
      description?: string;
      payload?: SecretPayload;
    },
  ): Promise<VaultSecret> {
    const body: Record<string, unknown> = {};
    if ("name" in options) body["name"] = options.name;
    if ("description" in options) body["description"] = options.description;
    if (options.payload !== undefined) {
      // Enforce secret_type immutability — the server treats the
      // payload as opaque ciphertext and cannot check this itself.
      const current = parseVaultSecret(
        await this.http.get<RawVaultSecret>(`/secrets/${secretId}`),
      );
      const newType = inferSecretType(options.payload);
      if (newType !== current.secretType) {
        throw new TypeError(
          `Cannot update a '${current.secretType}' secret with a '${newType}' payload. Delete and recreate instead.`,
        );
      }
      const serialized = serializePayload(newType, options.payload);
      body["encrypted_payload"] = encryptPayload(this.orgKey, serialized);
    }
    const data = await this.http.patch<RawVaultSecret>(
      `/secrets/${secretId}`,
      body,
    );
    return parseVaultSecret(data);
  }

  /**
   * Delete a vault secret.
   *
   * @param secretId - UUID of the secret to delete.
   */
  async deleteSecret(secretId: string): Promise<void> {
    await this.http.delete(`/secrets/${secretId}`);
  }
}

/**
 * inkbox-vault/resources/vault.ts
 *
 * VaultResource   — org-level vault operations.
 * UnlockedVault   — crypto-enabled wrapper for secret CRUD after unlock.
 */

import { HttpTransport, InkboxAPIError, InkboxError } from "../../_http.js";
import type { TOTPCode, TOTPConfig } from "../totp.js";
import { generateTotp, parseTotpUri } from "../totp.js";
import {
  computeAuthHash,
  decryptPayload,
  deriveMasterKey,
  deriveSalt,
  encryptPayload,
  generateOrgEncryptionKey,
  generateRecoveryCode,
  generateVaultKeyMaterial,
  unwrapOrgKey,
  vaultKeyMaterialToWire,
} from "../crypto.js";
import type {
  AccessRule,
  DecryptedVaultSecret,
  SecretPayload,
  VaultInfo,
  VaultInitializeResult,
  VaultKey,
  VaultSecret,
  VaultSecretDetail,
} from "../types.js";
import {
  VaultSecretType,
  inferSecretType,
  parseAccessRule,
  parsePayload,
  parseVaultInfo,
  parseVaultKey,
  parseVaultSecret,
  parseVaultSecretDetail,
  serializePayload,
} from "../types.js";
import type {
  RawAccessRule,
  RawVaultInfo,
  RawVaultInitializeResponse,
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
  private readonly apiHttp: HttpTransport | null;

  /** @internal */
  _unlocked: UnlockedVault | null = null;

  /** The cached {@link UnlockedVault}, or `null` if not yet unlocked. */
  get unlocked(): UnlockedVault | null {
    return this._unlocked;
  }

  /** @internal */
  constructor(http: HttpTransport, apiHttp?: HttpTransport) {
    this.http = http;
    this.apiHttp = apiHttp ?? null;
  }

  // ------------------------------------------------------------------
  // Vault metadata
  // ------------------------------------------------------------------

  /** Get vault metadata for the caller's organisation, or `null` if not initialized. */
  async info(): Promise<VaultInfo | null> {
    try {
      const data = await this.http.get<RawVaultInfo>("/info");
      return parseVaultInfo(data);
    } catch (err) {
      if (err instanceof InkboxAPIError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  /**
   * Fetch the organisation ID via `/api/whoami`.
   * @internal
   */
  private async fetchOrganizationId(): Promise<string> {
    if (!this.apiHttp) {
      throw new Error(
        "Cannot fetch organization ID: no API transport available",
      );
    }
    const data = await this.apiHttp.get<{ organization_id: string }>("/whoami");
    if (!data.organization_id) {
      throw new Error("Could not determine organization ID from API key");
    }
    return data.organization_id;
  }

  /**
   * Initialize a new vault for the organisation.
   *
   * Generates a random org encryption key, wraps it with the provided
   * vault key, and creates four recovery codes. All cryptographic
   * material is generated client-side; the server only receives
   * ciphertexts and identifiers.
   *
   * @param vaultKey - The vault key (password) to protect the vault.
   *   Must be at least 16 characters with uppercase, lowercase, digit,
   *   and special character.
   * @returns {@link VaultInitializeResult} containing the vault ID,
   *   primary key ID, and recovery codes. The recovery codes must be
   *   stored securely — they cannot be retrieved again.
   * @throws If the organisation already has an active vault (409).
   */
  async initialize(
    vaultKey: string,
  ): Promise<VaultInitializeResult> {
    const organizationId = await this.fetchOrganizationId();
    const orgEncryptionKey = generateOrgEncryptionKey();

    const primaryMaterial = await generateVaultKeyMaterial(
      vaultKey,
      organizationId,
      orgEncryptionKey,
    );

    const recoveryCodes: string[] = [];
    const recoveryWires: Record<string, string>[] = [];
    for (let i = 0; i < 4; i++) {
      const [code, material] = await generateRecoveryCode(
        organizationId,
        orgEncryptionKey,
      );
      recoveryCodes.push(code);
      recoveryWires.push(vaultKeyMaterialToWire(material));
    }

    const data = await this.http.post<RawVaultInitializeResponse>(
      "/initialize",
      {
        vault_key: vaultKeyMaterialToWire(primaryMaterial),
        recovery_keys: recoveryWires,
      },
    );

    return {
      vaultId: data.vault_id,
      vaultKeyId: data.vault_key_id,
      recoveryKeyCount: data.recovery_key_count,
      recoveryCodes,
    };
  }

  /**
   * Replace the primary vault key (change the vault password).
   *
   * Exactly one of `currentVaultKey` or `recoveryCode` must be
   * provided to authenticate the change:
   *
   * - **Normal update** (`currentVaultKey`): proves knowledge of the
   *   current primary key. The old key is deleted.
   * - **Recovery update** (`recoveryCode`): proves knowledge of a
   *   recovery code which is consumed (one-time use). The current
   *   primary key is also deleted.
   *
   * In both cases a new primary key is created from `newVaultKey`.
   *
   * @param options.newVaultKey - The new vault key (password).
   * @param options.currentVaultKey - Current primary vault key (normal update).
   * @param options.recoveryCode - A recovery code (recovery update).
   * @returns {@link VaultKey} metadata for the newly created primary key.
   */
  async updateKey(options: {
    newVaultKey: string;
    currentVaultKey?: string;
    recoveryCode?: string;
  }): Promise<VaultKey> {
    const hasCurrentKey = options.currentVaultKey !== undefined;
    const hasRecoveryCode = options.recoveryCode !== undefined;
    if (hasCurrentKey === hasRecoveryCode) {
      throw new Error(
        "Exactly one of currentVaultKey or recoveryCode must be provided",
      );
    }

    const authKey = options.currentVaultKey ?? options.recoveryCode!;

    // Fetch org_id (vault must already exist)
    const vaultInfo = await this.info();
    const salt = deriveSalt(vaultInfo.organizationId);

    // Derive master key and auth hash from the authenticating key
    const authMasterKey = await deriveMasterKey(authKey, salt);
    const authAuthHash = computeAuthHash(authMasterKey);

    // Fetch wrapped org encryption key
    const unlockData = await this.http.get<RawVaultUnlockResponse>(
      "/unlock",
      { auth_hash: authAuthHash },
    );

    const wrapped = unlockData.wrapped_org_encryption_key;
    if (!wrapped) {
      throw new Error(
        "No vault key matched. " +
          "Check that the vault key or recovery code is correct.",
      );
    }

    // Unwrap org encryption key (try each active key ID as AAD)
    const keysData = await this.http.get<RawVaultKey[]>("/keys");
    const activeKeyIds = keysData
      .filter((k) => k.status === "active")
      .map((k) => k.id);

    let orgKey: Uint8Array | null = null;
    for (const keyId of activeKeyIds) {
      try {
        orgKey = unwrapOrgKey(authMasterKey, wrapped, keyId);
        break;
      } catch {
        continue;
      }
    }
    if (!orgKey) {
      throw new Error(
        "Failed to unwrap org encryption key. " +
          "Check that the vault key is correct.",
      );
    }

    // Generate new primary key material
    const newMaterial = await generateVaultKeyMaterial(
      options.newVaultKey,
      vaultInfo.organizationId,
      orgKey,
    );

    // PUT /keys/primary
    const body: Record<string, unknown> = {
      id: newMaterial.id,
      wrapped_org_encryption_key: newMaterial.wrappedOrgEncryptionKey,
      auth_hash: newMaterial.authHash,
    };
    if (hasCurrentKey) {
      body.current_auth_hash = authAuthHash;
    } else {
      body.recovery_auth_hash = authAuthHash;
    }

    const data = await this.http.put<RawVaultKey>("/keys/primary", body);
    return parseVaultKey(data);
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

  /**
   * Delete a vault key by auth hash.
   *
   * @param authHash - Auth hash of the key to revoke.
   */
  async deleteKey(authHash: string): Promise<void> {
    await this.http.delete(`/keys/${authHash}`);
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
  // Access rules
  // ------------------------------------------------------------------

  /**
   * List identity access rules for a vault secret.
   *
   * @param secretId - UUID of the secret.
   */
  async listAccessRules(secretId: string): Promise<AccessRule[]> {
    const data = await this.http.get<RawAccessRule[]>(
      `/secrets/${secretId}/access`,
    );
    return data.map(parseAccessRule);
  }

  /**
   * Grant an identity access to a vault secret.
   *
   * @param secretId - UUID of the secret.
   * @param identityId - UUID of the identity to grant access to.
   */
  async grantAccess(secretId: string, identityId: string): Promise<AccessRule> {
    const data = await this.http.post<RawAccessRule>(
      `/secrets/${secretId}/access`,
      { identity_id: identityId },
    );
    return parseAccessRule(data);
  }

  /**
   * Revoke an identity's access to a vault secret.
   *
   * @param secretId - UUID of the secret.
   * @param identityId - UUID of the identity to revoke access from.
   */
  async revokeAccess(secretId: string, identityId: string): Promise<void> {
    await this.http.delete(`/secrets/${secretId}/access/${identityId}`);
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

    // Step 4: unwrap the org encryption key.
    // The wrapped key was encrypted with the vault key UUID as AAD.
    // Fetch all key IDs and try each as AAD until one works.
    const keysData = await this.http.get<RawVaultKey[]>("/keys");
    const allKeyIds = keysData
      .filter((k) => k.status === "active")
      .map((k) => k.id);

    let orgKey: Uint8Array | null = null;
    for (const keyId of allKeyIds) {
      try {
        orgKey = unwrapOrgKey(masterKey, wrapped, keyId);
        break;
      } catch {
        continue;
      }
    }
    if (!orgKey) {
      throw new Error(
        "Failed to unwrap org encryption key. Check that the vault key is correct.",
      );
    }

    // Step 5: decrypt all secrets from the unlock bundle
    const decrypted: DecryptedVaultSecret[] = [];
    for (const raw of data.encrypted_secrets ?? []) {
      const detail = parseVaultSecretDetail(raw);
      const payloadDict = decryptPayload(orgKey, detail.encryptedPayload, detail.id);
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
  private secretsCache: DecryptedVaultSecret[];

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

  /**
   * Re-fetch, decrypt, and update a single secret in the cache.
   *
   * Best-effort — if the re-fetch fails the cache is left unchanged.
   */
  private async refreshCachedSecret(secretId: string): Promise<void> {
    try {
      const updated = await this.getSecret(secretId);
      this.secretsCache = this.secretsCache.map((s) =>
        s.id === secretId ? updated : s,
      );
    } catch {
      // Cache refresh is best-effort.
    }
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
    const payloadDict = decryptPayload(this.orgKey, detail.encryptedPayload, detail.id);
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
    // Generate the UUID client-side so we can use it as AAD for
    // encryption in the same request.
    const secretId = crypto.randomUUID();
    const encrypted = encryptPayload(this.orgKey, serialized, secretId);
    const body: Record<string, unknown> = {
      id: secretId,
      name: options.name,
      secret_type: secretType,
      encrypted_payload: encrypted,
    };
    if (options.description !== undefined) body["description"] = options.description;
    const data = await this.http.post<RawVaultSecret>("/secrets", body);
    const result = parseVaultSecret(data);
    // Append the new secret to the cache so it's immediately visible.
    try {
      const decrypted = await this.getSecret(result.id);
      this.secretsCache.push(decrypted);
    } catch {
      // best-effort
    }
    return result;
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
      body["encrypted_payload"] = encryptPayload(this.orgKey, serialized, secretId);
    }
    const data = await this.http.patch<RawVaultSecret>(
      `/secrets/${secretId}`,
      body,
    );
    // Refresh the cache so subsequent reads are consistent.
    await this.refreshCachedSecret(secretId);
    return parseVaultSecret(data);
  }

  /**
   * Delete a vault secret.
   *
   * @param secretId - UUID of the secret to delete.
   */
  async deleteSecret(secretId: string): Promise<void> {
    await this.http.delete(`/secrets/${secretId}`);
    this.secretsCache = this.secretsCache.filter((s) => s.id !== secretId);
  }

  // ------------------------------------------------------------------
  // TOTP helpers
  // ------------------------------------------------------------------

  /**
   * Add or replace the TOTP configuration on a login secret.
   *
   * @param secretId - UUID of the login secret.
   * @param totp - A {@link TOTPConfig} object or an `otpauth://totp/...` URI string.
   * @returns Updated {@link VaultSecret} metadata.
   * @throws TypeError if the secret is not a login type.
   * @throws Error if a URI string is invalid or not TOTP.
   */
  async setTotp(
    secretId: string,
    totp: TOTPConfig | string,
  ): Promise<VaultSecret> {
    const config = typeof totp === "string" ? parseTotpUri(totp) : totp;
    const secret = await this.getSecret(secretId);
    if (secret.secretType !== VaultSecretType.LOGIN) {
      throw new TypeError(
        `Cannot set TOTP on a '${secret.secretType}' secret — only login secrets support TOTP`,
      );
    }
    const payload = { ...secret.payload, totp: config };
    return this.updateSecret(secretId, { payload });
  }

  /**
   * Remove TOTP configuration from a login secret.
   *
   * @param secretId - UUID of the login secret.
   * @returns Updated {@link VaultSecret} metadata.
   * @throws TypeError if the secret is not a login type.
   */
  async removeTotp(secretId: string): Promise<VaultSecret> {
    const secret = await this.getSecret(secretId);
    if (secret.secretType !== VaultSecretType.LOGIN) {
      throw new TypeError(
        `Cannot remove TOTP from a '${secret.secretType}' secret — only login secrets support TOTP`,
      );
    }
    const loginPayload = secret.payload as import("../types.js").LoginPayload;
    const { totp: _, ...rest } = loginPayload;
    return this.updateSecret(secretId, { payload: rest });
  }

  /**
   * Generate the current TOTP code for a login secret.
   *
   * @param secretId - UUID of the login secret.
   * @returns A {@link TOTPCode}.
   * @throws TypeError if the secret is not a login type.
   * @throws Error if the login has no TOTP configured.
   */
  async getTotpCode(secretId: string): Promise<TOTPCode> {
    const secret = await this.getSecret(secretId);
    if (secret.secretType !== VaultSecretType.LOGIN) {
      throw new TypeError(
        `Cannot generate TOTP for a '${secret.secretType}' secret — only login secrets support TOTP`,
      );
    }
    const loginPayload = secret.payload as import("../types.js").LoginPayload;
    if (!loginPayload.totp) {
      throw new Error(`Login secret '${secretId}' has no TOTP configured`);
    }
    return generateTotp(loginPayload.totp);
  }
}

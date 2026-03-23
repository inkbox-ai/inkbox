/**
 * inkbox/src/credentials.ts
 *
 * Credentials — agent-facing credential access, typed and identity-scoped.
 *
 * This is the *runtime* surface for agents that need their credentials.
 * The vault remains the *admin* surface for creating secrets, managing
 * keys, and configuring access rules.
 */

import type { TOTPCode } from "./vault/totp.js";
import { generateTotp } from "./vault/totp.js";
import type {
  APIKeyPayload,
  DecryptedVaultSecret,
  KeyPairPayload,
  LoginPayload,
  SSHKeyPayload,
} from "./vault/types.js";
import { VaultSecretType } from "./vault/types.js";

/**
 * Agent-facing credential access — typed, identity-scoped.
 *
 * Wraps a pre-filtered list of {@link DecryptedVaultSecret} objects and
 * provides typed accessors so agents can retrieve credentials without
 * dealing with vault internals.
 *
 * Obtain via {@link AgentIdentity.getCredentials} after unlocking the vault:
 *
 * ```ts
 * await inkbox.vault.unlock("my-Vault-key-01!");
 * const identity = await inkbox.getIdentity("support-bot");
 *
 * const creds = await identity.getCredentials();
 * const logins = creds.listLogins();
 * const apiKey = creds.getApiKey("cccc3333-...");
 * ```
 */
export class Credentials {
  private readonly _secrets: DecryptedVaultSecret[];
  private readonly _byId: Map<string, DecryptedVaultSecret>;

  constructor(secrets: DecryptedVaultSecret[]) {
    this._secrets = secrets;
    this._byId = new Map(secrets.map((s) => [s.id, s]));
  }

  // ------------------------------------------------------------------
  // Discovery — return full DecryptedVaultSecret for name/metadata
  // ------------------------------------------------------------------

  /** List all credentials this identity has access to. */
  list(): DecryptedVaultSecret[] {
    return [...this._secrets];
  }

  /** List login credentials (username/password). */
  listLogins(): DecryptedVaultSecret[] {
    return this._secrets.filter((s) => s.secretType === VaultSecretType.LOGIN);
  }

  /** List API key credentials. */
  listApiKeys(): DecryptedVaultSecret[] {
    return this._secrets.filter((s) => s.secretType === VaultSecretType.API_KEY);
  }

  /** List key pair credentials (access key + secret key). */
  listKeyPairs(): DecryptedVaultSecret[] {
    return this._secrets.filter((s) => s.secretType === VaultSecretType.KEY_PAIR);
  }

  /** List SSH key credentials. */
  listSshKeys(): DecryptedVaultSecret[] {
    return this._secrets.filter((s) => s.secretType === VaultSecretType.SSH_KEY);
  }

  // ------------------------------------------------------------------
  // Access by UUID — return typed payload directly
  // ------------------------------------------------------------------

  /**
   * Get any credential by UUID.
   *
   * @param secretId - UUID of the secret.
   * @throws Error if no credential with this UUID is accessible.
   */
  get(secretId: string): DecryptedVaultSecret {
    const secret = this._byId.get(secretId);
    if (!secret) {
      throw new Error(
        `No credential with id '${secretId}' is accessible to this identity`,
      );
    }
    return secret;
  }

  /**
   * Get a login credential's payload by UUID.
   *
   * @param secretId - UUID of the secret.
   * @throws Error if not found.
   * @throws TypeError if the credential is not a login type.
   */
  getLogin(secretId: string): LoginPayload {
    return this._getTyped(secretId, VaultSecretType.LOGIN) as LoginPayload;
  }

  /**
   * Get an API key credential's payload by UUID.
   *
   * @param secretId - UUID of the secret.
   * @throws Error if not found.
   * @throws TypeError if the credential is not an api_key type.
   */
  getApiKey(secretId: string): APIKeyPayload {
    return this._getTyped(secretId, VaultSecretType.API_KEY) as APIKeyPayload;
  }

  /**
   * Get a key pair credential's payload by UUID.
   *
   * @param secretId - UUID of the secret.
   * @throws Error if not found.
   * @throws TypeError if the credential is not a key_pair type.
   */
  getKeyPair(secretId: string): KeyPairPayload {
    return this._getTyped(secretId, VaultSecretType.KEY_PAIR) as KeyPairPayload;
  }

  /**
   * Get an SSH key credential's payload by UUID.
   *
   * @param secretId - UUID of the secret.
   * @throws Error if not found.
   * @throws TypeError if the credential is not an ssh_key type.
   */
  getSshKey(secretId: string): SSHKeyPayload {
    return this._getTyped(secretId, VaultSecretType.SSH_KEY) as SSHKeyPayload;
  }

  // ------------------------------------------------------------------
  // Internal
  // ------------------------------------------------------------------

  private _getTyped(secretId: string, expectedType: VaultSecretType): unknown {
    const secret = this.get(secretId);
    if (secret.secretType !== expectedType) {
      throw new TypeError(
        `Credential '${secretId}' is a '${secret.secretType}' secret, not '${expectedType}'`,
      );
    }
    return secret.payload;
  }

  /**
   * Generate the current TOTP code for a login credential.
   *
   * @param secretId - UUID of the login secret.
   * @returns A {@link TOTPCode}.
   * @throws Error if not found.
   * @throws TypeError if the credential is not a login type.
   * @throws Error if the login has no TOTP configured.
   */
  getTotpCode(secretId: string): TOTPCode {
    const payload = this.getLogin(secretId);
    if (!payload.totp) {
      throw new Error(`Login '${secretId}' has no TOTP configured`);
    }
    return generateTotp(payload.totp);
  }

  /** Number of credentials accessible to this identity. */
  get length(): number {
    return this._secrets.length;
  }
}

import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { SecretPayload, DecryptedVaultSecret } from "@inkbox/sdk";
import { parseTotpUri } from "@inkbox/sdk";

export function registerVaultCommands(program: Command): void {
  const vault = program
    .command("vault")
    .description("Encrypted vault operations");

  vault
    .command("init")
    .description("Initialize a vault for an organization")
    .option("--vault-key <key>", "Vault key to initialize with")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { vaultKey?: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = cmdOpts.vaultKey ?? opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        const result = await inkbox.vault.initialize(vaultKey);
        output(result, { json: !!opts.json });
      }),
    );

  vault
    .command("info")
    .description("Show vault info")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const info = await inkbox.vault.info();
        output(info, { json: !!opts.json });
      }),
    );

  vault
    .command("secrets")
    .description("List vault secrets (metadata only)")
    .option("--type <type>", "Filter by type: login, api_key, ssh_key, key_pair, other")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { type?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const secrets = await inkbox.vault.listSecrets({
          secretType: cmdOpts.type,
        });
        output(secrets, {
          json: !!opts.json,
          columns: ["id", "name", "secretType", "status", "createdAt"],
        });
      }),
    );

  vault
    .command("get <secret-id>")
    .description("Get and decrypt a secret (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const unlocked = inkbox.vault._unlocked!;
        const secret = await unlocked.getSecret(secretId);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
            status: secret.status,
            createdAt: secret.createdAt,
            payload: secret.payload,
          },
          { json: !!opts.json },
        );
      }),
    );

  vault
    .command("create")
    .description("Create a new secret (requires vault key)")
    .requiredOption("--name <name>", "Secret display name")
    .requiredOption(
      "--type <type>",
      "Secret type: login, api_key, ssh_key, key_pair, other",
    )
    .option("--description <desc>", "Optional description")
    .option("--username <user>", "Username (for login type)")
    .option("--password <pass>", "Password (for login type)")
    .option("--email <email>", "Email (for login type)")
    .option("--url <url>", "URL (for login type)")
    .option("--totp-uri <uri>", "otpauth:// TOTP URI (for login type)")
    .option("--key <key>", "API key value (for api_key type)")
    .option("--access-key <key>", "Access key (for key_pair type)")
    .option("--secret-key <key>", "Secret key (for key_pair type)")
    .option("--endpoint <url>", "Endpoint URL (for api_key and key_pair types)")
    .option("--private-key <key>", "Private key (for ssh_key type)")
    .option("--public-key <key>", "Public key (for ssh_key type)")
    .option("--fingerprint <fp>", "Key fingerprint (for ssh_key type)")
    .option("--passphrase <pass>", "Key passphrase (for ssh_key type)")
    .option("--data <json>", "JSON payload (for other type)")
    .option("--notes <text>", "Optional notes")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          name: string;
          type: string;
          description?: string;
          username?: string;
          password?: string;
          email?: string;
          url?: string;
          totpUri?: string;
          key?: string;
          accessKey?: string;
          secretKey?: string;
          endpoint?: string;
          privateKey?: string;
          publicKey?: string;
          fingerprint?: string;
          passphrase?: string;
          data?: string;
          notes?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const unlocked = inkbox.vault._unlocked!;

        let payload: SecretPayload;
        switch (cmdOpts.type) {
          case "login":
            if (!cmdOpts.password) {
              console.error(
                "Error: --password is required for login secrets.",
              );
              process.exit(1);
            }
            payload = {
              password: cmdOpts.password,
              username: cmdOpts.username,
              email: cmdOpts.email,
              url: cmdOpts.url,
              notes: cmdOpts.notes,
              ...(cmdOpts.totpUri
                ? { totp: parseTotpUri(cmdOpts.totpUri) }
                : {}),
            };
            break;
          case "api_key":
            if (!cmdOpts.key) {
              console.error(
                "Error: --key is required for api_key secrets.",
              );
              process.exit(1);
            }
            payload = {
              apiKey: cmdOpts.key,
              endpoint: cmdOpts.endpoint,
              notes: cmdOpts.notes,
            };
            break;
          case "key_pair":
            if (!cmdOpts.accessKey || !cmdOpts.secretKey) {
              console.error(
                "Error: --access-key and --secret-key are required for key_pair secrets.",
              );
              process.exit(1);
            }
            payload = {
              accessKey: cmdOpts.accessKey,
              secretKey: cmdOpts.secretKey,
              endpoint: cmdOpts.endpoint,
              notes: cmdOpts.notes,
            };
            break;
          case "ssh_key":
            if (!cmdOpts.privateKey) {
              console.error(
                "Error: --private-key is required for ssh_key secrets.",
              );
              process.exit(1);
            }
            payload = {
              privateKey: cmdOpts.privateKey,
              publicKey: cmdOpts.publicKey,
              fingerprint: cmdOpts.fingerprint,
              passphrase: cmdOpts.passphrase,
              notes: cmdOpts.notes,
            };
            break;
          case "other":
            if (!cmdOpts.data) {
              console.error(
                "Error: --data (JSON string) is required for other secrets.",
              );
              process.exit(1);
            }
            payload = {
              data: cmdOpts.data,
              notes: cmdOpts.notes,
            };
            break;
          default:
            console.error(
              `Error: Unknown secret type '${cmdOpts.type}'. Use: login, api_key, ssh_key, key_pair, other.`,
            );
            process.exit(1);
        }

        const secret = await unlocked.createSecret({
          name: cmdOpts.name,
          description: cmdOpts.description,
          payload,
        });
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
            status: secret.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  vault
    .command("delete <secret-id>")
    .description("Delete a secret")
    .action(
      withErrorHandler(async function (
        this: Command,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.vault.deleteSecret(secretId);
        console.log(`Deleted secret '${secretId}'.`);
      }),
    );

  vault
    .command("keys")
    .description("List vault keys")
    .option("--type <type>", "Filter by type: primary or recovery")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { type?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const keys = await inkbox.vault.listKeys({
          keyType: cmdOpts.type,
        });
        output(keys, {
          json: !!opts.json,
          columns: ["id", "keyType", "status", "createdBy", "createdAt"],
        });
      }),
    );

  vault
    .command("update-key")
    .description("Rotate the primary vault key")
    .requiredOption("--new-vault-key <key>", "New primary vault key")
    .option("--current-vault-key <key>", "Current primary vault key")
    .option("--recovery-code <code>", "Recovery code to use instead of the current key")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          newVaultKey: string;
          currentVaultKey?: string;
          recoveryCode?: string;
        },
      ) {
        const opts = getGlobalOpts(this);
        const currentVaultKey = cmdOpts.currentVaultKey ?? opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        const inkbox = createClient(opts);
        const result = await inkbox.vault.updateKey({
          newVaultKey: cmdOpts.newVaultKey,
          currentVaultKey: cmdOpts.recoveryCode ? undefined : currentVaultKey,
          recoveryCode: cmdOpts.recoveryCode,
        });
        output(result, { json: !!opts.json });
      }),
    );

  vault
    .command("delete-key <auth-hash>")
    .description("Delete a vault key by auth hash")
    .action(
      withErrorHandler(async function (
        this: Command,
        authHash: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.vault.deleteKey(authHash);
        console.log(`Deleted vault key '${authHash}'.`);
      }),
    );

  vault
    .command("grant-access <secret-id>")
    .description("Grant an identity access to a vault secret")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        secretId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const rule = await inkbox.vault.grantAccess(secretId, identity.id);
        output(
          {
            id: rule.id,
            vaultSecretId: rule.vaultSecretId,
            identityId: rule.identityId,
            createdAt: rule.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  vault
    .command("revoke-access <secret-id>")
    .description("Revoke an identity's access to a vault secret")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        secretId: string,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        await inkbox.vault.revokeAccess(secretId, identity.id);
        console.log(
          `Revoked access to secret '${secretId}' for identity '${cmdOpts.identity}'.`,
        );
      }),
    );

  vault
    .command("access-list <secret-id>")
    .description("List identity access rules for a vault secret")
    .action(
      withErrorHandler(async function (
        this: Command,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const rules = await inkbox.vault.listAccessRules(secretId);
        output(rules, {
          json: !!opts.json,
          columns: ["id", "vaultSecretId", "identityId", "createdAt"],
        });
      }),
    );

  vault
    .command("logins")
    .description("List login credentials for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const creds = await identity.getCredentials();
        const secrets = creds.listLogins();
        output(secrets, {
          json: !!opts.json,
          columns: ["id", "name", "secretType", "status", "createdAt"],
        });
      }),
    );

  vault
    .command("api-keys")
    .description("List API key credentials for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const creds = await identity.getCredentials();
        const secrets = creds.listApiKeys();
        output(secrets, {
          json: !!opts.json,
          columns: ["id", "name", "secretType", "status", "createdAt"],
        });
      }),
    );

  vault
    .command("ssh-keys")
    .description("List SSH key credentials for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const creds = await identity.getCredentials();
        const secrets = creds.listSshKeys();
        output(secrets, {
          json: !!opts.json,
          columns: ["id", "name", "secretType", "status", "createdAt"],
        });
      }),
    );

  vault
    .command("key-pairs")
    .description("List key pair credentials for an identity")
    .requiredOption("-i, --identity <handle>", "Agent identity handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { identity: string },
      ) {
        const opts = getGlobalOpts(this);
        const vaultKey = opts.vaultKey ?? process.env.INKBOX_VAULT_KEY;
        if (!vaultKey) {
          console.error(
            "Error: Vault key required. Set INKBOX_VAULT_KEY or pass --vault-key.",
          );
          process.exit(1);
        }
        const inkbox = createClient(opts);
        await inkbox.ready();
        const identity = await inkbox.getIdentity(cmdOpts.identity);
        const creds = await identity.getCredentials();
        const secrets = creds.listKeyPairs();
        output(secrets, {
          json: !!opts.json,
          columns: ["id", "name", "secretType", "status", "createdAt"],
        });
      }),
    );
}

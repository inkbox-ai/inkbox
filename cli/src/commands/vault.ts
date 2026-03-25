import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { SecretPayload } from "@inkbox/sdk";

export function registerVaultCommands(program: Command): void {
  const vault = program
    .command("vault")
    .description("Encrypted vault operations");

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
    .option("--url <url>", "URL (for login type)")
    .option("--key <key>", "API key value (for api_key type)")
    .option("--access-key <key>", "Access key (for key_pair type)")
    .option("--secret-key <key>", "Secret key (for key_pair type)")
    .option("--private-key <key>", "Private key (for ssh_key type)")
    .option("--public-key <key>", "Public key (for ssh_key type)")
    .option("--data <json>", "JSON payload (for other type)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: {
          name: string;
          type: string;
          description?: string;
          username?: string;
          password?: string;
          url?: string;
          key?: string;
          accessKey?: string;
          secretKey?: string;
          privateKey?: string;
          publicKey?: string;
          data?: string;
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
            if (!cmdOpts.username || !cmdOpts.password) {
              console.error(
                "Error: --username and --password are required for login secrets.",
              );
              process.exit(1);
            }
            payload = {
              username: cmdOpts.username,
              password: cmdOpts.password,
              url: cmdOpts.url,
            };
            break;
          case "api_key":
            if (!cmdOpts.key) {
              console.error(
                "Error: --key is required for api_key secrets.",
              );
              process.exit(1);
            }
            payload = { apiKey: cmdOpts.key };
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
            };
            break;
          case "other":
            if (!cmdOpts.data) {
              console.error(
                "Error: --data (JSON string) is required for other secrets.",
              );
              process.exit(1);
            }
            payload = JSON.parse(cmdOpts.data);
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
}

import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";
import type { SecretPayload } from "@inkbox/sdk";
import { parseTotpUri } from "@inkbox/sdk";

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command("identity")
    .description("Manage agent identities");

  identity
    .command("list")
    .description("List all identities")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identities = await inkbox.listIdentities();
        output(identities, {
          json: !!opts.json,
          columns: ["agentHandle", "id", "createdAt"],
        });
      }),
    );

  identity
    .command("get <handle>")
    .description("Get identity details")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            mailbox: id.mailbox?.emailAddress ?? null,
            phoneNumber: id.phoneNumber?.number ?? null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("create <handle>")
    .description("Create a new identity")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.createIdentity(handle);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("delete <handle>")
    .description("Delete an identity")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.delete();
        console.log(`Deleted identity '${handle}'.`);
      }),
    );

  identity
    .command("update <handle>")
    .description("Update an identity")
    .option("--new-handle <name>", "New handle")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { newHandle?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.update({
          newHandle: cmdOpts.newHandle,
        });
        console.log(`Updated identity '${handle}'.`);
      }),
    );

  identity
    .command("refresh <handle>")
    .description("Re-fetch identity from API")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.refresh();
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            mailbox: id.mailbox?.emailAddress ?? null,
            phoneNumber: id.phoneNumber?.number ?? null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("create-secret <handle>")
    .description("Create a secret scoped to an identity (requires vault key)")
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
        handle: string,
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
        const id = await inkbox.getIdentity(handle);

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

        const secret = await id.createSecret({
          name: cmdOpts.name,
          description: cmdOpts.description,
          payload,
        });
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("get-secret <handle> <secret-id>")
    .description("Get and decrypt a secret for an identity (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
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
        const id = await inkbox.getIdentity(handle);
        const secret = await id.getSecret(secretId);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
            createdAt: secret.createdAt,
            payload: secret.payload,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("delete-secret <handle> <secret-id>")
    .description("Delete a secret for an identity (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
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
        const id = await inkbox.getIdentity(handle);
        await id.deleteSecret(secretId);
        console.log(`Deleted secret '${secretId}'.`);
      }),
    );

  identity
    .command("revoke-access <handle> <secret-id>")
    .description("Revoke an identity's access to a secret")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.revokeCredentialAccess(secretId);
        console.log(
          `Revoked access to secret '${secretId}' for identity '${handle}'.`,
        );
      }),
    );

  identity
    .command("set-totp <handle> <secret-id>")
    .description("Add TOTP to a login secret (requires vault key)")
    .requiredOption("--uri <otpauth-uri>", "otpauth:// TOTP URI")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        secretId: string,
        cmdOpts: { uri: string },
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
        const id = await inkbox.getIdentity(handle);
        const secret = await id.setTotp(secretId, cmdOpts.uri);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("remove-totp <handle> <secret-id>")
    .description("Remove TOTP from a login secret (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
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
        const id = await inkbox.getIdentity(handle);
        const secret = await id.removeTotp(secretId);
        output(
          {
            id: secret.id,
            name: secret.name,
            secretType: secret.secretType,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("totp-code <handle> <secret-id>")
    .description("Generate a TOTP code (requires vault key)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
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
        const id = await inkbox.getIdentity(handle);
        const totp = await id.getTotpCode(secretId);
        output(
          {
            code: totp.code,
            periodStart: totp.periodStart,
            periodEnd: totp.periodEnd,
            secondsRemaining: totp.secondsRemaining,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("assign-mailbox <handle>")
    .description("Assign an existing mailbox to an identity")
    .requiredOption("--mailbox-id <id>", "UUID of the mailbox to assign")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { mailboxId: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        const mb = await id.assignMailbox(cmdOpts.mailboxId);
        output(
          {
            agentHandle: id.agentHandle,
            mailboxId: mb.id,
            emailAddress: mb.emailAddress,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("unlink-mailbox <handle>")
    .description("Unlink the mailbox from an identity (does not delete the mailbox)")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.unlinkMailbox();
        console.log(`Unlinked mailbox from identity '${handle}'.`);
      }),
    );

  identity
    .command("assign-phone <handle>")
    .description("Assign an existing phone number to an identity")
    .requiredOption("--phone-number-id <id>", "UUID of the phone number to assign")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { phoneNumberId: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        const pn = await id.assignPhoneNumber(cmdOpts.phoneNumberId);
        output(
          {
            agentHandle: id.agentHandle,
            phoneNumberId: pn.id,
            number: pn.number,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("unlink-phone <handle>")
    .description("Unlink the phone number from an identity (does not release the number)")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.unlinkPhoneNumber();
        console.log(`Unlinked phone number from identity '${handle}'.`);
      }),
    );
}

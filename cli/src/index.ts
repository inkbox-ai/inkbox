#!/usr/bin/env node

import { Command } from "commander";
import { registerIdentityCommands } from "./commands/identity.js";
import { registerEmailCommands } from "./commands/email.js";
import { registerPhoneCommands } from "./commands/phone.js";
import { registerTextCommands } from "./commands/text.js";
import { registerVaultCommands } from "./commands/vault.js";
import { registerMailboxCommands } from "./commands/mailbox.js";
import { registerNumberCommands } from "./commands/number.js";
import { registerSigningKeyCommands } from "./commands/signing-key.js";
import { registerWebhookCommands } from "./commands/webhook.js";

const program = new Command()
  .name("inkbox")
  .description("CLI for the Inkbox API — email, phone, identities, and vault for AI agents")
  .version("0.1.0")
  .option("--api-key <key>", "Inkbox API key (or set INKBOX_API_KEY)")
  .option("--vault-key <key>", "Vault key for decrypt operations (or set INKBOX_VAULT_KEY)")
  .option("--base-url <url>", "Override API base URL")
  .option("--json", "Output as JSON", false);

registerIdentityCommands(program);
registerEmailCommands(program);
registerPhoneCommands(program);
registerTextCommands(program);
registerVaultCommands(program);
registerMailboxCommands(program);
registerNumberCommands(program);
registerSigningKeyCommands(program);
registerWebhookCommands(program);

program.parse();

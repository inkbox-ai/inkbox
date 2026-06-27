#!/usr/bin/env node

import { Command } from "commander";
import { registerWhoamiCommand } from "./commands/whoami.js";
import { registerSignupCommands } from "./commands/signup.js";
import { registerIdentityCommands } from "./commands/identity.js";
import { registerEmailCommands } from "./commands/email.js";
import { registerPhoneCommands } from "./commands/phone.js";
import { registerTextCommands } from "./commands/text.js";
import { registerIMessageCommands } from "./commands/imessage.js";
import { registerSmsOptInCommands } from "./commands/sms-opt-in.js";
import { registerVaultCommands } from "./commands/vault.js";
import { registerMailboxCommands } from "./commands/mailbox.js";
import { registerTunnelCommands } from "./commands/tunnel.js";
import { registerNumberCommands } from "./commands/number.js";
import { registerSigningKeyCommands } from "./commands/signing-key.js";
import { registerApiKeysCommands } from "./commands/api-keys.js";
import { registerWebhookCommands } from "./commands/webhook.js";
import { registerContactsCommands } from "./commands/contacts.js";
import { registerNotesCommands } from "./commands/notes.js";
import { registerDomainCommands } from "./commands/domain.js";

const program = new Command()
  .name("inkbox")
  .description("CLI for the Inkbox API — email, phone, identities, and vault for AI agents")
  .version("0.4.11")
  .option("--api-key <key>", "Inkbox API key (or set INKBOX_API_KEY)")
  .option("--vault-key <key>", "Vault key for decrypt operations (or set INKBOX_VAULT_KEY)")
  .option("--base-url <url>", "Override API base URL (or set INKBOX_BASE_URL)")
  .option("--json", "Output as JSON", false);

registerWhoamiCommand(program);
registerSignupCommands(program);
registerIdentityCommands(program);
registerEmailCommands(program);
registerPhoneCommands(program);
registerTextCommands(program);
registerIMessageCommands(program);
registerSmsOptInCommands(program);
registerVaultCommands(program);
registerMailboxCommands(program);
registerTunnelCommands(program);
registerNumberCommands(program);
registerSigningKeyCommands(program);
registerApiKeysCommands(program);
registerWebhookCommands(program);
registerContactsCommands(program);
registerNotesCommands(program);
registerDomainCommands(program);

program.parse();

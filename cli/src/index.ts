#!/usr/bin/env node

import { Command } from "commander";
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici";
import { CLI_VERSION } from "./client.js";
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

// Node's fetch ignores HTTP(S)_PROXY/NO_PROXY unless NODE_USE_ENV_PROXY is
// set, which strands the CLI in sandboxed/proxied environments. Honor them
// ourselves, and set the flag so the SDK skips its proxy hint on errors.
const proxyVars = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"];
if (!process.env.NODE_USE_ENV_PROXY && proxyVars.some((name) => process.env[name])) {
  setGlobalDispatcher(new EnvHttpProxyAgent());
  process.env.NODE_USE_ENV_PROXY = "1";
}

const program = new Command()
  .name("inkbox")
  .description("CLI for the Inkbox API — email, phone, identities, and vault for AI agents")
  .version(CLI_VERSION)
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

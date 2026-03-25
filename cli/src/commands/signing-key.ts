import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerSigningKeyCommands(program: Command): void {
  const signingKey = program
    .command("signing-key")
    .description("Webhook signing key operations");

  signingKey
    .command("create")
    .description("Create or rotate the webhook signing key")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const key = await inkbox.createSigningKey();
        output(
          {
            signingKey: key.signingKey,
            createdAt: key.createdAt,
          },
          { json: !!opts.json },
        );
        console.error(
          "Note: Store this key securely — it cannot be retrieved again.",
        );
      }),
    );
}

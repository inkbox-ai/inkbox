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
    .description(
      "[deprecated] Create or rotate a webhook signing key via the org-level " +
        "endpoint. Use 'inkbox identity signing-key rotate <handle>' instead. " +
        "With an agent-scoped key this rotates that identity's key; with an " +
        "admin key the server returns 409.",
    )
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
        console.error(
          "Note: Org-level signing keys are deprecated. Prefer " +
            "'inkbox identity signing-key rotate <handle>'.",
        );
      }),
    );
}

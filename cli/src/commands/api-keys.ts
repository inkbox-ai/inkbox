import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerApiKeysCommands(program: Command): void {
  const apiKeys = program
    .command("api-keys")
    .description("API key creation");

  apiKeys
    .command("create")
    .description(
      "Create a new API key. Admin-scoped callers must pass --identity-id; " +
      "JWT (console) callers may omit it for an admin key.",
    )
    .requiredOption("--label <label>", "Human-readable name for the key")
    .option("--description <text>", "Optional free-text description")
    .option(
      "--identity-id <uuid>",
      "Scope this key to a specific agent identity",
    )
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const local = this.opts() as {
          label: string;
          description?: string;
          identityId?: string;
        };
        const inkbox = createClient(opts);
        const result = await inkbox.apiKeys.create({
          label: local.label,
          description: local.description,
          scopedIdentityId: local.identityId,
        });
        output(
          {
            apiKey: result.apiKey,
            record: {
              id: result.record.id,
              label: result.record.label,
              scopedIdentityId: result.record.scopedIdentityId,
              status: result.record.status,
              createdAt: result.record.createdAt,
            },
          },
          { json: !!opts.json },
        );
        console.error(
          "Note: Store this key securely — it cannot be retrieved again.",
        );
      }),
    );
}

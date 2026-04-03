import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerWhoamiCommand(program: Command): void {
  program
    .command("whoami")
    .description("Show the authenticated caller's identity")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const info = await inkbox.whoami();
        output(info, { json: !!opts.json });
      }),
    );
}

import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerComputersCommands(program: Command): void {
  program.command("computers").description("Inspect computer templates")
    .command("templates").description("Read templates and current hosted defaults")
    .action(withErrorHandler(async function (this: Command) {
      output(await createClient(getGlobalOpts(this)).computers.templates() as unknown as Record<string, unknown>, { json: true });
    }));
}

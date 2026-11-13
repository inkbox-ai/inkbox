import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerComputersCommands(program: Command): void {
  const computers = program.command("computers").description("Inspect computer templates and sizes");
  computers.command("templates").description("Read templates and current hosted defaults")
    .action(withErrorHandler(async function (this: Command) {
      output(await createClient(getGlobalOpts(this)).computers.templates() as unknown as Record<string, unknown>, { json: true });
    }));
  computers.command("shapes").description("Read supported CPU and memory allocations")
    .action(withErrorHandler(async function (this: Command) {
      output(await createClient(getGlobalOpts(this)).computers.shapes() as unknown as Record<string, unknown>, { json: true });
    }));
}

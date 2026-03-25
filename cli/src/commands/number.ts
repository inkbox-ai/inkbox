import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerNumberCommands(program: Command): void {
  const number = program
    .command("number")
    .description("Org-level phone number operations");

  number
    .command("list")
    .description("List all phone numbers")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const numbers = await inkbox.phoneNumbers.list();
        output(numbers, {
          json: !!opts.json,
          columns: ["number", "id", "type", "status", "createdAt"],
        });
      }),
    );

  number
    .command("provision")
    .description("Provision a new phone number")
    .requiredOption("--handle <handle>", "Agent handle to provision for")
    .option("--type <type>", "Number type: toll_free or local", "toll_free")
    .option("--state <state>", "US state abbreviation (for local numbers)")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { handle: string; type: string; state?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const num = await inkbox.phoneNumbers.provision({
          agentHandle: cmdOpts.handle,
          type: cmdOpts.type,
          state: cmdOpts.state,
        });
        output(
          {
            number: num.number,
            id: num.id,
            type: num.type,
            status: num.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  number
    .command("release <id>")
    .description("Release a phone number")
    .action(
      withErrorHandler(async function (this: Command, id: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.phoneNumbers.release(id);
        console.log(`Released phone number '${id}'.`);
      }),
    );
}

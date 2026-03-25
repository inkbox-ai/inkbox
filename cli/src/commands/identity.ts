import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerIdentityCommands(program: Command): void {
  const identity = program
    .command("identity")
    .description("Manage agent identities");

  identity
    .command("list")
    .description("List all identities")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const identities = await inkbox.listIdentities();
        output(identities, {
          json: !!opts.json,
          columns: ["agentHandle", "id", "status", "createdAt"],
        });
      }),
    );

  identity
    .command("get <handle>")
    .description("Get identity details")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            status: id.status,
            mailbox: id.mailbox?.emailAddress ?? null,
            phoneNumber: id.phoneNumber?.number ?? null,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("create <handle>")
    .description("Create a new identity")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.createIdentity(handle);
        output(
          {
            agentHandle: id.agentHandle,
            id: id.id,
            status: id.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  identity
    .command("delete <handle>")
    .description("Delete an identity")
    .action(
      withErrorHandler(async function (this: Command, handle: string) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.delete();
        console.log(`Deleted identity '${handle}'.`);
      }),
    );

  identity
    .command("update <handle>")
    .description("Update an identity")
    .option("--new-handle <name>", "New handle")
    .option("--status <status>", "New status (active, paused)")
    .action(
      withErrorHandler(async function (
        this: Command,
        handle: string,
        cmdOpts: { newHandle?: string; status?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const id = await inkbox.getIdentity(handle);
        await id.update({
          newHandle: cmdOpts.newHandle,
          status: cmdOpts.status,
        });
        console.log(`Updated identity '${handle}'.`);
      }),
    );
}

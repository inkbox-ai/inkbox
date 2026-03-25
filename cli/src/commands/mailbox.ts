import { Command } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { output } from "../output.js";
import { withErrorHandler } from "../errors.js";

export function registerMailboxCommands(program: Command): void {
  const mailbox = program
    .command("mailbox")
    .description("Org-level mailbox operations");

  mailbox
    .command("list")
    .description("List all mailboxes")
    .action(
      withErrorHandler(async function (this: Command) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mailboxes = await inkbox.mailboxes.list();
        output(mailboxes, {
          json: !!opts.json,
          columns: [
            "emailAddress",
            "id",
            "displayName",
            "status",
            "createdAt",
          ],
        });
      }),
    );

  mailbox
    .command("create")
    .description("Create a new mailbox")
    .requiredOption("--handle <handle>", "Agent handle to create mailbox for")
    .option("--display-name <name>", "Display name for the mailbox")
    .action(
      withErrorHandler(async function (
        this: Command,
        cmdOpts: { handle: string; displayName?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.create({
          agentHandle: cmdOpts.handle,
          displayName: cmdOpts.displayName,
        });
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            status: mb.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  mailbox
    .command("get <email-address>")
    .description("Get mailbox details")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.get(emailAddress);
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            webhookUrl: mb.webhookUrl ?? null,
            status: mb.status,
            createdAt: mb.createdAt,
          },
          { json: !!opts.json },
        );
      }),
    );

  mailbox
    .command("update <email-address>")
    .description("Update a mailbox")
    .option("--display-name <name>", "New display name")
    .option("--webhook-url <url>", 'Webhook URL (pass "" to clear)')
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
        cmdOpts: { displayName?: string; webhookUrl?: string },
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        const mb = await inkbox.mailboxes.update(emailAddress, {
          displayName: cmdOpts.displayName,
          webhookUrl:
            cmdOpts.webhookUrl === "" ? null : cmdOpts.webhookUrl,
        });
        output(
          {
            emailAddress: mb.emailAddress,
            id: mb.id,
            displayName: mb.displayName,
            webhookUrl: mb.webhookUrl ?? null,
            status: mb.status,
          },
          { json: !!opts.json },
        );
      }),
    );

  mailbox
    .command("delete <email-address>")
    .description("Delete a mailbox")
    .action(
      withErrorHandler(async function (
        this: Command,
        emailAddress: string,
      ) {
        const opts = getGlobalOpts(this);
        const inkbox = createClient(opts);
        await inkbox.mailboxes.delete(emailAddress);
        console.log(`Deleted mailbox '${emailAddress}'.`);
      }),
    );
}

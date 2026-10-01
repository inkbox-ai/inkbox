import { Command, Option } from "commander";
import { createClient, getGlobalOpts } from "../client.js";
import { withErrorHandler } from "../errors.js";
import { output } from "../output.js";

export function registerSendLookupCommand(program: Command): void {
  program.command("send-lookup")
    .description("Recover the original message ID using its send request key")
    .addOption(new Option("--sender-kind <kind>", "Sender resource type")
      .choices(["mailbox", "phone_number", "imessage_identity"]).makeOptionMandatory())
    .option("--sender-id <uuid>", "Original sender resource UUID")
    .option("--email-address <address>", "Resolve a sending mailbox by address")
    .requiredOption("--operation <operation>", "mail.send, mail.reply_all, mail.forward, text.send, or imessage.send")
    .requiredOption("--idempotency-key <key>", "Original send request key")
    .action(withErrorHandler(async function (this: Command, options: {
      senderKind: "mailbox" | "phone_number" | "imessage_identity"; senderId?: string;
      emailAddress?: string; operation: string; idempotencyKey: string;
    }) {
      if (!!options.senderId === !!options.emailAddress) throw new Error("Pass exactly one of --sender-id or --email-address.");
      if (options.emailAddress && options.senderKind !== "mailbox") throw new Error("--email-address requires --sender-kind mailbox.");
      const global = getGlobalOpts(this);
      const client = createClient(global);
      const messageId = options.emailAddress
        ? await client.messageSends.lookupEmail(options.emailAddress, options)
        : await client.messageSends.lookup({ ...options, senderId: options.senderId! });
      output({ messageId }, { json: !!global.json });
    }));
}
